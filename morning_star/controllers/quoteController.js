import mongoose from "mongoose";
import { createLogger } from "@app/observability";
import { promoteCustomerTier, User } from "@app/models/auth";
import { Article, resolveLatestReportingHsns } from "@app/models/catalog";
import {
  AUTO_APPROVER,
  QUOTE_RISKS,
  QUOTE_STATUSES,
  Quote,
  QuoteRevisionHistory,
  SubscriptionDetails,
  SubscriptionRevisionHistory,
} from "../models.js";
import {
  applyCreationRiskWorkflow,
  applyUpdateRiskWorkflow,
  QUOTE_INPUT_FIELDS,
  priceQuotation,
  quoteIntentFromSnapshot,
  rejectedRevisionAsDraft,
} from "../services/quotePricing.js";
import {
  createBillingInvoice,
  deleteBillingInvoice,
} from "../services/invoiceService.js";

const logger = createLogger("morning-star.quote-controller", {
  "service.component": "quote-controller",
});

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

const FILTER_FIELDS = Object.freeze([
  "status",
  "risk",
  "customer",
  "created_by",
  "approved_by",
  "assigned_to",
  "is_latest_quote",
]);

class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

function requireDatabase() {
  if (mongoose.connection.readyState !== 1) {
    throw new ApiError(
      503,
      "DATABASE_UNAVAILABLE",
      "The quotation database is not ready",
    );
  }
}

function requireObject(value, message = "The request body must be a JSON object") {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ApiError(400, "INVALID_REQUEST_BODY", message);
  }

  return value;
}

function rejectUnknownFields(value, allowedFields) {
  const unknownFields = Object.keys(value).filter(
    (field) => !allowedFields.includes(field),
  );

  if (unknownFields.length > 0) {
    throw new ApiError(
      400,
      "UNKNOWN_FIELDS",
      `Unsupported field(s): ${unknownFields.join(", ")}`,
      { fields: unknownFields },
    );
  }
}

function parsePositiveInteger(value, fallback, name, maximum) {
  if (value === undefined || value === "") return fallback;

  const parsed = Number(value);
  if (
    !Number.isInteger(parsed) ||
    parsed < 1 ||
    (maximum !== undefined && parsed > maximum)
  ) {
    const maximumMessage = maximum === undefined ? "" : ` and at most ${maximum}`;
    throw new ApiError(
      400,
      "INVALID_PAGINATION",
      `${name} must be a positive integer${maximumMessage}`,
    );
  }

  return parsed;
}

function parsePagination(query) {
  return {
    page: parsePositiveInteger(query.page, DEFAULT_PAGE, "page"),
    limit: parsePositiveInteger(query.limit, DEFAULT_LIMIT, "limit", MAX_LIMIT),
  };
}

function parseBoolean(value, field) {
  if (value === true || value === "true") return true;
  if (value === false || value === "false") return false;

  throw new ApiError(400, "INVALID_FILTER", `${field} must be true or false`);
}

function parseEnumFilter(value, allowedValues, field) {
  const values = (Array.isArray(value) ? value : String(value).split(","))
    .map((entry) => String(entry).trim().toUpperCase())
    .filter(Boolean);

  if (values.length === 0 || values.some((entry) => !allowedValues.includes(entry))) {
    throw new ApiError(
      400,
      "INVALID_FILTER",
      `${field} must contain only: ${allowedValues.join(", ")}`,
    );
  }

  return values.length === 1 ? values[0] : { $in: [...new Set(values)] };
}

function parseFilterObject(query) {
  let input = {};

  if (query.filter !== undefined && query.filter !== "") {
    if (Array.isArray(query.filter)) {
      throw new ApiError(400, "INVALID_FILTER", "filter must be a JSON object");
    }

    try {
      input = JSON.parse(query.filter);
    } catch {
      const scalarFilter = query.filter.trim().toUpperCase();

      if (QUOTE_STATUSES.includes(scalarFilter)) {
        input = { status: scalarFilter };
      } else if (QUOTE_RISKS.includes(scalarFilter)) {
        input = { risk: scalarFilter };
      } else {
        throw new ApiError(
          400,
          "INVALID_FILTER",
          "filter must be a quote status, risk, or valid JSON object",
        );
      }
    }

    if (!input || typeof input !== "object" || Array.isArray(input)) {
      throw new ApiError(400, "INVALID_FILTER", "filter must be a JSON object");
    }
  }

  for (const field of FILTER_FIELDS) {
    if (query[field] !== undefined) input[field] = query[field];
  }

  const allowedQueryFields = new Set([
    "filter",
    "page",
    "limit",
    "search",
    ...FILTER_FIELDS,
  ]);
  const unknownQueryFields = Object.keys(query).filter(
    (field) => !allowedQueryFields.has(field),
  );
  if (unknownQueryFields.length > 0) {
    throw new ApiError(
      400,
      "INVALID_FILTER",
      `Unsupported filter(s): ${unknownQueryFields.join(", ")}`,
      { fields: unknownQueryFields },
    );
  }

  rejectUnknownFields(input, FILTER_FIELDS);

  const filter = {};
  for (const [field, value] of Object.entries(input)) {
    if (value === undefined || value === null || value === "") continue;

    if (field === "status") {
      filter.status = parseEnumFilter(value, QUOTE_STATUSES, field);
    } else if (field === "risk") {
      filter.risk = parseEnumFilter(value, QUOTE_RISKS, field);
    } else if (field === "is_latest_quote") {
      filter.is_latest_quote = parseBoolean(value, field);
    } else if (field === "customer") {
      if (!mongoose.isObjectIdOrHexString(value)) {
        throw new ApiError(
          400,
          "INVALID_FILTER",
          "customer must be a valid MongoDB ObjectId",
        );
      }
      filter.customer = String(value);
    } else {
      if (typeof value !== "string" || value.trim() === "") {
        throw new ApiError(400, "INVALID_FILTER", `${field} must be a string`);
      }
      const normalizedValue = value.trim();
      filter[field] =
        field === "approved_by" && normalizedValue.toUpperCase() === AUTO_APPROVER
          ? AUTO_APPROVER
          : normalizedValue.toLowerCase();
    }
  }

  if (filter.is_latest_quote === undefined) filter.is_latest_quote = true;
  return filter;
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Free-text term for the quote list. Returns null when absent so "not asked
 * for" stays distinct from "matched nothing".
 */
function parseQuoteSearch(query) {
  if (query.search === undefined || query.search === "") return null;
  if (Array.isArray(query.search)) {
    throw new ApiError(400, "INVALID_SEARCH", "search must be a single value");
  }

  const search = String(query.search).trim();
  if (!search) return null;
  if (search.length > 100) {
    throw new ApiError(
      400,
      "INVALID_SEARCH",
      "search must contain at most 100 characters",
    );
  }

  return search;
}

/**
 * Widen a quote filter with a free-text term.
 *
 * A quotation stores only the customer's id, so searching by customer name
 * means resolving matching users first. The rep's own address is stored on the
 * quote, so `created_by` is matched directly. An unmatched customer name still
 * has to return zero rows rather than everything, which is why the customer
 * clause is added even when the id list is empty.
 */
async function withQuoteSearch(filter, search) {
  const pattern = { $regex: escapeRegex(search), $options: "i" };
  const customers = await User.find({
    $or: [{ fullName: pattern }, { emailLower: pattern }],
  })
    .select("_id")
    .lean();

  return {
    ...filter,
    $or: [
      { created_by: pattern },
      { customer: { $in: customers.map((customer) => String(customer._id)) } },
    ],
  };
}

async function releaseInventoryReservations(reservations) {
  await Promise.allSettled(
    reservations.map(({ article_id: articleId, inv }) =>
      Article.updateOne(
        { _id: articleId },
        {
          $inc: {
            "inventory.sellable": inv,
            "inventory.reserved": -inv,
          },
        },
      ),
    ),
  );
}

function fulfillmentAllocations(products, fulfillmentDetails = []) {
  let physicalIndex = 0;
  return products.flatMap((product) => {
    if (product.category === "SUBSCRIPTION") return [];
    const fulfillment = fulfillmentDetails[physicalIndex];
    physicalIndex += 1;
    return [{ product, fulfillment }];
  });
}

function allocatedArticleFilter(product, fulfillment) {
  if (fulfillment?.seller_identifier && fulfillment?.store) {
    return {
      seller_identifier: fulfillment.seller_identifier,
      store_id: fulfillment.store,
    };
  }
  return { _id: product.article_id };
}

async function reserveQuoteInventory(products, fulfillmentDetails = []) {
  const reservations = [];

  try {
    for (const { product, fulfillment } of fulfillmentAllocations(
      products,
      fulfillmentDetails,
    )) {
      const reservedArticle = await Article.findOneAndUpdate(
        {
          ...allocatedArticleFilter(product, fulfillment),
          "inventory.sellable": { $gte: product.inv },
        },
        {
          $inc: {
            "inventory.sellable": -product.inv,
            "inventory.reserved": product.inv,
          },
        },
        { returnDocument: "after" },
      );

      if (!reservedArticle) {
        throw new ApiError(
          409,
          "INSUFFICIENT_INVENTORY",
          `The allocated article for ${product.name} does not have enough sellable inventory to enter negotiation`,
          { article_id: String(product.article_id), requested: product.inv },
        );
      }

      reservations.push({ article_id: reservedArticle._id, inv: product.inv });
    }

    return reservations;
  } catch (error) {
    await releaseInventoryReservations(reservations);
    throw error;
  }
}

function inventoryByArticle(products) {
  const inventory = new Map();

  for (const product of products) {
    if (product.category === "SUBSCRIPTION") continue;
    const articleId = String(product.article_id);
    inventory.set(articleId, (inventory.get(articleId) ?? 0) + product.inv);
  }

  return inventory;
}

async function restoreReleasedInventory(releases) {
  await Promise.allSettled(
    releases.map(({ article_id: articleId, inv }) =>
      Article.updateOne(
        {
          _id: articleId,
          "inventory.sellable": { $gte: inv },
        },
        {
          $inc: {
            "inventory.sellable": -inv,
            "inventory.reserved": inv,
          },
        },
      ),
    ),
  );
}

async function releaseQuoteInventory(products, fulfillmentDetails = []) {
  const releases = [];

  try {
    for (const { product, fulfillment } of fulfillmentAllocations(
      products,
      fulfillmentDetails,
    )) {
      const releasedArticle = await Article.findOneAndUpdate(
        {
          ...allocatedArticleFilter(product, fulfillment),
          "inventory.reserved": { $gte: product.inv },
        },
        {
          $inc: {
            "inventory.sellable": product.inv,
            "inventory.reserved": -product.inv,
          },
        },
        { returnDocument: "after" },
      );

      if (!releasedArticle) {
        throw new ApiError(
          409,
          "INSUFFICIENT_RESERVED_INVENTORY",
          `The allocated article for ${product.name} does not contain the inventory reserved by this quotation`,
          {
            article_id: String(product.article_id),
            expected_reserved: product.inv,
          },
        );
      }

      releases.push({ article_id: releasedArticle._id, inv: product.inv });
    }

    return releases;
  } catch (error) {
    await restoreReleasedInventory(releases);
    throw error;
  }
}

async function createSubscriptionRecords(products) {
  const subscriptions = [];
  const revisions = [];

  try {
    for (const product of products) {
      if (product.category !== "SUBSCRIPTION") continue;

      const subscription = await SubscriptionDetails.create({
        article_id: product.article_id,
        status: "ACTIVE",
        is_latest: true,
      });
      subscriptions.push(subscription);

      const revision = await SubscriptionRevisionHistory.create({
        sub_version: 1,
        subscription_details_id: subscription._id,
      });
      revisions.push(revision);
    }

    return { subscriptions, revisions };
  } catch (error) {
    await Promise.allSettled([
      SubscriptionRevisionHistory.deleteMany({
        _id: { $in: revisions.map((revision) => revision._id) },
      }),
      SubscriptionDetails.deleteMany({
        _id: { $in: subscriptions.map((subscription) => subscription._id) },
      }),
    ]);
    throw error;
  }
}

async function advanceApprovedQuoteToNegotiation(quote) {
  const subscriptionProducts = quote.products.filter(
    (product) => product.category === "SUBSCRIPTION",
  );

  const { subscriptions, revisions: subscriptionRevisions } =
    await createSubscriptionRecords(subscriptionProducts);
  let reservations = [];
  let billing;
  let transitioned = false;

  try {
    const negotiationQuote = await Quote.findOneAndUpdate(
      { _id: quote._id, status: "APPROVED" },
      {
        $set: {
          status: "NEGOTIATION",
          subscription_details: subscriptions.map(
            (subscription) => subscription._id,
          ),
        },
      },
      { returnDocument: "after", runValidators: true },
    );
    if (!negotiationQuote) {
      throw new ApiError(
        409,
        "QUOTE_VERSION_CONFLICT",
        "The quotation changed while subscriptions were being created",
      );
    }
    transitioned = true;

    reservations = await reserveQuoteInventory(
      negotiationQuote.products,
      negotiationQuote.fulfillment_details,
    );
    billing = await createBillingInvoice(negotiationQuote._id);

    return {
      quote: negotiationQuote,
      billing,
      reservations,
      subscriptions,
      subscriptionRevisions,
    };
  } catch (error) {
    await releaseInventoryReservations(reservations);
    await Promise.allSettled([
      billing?._id
        ? deleteBillingInvoice(billing)
        : Promise.resolve(),
      SubscriptionRevisionHistory.deleteMany({
        _id: {
          $in: subscriptionRevisions.map((revision) => revision._id),
        },
      }),
      SubscriptionDetails.deleteMany({
        _id: { $in: subscriptions.map((subscription) => subscription._id) },
      }),
      transitioned
        ? Quote.updateOne(
            { _id: quote._id, status: "NEGOTIATION" },
            { $set: { status: "APPROVED", subscription_details: [] } },
          )
        : Promise.resolve(),
    ]);
    throw error;
  }
}

async function applyCompletedQuoteToCustomer(quote) {
  if (
    quote.status !== "COMPLETED" ||
    quote.customer_total_price_applied === true
  ) {
    return null;
  }

  const creditedQuote = await Quote.findOneAndUpdate(
    {
      _id: quote._id,
      status: "COMPLETED",
      customer_total_price_applied: { $ne: true },
    },
    { $set: { customer_total_price_applied: true } },
    { returnDocument: "after" },
  );

  if (!creditedQuote) return null;

  try {
    return await promoteCustomerTier(
      creditedQuote.customer,
      creditedQuote.selling_price,
    );
  } catch (error) {
    await Quote.updateOne(
      { _id: creditedQuote._id, customer_total_price_applied: true },
      { $set: { customer_total_price_applied: false } },
    );
    throw error;
  }
}

async function useLatestQuoteReportingHsns(quotes) {
  const availableQuotes = quotes.filter(Boolean);
  const reportingHsnCodes = availableQuotes.flatMap((quote) => [
    ...(quote.products ?? []).map((product) => product.hsn),
    ...(quote.subscription_details ?? []).map(
      (subscription) => subscription?.hsn,
    ),
  ]);
  const latestByReportingHsn = await resolveLatestReportingHsns(
    reportingHsnCodes,
  );

  return quotes.map((quote) => {
    if (!quote) return quote;

    return {
      ...quote,
      products: (quote.products ?? []).map((product) => ({
        ...product,
        hsn:
          latestByReportingHsn.get(product.hsn)?.reporting_hsn ?? product.hsn,
      })),
      subscription_details: (quote.subscription_details ?? []).map(
        (subscription) => {
          if (
            !subscription ||
            typeof subscription !== "object" ||
            typeof subscription.hsn !== "string"
          ) {
            return subscription;
          }

          return {
            ...subscription,
            hsn:
              latestByReportingHsn.get(subscription.hsn)?.reporting_hsn ??
              subscription.hsn,
          };
        },
      ),
    };
  });
}

async function quoteQuery(quoteId) {
  const quote = await Quote.findById(quoteId)
    .populate({
      path: "customer",
      select: "fullName email _custom_json.tier _custom_json.total_price",
    })
    .populate("subscription_details")
    .lean();
  return (await useLatestQuoteReportingHsns([quote]))[0];
}

async function revisionForQuote(quoteId) {
  return QuoteRevisionHistory.findOne({ quote_id: quoteId }).lean();
}

async function sendQuoteList(res, filter, pagination, search = null) {
  const { page, limit } = pagination;
  const effectiveFilter = search
    ? await withQuoteSearch(filter, search)
    : filter;
  const [quotes, total] = await Promise.all([
    Quote.find(effectiveFilter)
      .sort({ updatedAt: -1, _id: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .populate({
        path: "customer",
        select: "fullName email _custom_json.tier _custom_json.total_price",
      })
      .lean(),
    Quote.countDocuments(effectiveFilter),
  ]);
  const currentQuotes = await useLatestQuoteReportingHsns(quotes);
  const revisions = await QuoteRevisionHistory.find({
    quote_id: { $in: quotes.map((quote) => quote._id) },
  })
    .select("quote_id quote_version negotiation_id")
    .lean();
  const revisionByQuoteId = new Map(
    revisions.map((revision) => [String(revision.quote_id), revision]),
  );

  res.json({
    quotes: currentQuotes.map((quote) => ({
      ...quote,
      revision: revisionByQuoteId.get(String(quote._id)) ?? null,
    })),
    pagination: {
      page,
      limit,
      total,
      total_pages: Math.ceil(total / limit),
    },
  });
}

export async function getQuotes(req, res) {
  requireDatabase();
  const pagination = parsePagination(req.query);
  const filter = parseFilterObject(req.query);
  const search = parseQuoteSearch(req.query);
  await sendQuoteList(res, filter, pagination, search);
}

export async function getApprovedQuotes(req, res) {
  requireDatabase();
  const pagination = parsePagination(req.query);
  const filter = parseFilterObject(req.query);
  filter.status = "APPROVED";
  filter.is_latest_quote = true;
  await sendQuoteList(res, filter, pagination, parseQuoteSearch(req.query));
}

export async function getAtRiskDeals(req, res) {
  requireDatabase();
  const pagination = parsePagination(req.query);
  const filter = parseFilterObject(req.query);
  const atRiskValues = ["MEDIUM", "HIGH"];

  if (typeof filter.risk === "string") {
    if (!atRiskValues.includes(filter.risk)) {
      throw new ApiError(
        400,
        "INVALID_FILTER",
        "at_risk_deals only supports MEDIUM or HIGH risk",
      );
    }
  } else if (filter.risk?.$in) {
    const requestedRisks = filter.risk.$in.filter((risk) =>
      atRiskValues.includes(risk),
    );

    if (requestedRisks.length === 0) {
      throw new ApiError(
        400,
        "INVALID_FILTER",
        "at_risk_deals only supports MEDIUM or HIGH risk",
      );
    }

    filter.risk = { $in: requestedRisks };
  } else {
    filter.risk = { $in: atRiskValues };
  }

  filter.is_latest_quote = true;
  await sendQuoteList(res, filter, pagination, parseQuoteSearch(req.query));
}

export async function getQuote(req, res) {
  requireDatabase();

  if (!mongoose.isObjectIdOrHexString(req.params.quote_id)) {
    throw new ApiError(
      400,
      "INVALID_QUOTE_ID",
      "quote_id must be a valid MongoDB ObjectId",
    );
  }

  const [quote, revision] = await Promise.all([
    quoteQuery(req.params.quote_id),
    revisionForQuote(req.params.quote_id),
  ]);

  if (!quote) {
    throw new ApiError(404, "QUOTE_NOT_FOUND", "Quotation not found");
  }

  res.json({ quote, revision });
}

export async function getQuoteHistory(req, res) {
  requireDatabase();

  if (!mongoose.isObjectIdOrHexString(req.params.quote_id)) {
    throw new ApiError(
      400,
      "INVALID_QUOTE_ID",
      "quote_id must be a valid MongoDB ObjectId",
    );
  }

  const currentRevision = await revisionForQuote(req.params.quote_id);
  if (!currentRevision) {
    throw new ApiError(
      404,
      "QUOTE_REVISION_MISSING",
      "Quotation revision history was not found",
    );
  }

  const revisions = await QuoteRevisionHistory.find({
    negotiation_id: currentRevision.negotiation_id,
  })
    .sort({ quote_version: -1 })
    .lean();
  const quoteIds = revisions.map((revision) => revision.quote_id);
  const quotes = await Quote.find({ _id: { $in: quoteIds } })
    .select(
      "status selling_price risk reason products.name products.article_id " +
        "products._id is_latest_quote createdAt updatedAt",
    )
    .lean();
  const quoteById = new Map(
    quotes.map((quote) => [String(quote._id), quote]),
  );

  res.json({
    negotiation_id: currentRevision.negotiation_id,
    revisions: revisions.map((revision) => ({
      quote_version: revision.quote_version,
      quote: quoteById.get(String(revision.quote_id)) ?? null,
      createdAt: revision.createdAt,
    })),
  });
}

export async function createQuotation(req, res) {
  requireDatabase();
  const body = requireObject(req.body);
  rejectUnknownFields(body, QUOTE_INPUT_FIELDS);

  let quote;
  let revision;
  let workflowResult;
  let riskEvaluation;
  try {
    const {
      risk_evaluation: calculatedRiskEvaluation,
      ...pricedQuotation
    } = await priceQuotation(body);
    riskEvaluation = calculatedRiskEvaluation;
    quote = await Quote.create({
      ...applyCreationRiskWorkflow(pricedQuotation),
      subscription_details: [],
      is_latest_quote: true,
    });
    revision = await QuoteRevisionHistory.create({
      quote_version: 1,
      quote_id: quote._id,
    });
    workflowResult = {
      quote,
      billing: null,
      reservations: [],
      subscriptions: [],
      subscriptionRevisions: [],
    };
    const createdQuote = await quoteQuery(workflowResult.quote._id);

    logger.info("Quotation created", {
      "event.name": "quote.created",
      "event.outcome": "success",
      "request.id": req.requestId,
      "quote.id": String(quote._id),
      "quote.negotiation.id": revision.negotiation_id,
      "quote.version": revision.quote_version,
      "quote.customer.id": String(quote.customer),
      "quote.risk": createdQuote.risk,
      "quote.risk.discount_percentage": riskEvaluation.discount_percentage,
      "quote.risk.line_item_rule_triggered":
        riskEvaluation.line_item_rule_triggered,
      "quote.risk.medium_threshold": riskEvaluation.medium_risk_threshold,
      "quote.risk.high_threshold": riskEvaluation.high_risk_threshold,
      "quote.status": createdQuote.status,
      "quote.product.count": createdQuote.products.length,
      "quote.subscription.count":
        workflowResult.subscriptions?.length ?? 0,
      "quote.inventory.reservation.count":
        workflowResult.reservations?.length ?? 0,
      "quote.price.cost": createdQuote.cost_price,
      "quote.price.discounted": createdQuote.discounted_price,
      "quote.price.selling": createdQuote.selling_price,
      "billing.id": workflowResult.billing
        ? String(workflowResult.billing._id)
        : null,
      "billing.invoice.id": workflowResult.billing?.invoice_id ?? null,
      "billing.invoice.number": workflowResult.billing?.invoice_number ?? null,
      "billing.invoice.object_key":
        workflowResult.billing?.invoice_object_key ?? null,
      "billing.final_amount": workflowResult.billing?.final_amt ?? null,
    });

    res.status(201).json({
      quote: createdQuote,
      revision: revision.toObject(),
      billing: workflowResult.billing?.toObject() ?? null,
    });
  } catch (error) {
    if (workflowResult?.reservations?.length) {
      await releaseInventoryReservations(workflowResult.reservations);
    }
    await Promise.allSettled([
      workflowResult?.billing?._id
        ? deleteBillingInvoice(workflowResult.billing)
        : Promise.resolve(),
      workflowResult?.subscriptionRevisions?.length
        ? SubscriptionRevisionHistory.deleteMany({
            _id: {
              $in: workflowResult.subscriptionRevisions.map(
                (subscriptionRevision) => subscriptionRevision._id,
              ),
            },
          })
        : Promise.resolve(),
      workflowResult?.subscriptions?.length
        ? SubscriptionDetails.deleteMany({
            _id: {
              $in: workflowResult.subscriptions.map(
                (subscription) => subscription._id,
              ),
            },
          })
        : Promise.resolve(),
      revision?._id
        ? QuoteRevisionHistory.deleteOne({ _id: revision._id })
        : Promise.resolve(),
      quote?._id ? Quote.deleteOne({ _id: quote._id }) : Promise.resolve(),
    ]);
    throw error;
  }
}

export async function updateQuotation(req, res) {
  requireDatabase();
  const body = requireObject(req.body);
  const { quote_id: quoteId, expected_version: expectedVersion } = body;

  if (!mongoose.isObjectIdOrHexString(quoteId)) {
    throw new ApiError(
      400,
      "INVALID_QUOTE_ID",
      "quote_id must be a valid MongoDB ObjectId",
    );
  }

  if (
    expectedVersion !== undefined &&
    (!Number.isInteger(expectedVersion) || expectedVersion < 1)
  ) {
    throw new ApiError(
      400,
      "INVALID_QUOTE_VERSION",
      "expected_version must be a positive integer",
    );
  }

  let updates;
  if (body.updates !== undefined) {
    rejectUnknownFields(body, ["quote_id", "expected_version", "updates"]);
    updates = requireObject(body.updates, "updates must be a JSON object");
  } else {
    updates = Object.fromEntries(
      Object.entries(body).filter(
        ([field]) => !["quote_id", "expected_version"].includes(field),
      ),
    );
  }
  rejectUnknownFields(updates, QUOTE_INPUT_FIELDS);

  if (Object.keys(updates).length === 0) {
    throw new ApiError(
      400,
      "EMPTY_UPDATE",
      "At least one quotation field must be provided",
    );
  }

  const [currentQuote, currentRevision] = await Promise.all([
    Quote.findById(quoteId).lean(),
    revisionForQuote(quoteId),
  ]);

  if (!currentQuote) {
    throw new ApiError(404, "QUOTE_NOT_FOUND", "Quotation not found");
  }
  if (!currentQuote.is_latest_quote) {
    throw new ApiError(
      409,
      "QUOTE_VERSION_CONFLICT",
      "The quotation is not the latest revision",
    );
  }
  if (!currentRevision) {
    throw new ApiError(
      409,
      "QUOTE_REVISION_MISSING",
      "The quotation does not have revision history",
    );
  }
  if (
    expectedVersion !== undefined &&
    expectedVersion !== currentRevision.quote_version
  ) {
    throw new ApiError(
      409,
      "QUOTE_VERSION_CONFLICT",
      "The quotation changed. Reload and retry.",
      { current_version: currentRevision.quote_version },
    );
  }

  const latestRevision = await QuoteRevisionHistory.findOne({
    negotiation_id: currentRevision.negotiation_id,
  })
    .sort({ quote_version: -1 })
    .lean();

  if (
    !latestRevision ||
    String(latestRevision.quote_id) !== String(currentQuote._id)
  ) {
    throw new ApiError(
      409,
      "QUOTE_VERSION_CONFLICT",
      "The quotation is not the latest revision",
    );
  }

  const nextIntent = rejectedRevisionAsDraft({
    ...quoteIntentFromSnapshot(currentQuote),
    ...updates,
  });
  const inventoryCredits =
    currentQuote.status === "NEGOTIATION"
      ? inventoryByArticle(currentQuote.products)
      : new Map();
  const {
    risk_evaluation: riskEvaluation,
    ...pricedNextValues
  } = await priceQuotation(nextIntent, { inventoryCredits });
  const nextValues = applyUpdateRiskWorkflow(pricedNextValues);

  const acquired = await Quote.updateOne(
    { _id: currentQuote._id, is_latest_quote: true },
    { $set: { is_latest_quote: false } },
  );
  if (acquired.modifiedCount !== 1) {
    throw new ApiError(
      409,
      "QUOTE_VERSION_CONFLICT",
      "The quotation changed. Reload and retry.",
    );
  }

  let newQuote;
  let newRevision;
  let workflowResult;
  let releasedInventory = [];
  let customerTierResult = null;
  try {
    newQuote = await Quote.create({
      ...nextValues,
      customer_total_price_applied:
        currentQuote.customer_total_price_applied === true,
      is_latest_quote: true,
    });
    newRevision = await QuoteRevisionHistory.create({
      quote_version: latestRevision.quote_version + 1,
      negotiation_id: currentRevision.negotiation_id,
      quote_id: newQuote._id,
    });
    workflowResult = {
      quote: newQuote,
      billing: null,
      reservations: [],
      subscriptions: [],
      subscriptionRevisions: [],
    };

    // A negotiation may create any number of immutable quote revisions. The
    // invoice shown after confirmation must belong to the final revision, not
    // only to the revision that originally entered negotiation.
    if (workflowResult.quote.status === "COMPLETED") {
      workflowResult.billing = await createBillingInvoice(newQuote._id);
    }

    if (
      currentQuote.status === "NEGOTIATION" &&
      workflowResult.quote.status !== "NEGOTIATION"
    ) {
      releasedInventory = await releaseQuoteInventory(
        currentQuote.products,
        currentQuote.fulfillment_details,
      );
    }

    const updatedQuote = await quoteQuery(workflowResult.quote._id);
    customerTierResult = await applyCompletedQuoteToCustomer(
      workflowResult.quote,
    );
    if (customerTierResult && updatedQuote.customer?._custom_json) {
      updatedQuote.customer._custom_json.tier = customerTierResult.tier;
      updatedQuote.customer._custom_json.total_price =
        customerTierResult.total_price;
      updatedQuote.customer_total_price_applied = true;
    }

    logger.info("Quotation revision created", {
      "event.name": "quote.revision.created",
      "event.outcome": "success",
      "request.id": req.requestId,
      "quote.previous.id": String(currentQuote._id),
      "quote.id": String(newQuote._id),
      "quote.negotiation.id": newRevision.negotiation_id,
      "quote.version": newRevision.quote_version,
      "quote.previous.status": currentQuote.status,
      "quote.requested.status": updates.status,
      "quote.status": updatedQuote.status,
      "quote.risk": updatedQuote.risk,
      "quote.risk.discount_percentage": riskEvaluation.discount_percentage,
      "quote.risk.line_item_rule_triggered":
        riskEvaluation.line_item_rule_triggered,
      "quote.risk.medium_threshold": riskEvaluation.medium_risk_threshold,
      "quote.risk.high_threshold": riskEvaluation.high_risk_threshold,
      "quote.updated_fields": Object.keys(updates),
      "quote.product.count": updatedQuote.products.length,
      "quote.inventory.reservation.count":
        workflowResult.reservations?.length ?? 0,
      "quote.inventory.release.count": releasedInventory.length,
      "quote.price.cost": updatedQuote.cost_price,
      "quote.price.discounted": updatedQuote.discounted_price,
      "quote.price.selling": updatedQuote.selling_price,
      "billing.invoice.id": workflowResult.billing?.invoice_id ?? null,
      "billing.invoice.number": workflowResult.billing?.invoice_number ?? null,
      "billing.invoice.object_key":
        workflowResult.billing?.invoice_object_key ?? null,
      "billing.final_amount": workflowResult.billing?.final_amt ?? null,
      "customer.total_price.credited":
        customerTierResult?.completed_quote_price ?? 0,
      "customer.total_price": customerTierResult?.total_price,
      "customer.tier.previous": customerTierResult?.previous_tier,
      "customer.tier": customerTierResult?.tier,
      "customer.tier.promoted": customerTierResult?.promoted ?? false,
    });

    res.json({
      quote: updatedQuote,
      revision: newRevision.toObject(),
      billing: workflowResult.billing?.toObject() ?? null,
      customer_tier: customerTierResult,
    });
  } catch (error) {
    if (customerTierResult) throw error;

    if (releasedInventory.length > 0) {
      await restoreReleasedInventory(releasedInventory);
    }
    if (workflowResult?.reservations?.length) {
      await releaseInventoryReservations(workflowResult.reservations);
    }
    await Promise.allSettled([
      workflowResult?.billing?._id
        ? deleteBillingInvoice(workflowResult.billing)
        : Promise.resolve(),
      workflowResult?.subscriptionRevisions?.length
        ? SubscriptionRevisionHistory.deleteMany({
            _id: {
              $in: workflowResult.subscriptionRevisions.map(
                (subscriptionRevision) => subscriptionRevision._id,
              ),
            },
          })
        : Promise.resolve(),
      workflowResult?.subscriptions?.length
        ? SubscriptionDetails.deleteMany({
            _id: {
              $in: workflowResult.subscriptions.map(
                (subscription) => subscription._id,
              ),
            },
          })
        : Promise.resolve(),
      newRevision?._id
        ? QuoteRevisionHistory.deleteOne({ _id: newRevision._id })
        : Promise.resolve(),
      newQuote?._id ? Quote.deleteOne({ _id: newQuote._id }) : Promise.resolve(),
    ]);
    await Quote.updateOne(
      { _id: currentQuote._id },
      { $set: { is_latest_quote: true } },
    );
    throw error;
  }
}

export async function startQuoteNegotiation(req, res) {
  requireDatabase();
  const body = requireObject(req.body);
  rejectUnknownFields(body, ["quote_id"]);

  const quoteId = body.quote_id;
  if (!mongoose.isObjectIdOrHexString(quoteId)) {
    throw new ApiError(
      400,
      "INVALID_QUOTE_ID",
      "quote_id must be a valid MongoDB ObjectId",
    );
  }

  const quote = await Quote.findById(quoteId).lean();
  if (!quote) {
    throw new ApiError(404, "QUOTE_NOT_FOUND", "Quotation not found");
  }
  if (!quote.is_latest_quote) {
    throw new ApiError(
      409,
      "QUOTE_VERSION_CONFLICT",
      "Only the latest quotation revision can enter negotiation",
    );
  }

  if (quote.status === "NEGOTIATION") {
    const billing = await createBillingInvoice(quote._id);
    res.json({
      quote: await quoteQuery(quote._id),
      billing: billing.toObject(),
      created_subscriptions: 0,
    });
    return;
  }

  if (quote.status !== "APPROVED") {
    throw new ApiError(
      409,
      "QUOTE_NOT_READY_FOR_NEGOTIATION",
      "Only an approved quotation can enter negotiation",
      { current_status: quote.status },
    );
  }

  const physicalProducts = quote.products.filter(
    (product) => product.category !== "SUBSCRIPTION",
  );
  const fulfillmentDetails = quote.fulfillment_details ?? [];
  const fulfillmentComplete =
    physicalProducts.every((product) => Boolean(product.store_id)) &&
    fulfillmentDetails.length === physicalProducts.length;

  if (physicalProducts.length > 0 && !fulfillmentComplete) {
    throw new ApiError(
      409,
      "FULFILLMENT_REQUIRED",
      "Save a warehouse allocation for every physical product before starting negotiation",
      {
        physical_product_count: physicalProducts.length,
        fulfillment_count: fulfillmentDetails.length,
      },
    );
  }

  const workflowResult = await advanceApprovedQuoteToNegotiation(quote);
  const negotiationQuote = await quoteQuery(workflowResult.quote._id);

  logger.info("Quotation entered customer negotiation", {
    "event.name": "quote.negotiation.started",
    "event.outcome": "success",
    "request.id": req.requestId,
    "quote.id": String(quote._id),
    "quote.status": negotiationQuote.status,
    "quote.fulfillment.count": fulfillmentDetails.length,
    "quote.subscription.count": workflowResult.subscriptions.length,
    "quote.inventory.reservation.count": workflowResult.reservations.length,
    "billing.invoice.id": workflowResult.billing?.invoice_id ?? null,
    "billing.invoice.number": workflowResult.billing?.invoice_number ?? null,
  });

  res.json({
    quote: negotiationQuote,
    billing: workflowResult.billing?.toObject() ?? null,
    created_subscriptions: workflowResult.subscriptions.length,
  });
}

export async function confirmCustomerQuote(req, res) {
  requireDatabase();
  const body = requireObject(req.body);
  rejectUnknownFields(body, ["quote_id", "customer_id"]);

  const quoteId = body.quote_id;
  const customerId = body.customer_id;
  if (!mongoose.isObjectIdOrHexString(quoteId)) {
    throw new ApiError(
      400,
      "INVALID_QUOTE_ID",
      "quote_id must be a valid MongoDB ObjectId",
    );
  }
  if (!mongoose.isObjectIdOrHexString(customerId)) {
    throw new ApiError(
      400,
      "INVALID_CUSTOMER_ID",
      "customer_id must be a valid MongoDB ObjectId",
    );
  }

  let quote = await Quote.findOne({
    _id: quoteId,
    customer: String(customerId),
  }).lean();
  if (!quote) {
    throw new ApiError(404, "QUOTE_NOT_FOUND", "Quotation not found");
  }
  if (!quote.is_latest_quote) {
    throw new ApiError(
      409,
      "QUOTE_VERSION_CONFLICT",
      "Only the latest quotation revision can be confirmed",
    );
  }
  if (!["NEGOTIATION", "COMPLETED"].includes(quote.status)) {
    throw new ApiError(
      409,
      "QUOTE_NOT_CONFIRMABLE",
      "Only a quotation in NEGOTIATION can be confirmed",
      { current_status: quote.status },
    );
  }

  let releasedInventory = [];
  let transitioned = false;
  if (quote.status === "NEGOTIATION") {
    const completedQuote = await Quote.findOneAndUpdate(
      {
        _id: quote._id,
        customer: String(customerId),
        is_latest_quote: true,
        status: "NEGOTIATION",
      },
      { $set: { status: "COMPLETED" } },
      { returnDocument: "after", runValidators: true },
    );

    if (!completedQuote) {
      quote = await Quote.findOne({
        _id: quote._id,
        customer: String(customerId),
        is_latest_quote: true,
      }).lean();
      if (!quote || quote.status !== "COMPLETED") {
        throw new ApiError(
          409,
          "QUOTE_VERSION_CONFLICT",
          "The quotation changed while it was being confirmed",
        );
      }
    } else {
      quote = completedQuote;
      transitioned = true;
      try {
        releasedInventory = await releaseQuoteInventory(
          quote.products,
          quote.fulfillment_details,
        );
      } catch (error) {
        const rollback = await Quote.updateOne(
          {
            _id: quote._id,
            status: "COMPLETED",
            customer_total_price_applied: { $ne: true },
          },
          { $set: { status: "NEGOTIATION" } },
        );
        if (rollback.modifiedCount !== 1) {
          logger.error(
            "Quotation confirmation status rollback failed",
            {
              "event.name": "quote.customer_confirmation.rollback.failed",
              "event.outcome": "failure",
              "request.id": req.requestId,
              "quote.id": String(quote._id),
              "quote.customer.id": String(customerId),
            },
            error,
          );
        }
        throw error;
      }
    }
  }

  const customerTierResult = await applyCompletedQuoteToCustomer(quote);
  const confirmedQuote = await quoteQuery(quote._id);

  logger.info("Customer confirmed quotation", {
    "event.name": "quote.customer_confirmation.completed",
    "event.outcome": "success",
    "request.id": req.requestId,
    "quote.id": String(quote._id),
    "quote.customer.id": String(customerId),
    "quote.status": confirmedQuote.status,
    "quote.confirmation.transitioned": transitioned,
    "quote.inventory.release.count": releasedInventory.length,
    "customer.total_price.credited":
      customerTierResult?.completed_quote_price ?? 0,
    "customer.total_price": customerTierResult?.total_price,
    "customer.tier.previous": customerTierResult?.previous_tier,
    "customer.tier": customerTierResult?.tier,
    "customer.tier.promoted": customerTierResult?.promoted ?? false,
  });

  res.json({
    quote: confirmedQuote,
    customer_tier: customerTierResult,
  });
}

export { ApiError };
