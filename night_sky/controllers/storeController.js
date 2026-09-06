import mongoose from "mongoose";
import { getDistance } from "geolib";
import { createLogger } from "@app/observability";
import {
  Article,
  Quote,
  resolveLatestReportingHsns,
  Store,
  User,
} from "../models.js";

const logger = createLogger("night-sky.store-controller", {
  "service.component": "store-controller",
});

function parseItemIds(value) {
  const values = Array.isArray(value) ? value : [value];

  return [
    ...new Set(
      values
        .flatMap((itemIds) => String(itemIds ?? "").split(","))
        .map((itemId) => itemId.trim())
        .filter(Boolean),
    ),
  ];
}

function parsePagination(query) {
  const page = query.page === undefined ? 1 : Number(query.page);
  const limit = query.limit === undefined ? 20 : Number(query.limit);

  if (
    !Number.isInteger(page) ||
    page < 1 ||
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > 100
  ) {
    return null;
  }

  return { page, limit };
}

function isCoordinate(value, minimum, maximum) {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= minimum &&
    value <= maximum
  );
}

function distanceFromCustomer(customer, store) {
  return getDistance(
    {
      latitude: customer._custom_json.lat,
      longitude: customer._custom_json.long,
    },
    { latitude: store.lat, longitude: store.long },
  );
}

export async function createStore(req, res) {
  if (mongoose.connection.readyState !== 1) {
    res.status(503).json({
      code: "DATABASE_UNAVAILABLE",
      message: "The store database is not ready",
    });
    return;
  }

  if (!req.body || typeof req.body !== "object" || Array.isArray(req.body)) {
    res.status(400).json({
      code: "INVALID_REQUEST_BODY",
      message: "The request body must be a JSON object",
    });
    return;
  }

  const unsupportedFields = Object.keys(req.body).filter(
    (field) => !["name", "lat", "long"].includes(field),
  );
  if (unsupportedFields.length > 0) {
    res.status(400).json({
      code: "UNKNOWN_FIELDS",
      message: `Unsupported field(s): ${unsupportedFields.join(", ")}`,
    });
    return;
  }

  const { name, lat, long } = req.body;
  if (typeof name !== "string" || name.trim().length === 0) {
    res.status(400).json({
      code: "INVALID_STORE_NAME",
      message: "name must be a non-empty string",
    });
    return;
  }

  if (!isCoordinate(lat, -90, 90)) {
    res.status(400).json({
      code: "INVALID_LATITUDE",
      message: "lat must be a number between -90 and 90",
    });
    return;
  }

  if (!isCoordinate(long, -180, 180)) {
    res.status(400).json({
      code: "INVALID_LONGITUDE",
      message: "long must be a number between -180 and 180",
    });
    return;
  }

  const store = await Store.create({
    name: name.trim(),
    lat,
    long,
  });

  logger.info("Store created", {
    "event.name": "catalog.store.created",
    "event.outcome": "success",
    "request.id": req.requestId,
    "store.id": String(store._id),
    "store.name": store.name,
    "store.location.latitude": store.lat,
    "store.location.longitude": store.long,
  });
  res.status(201).json({ store });
}

export async function splitQuoteByStore(req, res) {
  if (mongoose.connection.readyState !== 1) {
    res.status(503).json({
      code: "DATABASE_UNAVAILABLE",
      message: "The store database is not ready",
    });
    return;
  }

  if (!req.body || typeof req.body !== "object" || Array.isArray(req.body)) {
    res.status(400).json({
      code: "INVALID_REQUEST_BODY",
      message: "The request body must be a JSON object",
    });
    return;
  }

  const unsupportedFields = Object.keys(req.body).filter(
    (field) => field !== "quote_id",
  );
  if (unsupportedFields.length > 0) {
    res.status(400).json({
      code: "UNKNOWN_FIELDS",
      message: `Unsupported field(s): ${unsupportedFields.join(", ")}`,
    });
    return;
  }

  const { quote_id: quoteId } = req.body;
  if (!mongoose.isObjectIdOrHexString(quoteId)) {
    res.status(400).json({
      code: "INVALID_QUOTE_ID",
      message: "quote_id must be a valid MongoDB ObjectId",
    });
    return;
  }

  const quote = await Quote.findById(quoteId).lean();
  if (!quote) {
    res.status(404).json({
      code: "QUOTE_NOT_FOUND",
      message: "Quotation not found",
    });
    return;
  }

  if (!quote.is_latest_quote) {
    res.status(409).json({
      code: "QUOTE_VERSION_CONFLICT",
      message: "Store allocation can only be performed on the latest quotation",
    });
    return;
  }

  const customer = await User.findOne({
    _id: quote.customer,
    is_deleted: { $ne: true },
  })
    .select("_custom_json.lat _custom_json.long")
    .lean();
  const latitude = customer?._custom_json?.lat;
  const longitude = customer?._custom_json?.long;

  if (
    !customer ||
    !isCoordinate(latitude, -90, 90) ||
    !isCoordinate(longitude, -180, 180)
  ) {
    res.status(409).json({
      code: "CUSTOMER_LOCATION_MISSING",
      message: "The quotation customer must have valid delivery coordinates",
    });
    return;
  }

  const physicalProducts = quote.products
    .map((product, productIndex) => ({ product, productIndex }))
    .filter(({ product }) => product.category !== "SUBSCRIPTION");
  const itemIds = [
    ...new Set(physicalProducts.map(({ product }) => String(product.item_id))),
  ];
  const candidateArticles = await Article.find({
    item_id: { $in: itemIds },
    store_id: { $ne: null },
  })
    .select("item_id seller_identifier inventory store_id")
    .populate("store_id")
    .lean();
  const candidatesByItem = new Map();

  for (const article of candidateArticles) {
    if (
      !article.store_id ||
      !isCoordinate(article.store_id.lat, -90, 90) ||
      !isCoordinate(article.store_id.long, -180, 180)
    ) {
      continue;
    }
    const itemId = String(article.item_id);
    const candidates = candidatesByItem.get(itemId) ?? [];
    candidates.push({
      article,
      distance_meters: distanceFromCustomer(customer, article.store_id),
    });
    candidatesByItem.set(itemId, candidates);
  }

  for (const candidates of candidatesByItem.values()) {
    candidates.sort(
      (left, right) =>
        left.distance_meters - right.distance_meters ||
        String(left.article.store_id._id).localeCompare(
          String(right.article.store_id._id),
        ) ||
        String(left.article._id).localeCompare(String(right.article._id)),
    );
  }

  const allocatedInventory = new Map();
  const assignments = [];

  for (const { product, productIndex } of physicalProducts) {
    const candidates = candidatesByItem.get(String(product.item_id)) ?? [];
    const selected = candidates.find(({ article }) => {
      const allocated = allocatedInventory.get(String(article._id)) ?? 0;
      return (article.inventory?.sellable ?? 0) - allocated >= product.inv;
    });

    if (!selected) {
      const articleId = String(product.article_id);
      logger.warn("No store has enough inventory for quotation product", {
        "event.name": "quote.store_allocation.rejected",
        "event.outcome": "failure",
        "request.id": req.requestId,
        "application.error.code": "NO_ELIGIBLE_STORE",
        "quote.id": String(quote._id),
        "customer.id": String(quote.customer),
        "product.index": productIndex,
        "item.id": String(product.item_id),
        "article.id": articleId,
        "inventory.requested": product.inv,
        "store.candidate.count": candidates.length,
      });
      res.status(409).json({
        code: "NO_ELIGIBLE_STORE",
        message: `No store has enough sellable inventory for article ${articleId}`,
        product_index: productIndex,
        article_id: articleId,
        item_id: String(product.item_id),
        requested_inv: product.inv,
      });
      return;
    }

    const candidateArticleId = String(selected.article._id);
    allocatedInventory.set(
      candidateArticleId,
      (allocatedInventory.get(candidateArticleId) ?? 0) + product.inv,
    );
    assignments.push({
      product_index: productIndex,
      quoted_article_id: String(product.article_id),
      fulfillment_article_id: candidateArticleId,
      item_id: String(product.item_id),
      inv: product.inv,
      store_id: selected.article.store_id._id,
      store: selected.article.store_id,
      seller_identifier: selected.article.seller_identifier,
      distance_meters: selected.distance_meters,
    });
  }

  const assignmentByProductIndex = new Map(
    assignments.map((assignment) => [assignment.product_index, assignment]),
  );
  const products = quote.products.map((product, productIndex) => ({
    ...product,
    store_id: assignmentByProductIndex.get(productIndex)?.store_id ?? null,
  }));
  const fulfillmentDetails = assignments.map((assignment) => ({
    seller_identifier: assignment.seller_identifier,
    store: assignment.store_id,
    inv: assignment.inv,
  }));
  const updatedQuote = await Quote.findOneAndUpdate(
    {
      _id: quote._id,
      is_latest_quote: true,
      updatedAt: quote.updatedAt,
    },
    {
      $set: {
        products,
        fulfillment_details: fulfillmentDetails,
      },
    },
    { returnDocument: "after", runValidators: true },
  ).lean();

  if (!updatedQuote) {
    res.status(409).json({
      code: "QUOTE_VERSION_CONFLICT",
      message: "The quotation changed while stores were being selected",
    });
    return;
  }

  logger.info("Quotation stores allocated", {
    "event.name": "quote.store_allocation.completed",
    "event.outcome": "success",
    "request.id": req.requestId,
    "quote.id": String(quote._id),
    "customer.id": String(quote.customer),
    "product.physical.count": physicalProducts.length,
    "store.assignment.count": assignments.length,
    "store.ids": [
      ...new Set(assignments.map((entry) => String(entry.store_id))),
    ],
    "store.maximum_distance_meters": Math.max(
      0,
      ...assignments.map((entry) => entry.distance_meters),
    ),
  });

  const latestByReportingHsn = await resolveLatestReportingHsns(
    updatedQuote.products.map((product) => product.hsn),
  );
  const responseQuote = {
    ...updatedQuote,
    products: updatedQuote.products.map((product) => ({
      ...product,
      hsn:
        latestByReportingHsn.get(product.hsn)?.reporting_hsn ?? product.hsn,
    })),
  };

  res.json({
    quote: responseQuote,
    store_split: assignments.map((assignment) => ({
      product_index: assignment.product_index,
      quoted_article_id: assignment.quoted_article_id,
      fulfillment_article_id: assignment.fulfillment_article_id,
      item_id: assignment.item_id,
      inv: assignment.inv,
      store_id: String(assignment.store_id),
      store: assignment.store,
      distance_meters: assignment.distance_meters,
    })),
  });
}

export async function manuallySplitQuoteByStore(req, res) {
  if (mongoose.connection.readyState !== 1) {
    res.status(503).json({
      code: "DATABASE_UNAVAILABLE",
      message: "The store database is not ready",
    });
    return;
  }

  if (!req.body || typeof req.body !== "object" || Array.isArray(req.body)) {
    res.status(400).json({
      code: "INVALID_REQUEST_BODY",
      message: "The request body must be a JSON object",
    });
    return;
  }

  const unsupportedFields = Object.keys(req.body).filter(
    (field) => !["quote_id", "stores"].includes(field),
  );
  if (unsupportedFields.length > 0) {
    res.status(400).json({
      code: "UNKNOWN_FIELDS",
      message: `Unsupported field(s): ${unsupportedFields.join(", ")}`,
    });
    return;
  }

  const { quote_id: quoteId, stores } = req.body;
  if (!mongoose.isObjectIdOrHexString(quoteId)) {
    res.status(400).json({
      code: "INVALID_QUOTE_ID",
      message: "quote_id must be a valid MongoDB ObjectId",
    });
    return;
  }

  if (!Array.isArray(stores)) {
    res.status(400).json({
      code: "INVALID_STORES",
      message: "stores must be an array",
    });
    return;
  }

  const assignments = [];
  const assignedArticleIds = new Set();

  for (const [index, assignment] of stores.entries()) {
    if (!assignment || typeof assignment !== "object" || Array.isArray(assignment)) {
      res.status(400).json({
        code: "INVALID_STORE_ASSIGNMENT",
        message: `stores[${index}] must be a JSON object`,
      });
      return;
    }

    const unknownAssignmentFields = Object.keys(assignment).filter(
      (field) => !["article_id", "store_id"].includes(field),
    );
    if (unknownAssignmentFields.length > 0) {
      res.status(400).json({
        code: "UNKNOWN_STORE_ASSIGNMENT_FIELDS",
        message: `Unsupported field(s) in stores[${index}]: ${unknownAssignmentFields.join(", ")}`,
      });
      return;
    }

    if (!mongoose.isObjectIdOrHexString(assignment.article_id)) {
      res.status(400).json({
        code: "INVALID_ARTICLE_ID",
        message: `stores[${index}].article_id must be a valid MongoDB ObjectId`,
      });
      return;
    }
    if (!mongoose.isObjectIdOrHexString(assignment.store_id)) {
      res.status(400).json({
        code: "INVALID_STORE_ID",
        message: `stores[${index}].store_id must be a valid MongoDB ObjectId`,
      });
      return;
    }

    const articleId = String(assignment.article_id);
    if (assignedArticleIds.has(articleId)) {
      res.status(400).json({
        code: "DUPLICATE_ARTICLE_ASSIGNMENT",
        message: `Article ${articleId} has more than one store assignment`,
        article_id: articleId,
      });
      return;
    }

    assignedArticleIds.add(articleId);
    assignments.push({
      article_id: articleId,
      store_id: String(assignment.store_id),
    });
  }

  const quote = await Quote.findById(quoteId).lean();
  if (!quote) {
    res.status(404).json({
      code: "QUOTE_NOT_FOUND",
      message: "Quotation not found",
    });
    return;
  }
  if (!quote.is_latest_quote) {
    res.status(409).json({
      code: "QUOTE_VERSION_CONFLICT",
      message: "Store allocation can only be performed on the latest quotation",
    });
    return;
  }

  const physicalProducts = quote.products
    .map((product, productIndex) => ({ product, productIndex }))
    .filter(({ product }) => product.category !== "SUBSCRIPTION");
  const quoteArticleIds = new Set(
    physicalProducts.map(({ product }) => String(product.article_id)),
  );
  const assignmentByArticleId = new Map(
    assignments.map((assignment) => [assignment.article_id, assignment]),
  );
  const missingArticleIds = [...quoteArticleIds].filter(
    (articleId) => !assignmentByArticleId.has(articleId),
  );
  const unexpectedArticleIds = assignments
    .map((assignment) => assignment.article_id)
    .filter((articleId) => !quoteArticleIds.has(articleId));

  if (missingArticleIds.length > 0 || unexpectedArticleIds.length > 0) {
    res.status(400).json({
      code: "INVALID_STORE_ASSIGNMENTS",
      message: "stores must assign exactly one store to every non-subscription quote article",
      missing_article_ids: missingArticleIds,
      unexpected_article_ids: unexpectedArticleIds,
    });
    return;
  }

  const requestedStoreIds = [
    ...new Set(assignments.map((assignment) => assignment.store_id)),
  ];
  const requestedStores = await Store.find({
    _id: { $in: requestedStoreIds },
  }).lean();
  const storeById = new Map(
    requestedStores.map((store) => [String(store._id), store]),
  );
  const missingStoreIds = requestedStoreIds.filter(
    (storeId) => !storeById.has(storeId),
  );

  if (missingStoreIds.length > 0) {
    res.status(404).json({
      code: "STORE_NOT_FOUND",
      message: "One or more selected stores do not exist",
      store_ids: missingStoreIds,
    });
    return;
  }

  const itemIds = [
    ...new Set(physicalProducts.map(({ product }) => String(product.item_id))),
  ];
  const candidateArticles = await Article.find({
    item_id: { $in: itemIds },
    store_id: { $in: requestedStoreIds },
  })
    .select("item_id seller_identifier inventory store_id")
    .lean();
  const candidatesByItemAndStore = new Map();

  for (const article of candidateArticles) {
    const key = `${article.item_id}:${article.store_id}`;
    const candidates = candidatesByItemAndStore.get(key) ?? [];
    candidates.push(article);
    candidatesByItemAndStore.set(key, candidates);
  }
  for (const candidates of candidatesByItemAndStore.values()) {
    candidates.sort(
      (left, right) =>
        (right.inventory?.sellable ?? 0) -
          (left.inventory?.sellable ?? 0) ||
        String(left._id).localeCompare(String(right._id)),
    );
  }

  const allocatedInventory = new Map();
  const resolvedAssignments = [];

  for (const { product, productIndex } of physicalProducts) {
    const requestedAssignment = assignmentByArticleId.get(
      String(product.article_id),
    );
    const candidates =
      candidatesByItemAndStore.get(
        `${product.item_id}:${requestedAssignment.store_id}`,
      ) ?? [];
    const selectedArticle = candidates.find((candidate) => {
      const allocated = allocatedInventory.get(String(candidate._id)) ?? 0;
      return (candidate.inventory?.sellable ?? 0) - allocated >= product.inv;
    });

    if (!selectedArticle) {
      const availableInventory = Math.max(
        0,
        ...candidates.map((candidate) => {
          const allocated = allocatedInventory.get(String(candidate._id)) ?? 0;
          return (candidate.inventory?.sellable ?? 0) - allocated;
        }),
      );
      res.status(409).json({
        code: "NO_ELIGIBLE_STORE",
        message: `Selected store does not have enough sellable inventory for article ${product.article_id}`,
        product_index: productIndex,
        article_id: String(product.article_id),
        item_id: String(product.item_id),
        store_id: requestedAssignment.store_id,
        requested_inv: product.inv,
        available_inv: availableInventory,
      });
      return;
    }

    const fulfillmentArticleId = String(selectedArticle._id);
    allocatedInventory.set(
      fulfillmentArticleId,
      (allocatedInventory.get(fulfillmentArticleId) ?? 0) + product.inv,
    );
    resolvedAssignments.push({
      product_index: productIndex,
      quoted_article_id: String(product.article_id),
      fulfillment_article_id: fulfillmentArticleId,
      item_id: String(product.item_id),
      inv: product.inv,
      store_id: requestedAssignment.store_id,
      store: storeById.get(requestedAssignment.store_id),
      seller_identifier: selectedArticle.seller_identifier,
    });
  }

  const resolvedByProductIndex = new Map(
    resolvedAssignments.map((assignment) => [
      assignment.product_index,
      assignment,
    ]),
  );
  const products = quote.products.map((product, productIndex) => ({
    ...product,
    store_id: resolvedByProductIndex.get(productIndex)?.store_id ?? null,
  }));
  const fulfillmentDetails = resolvedAssignments.map((assignment) => ({
    seller_identifier: assignment.seller_identifier,
    store: assignment.store_id,
    inv: assignment.inv,
  }));
  const updatedQuote = await Quote.findOneAndUpdate(
    {
      _id: quote._id,
      is_latest_quote: true,
      updatedAt: quote.updatedAt,
    },
    {
      $set: {
        products,
        fulfillment_details: fulfillmentDetails,
      },
    },
    { returnDocument: "after", runValidators: true },
  ).lean();

  if (!updatedQuote) {
    res.status(409).json({
      code: "QUOTE_VERSION_CONFLICT",
      message: "The quotation changed while stores were being selected",
    });
    return;
  }

  const latestByReportingHsn = await resolveLatestReportingHsns(
    updatedQuote.products.map((product) => product.hsn),
  );
  const responseQuote = {
    ...updatedQuote,
    products: updatedQuote.products.map((product) => ({
      ...product,
      hsn:
        latestByReportingHsn.get(product.hsn)?.reporting_hsn ?? product.hsn,
    })),
  };

  logger.info("Quotation stores manually allocated", {
    "event.name": "quote.store_allocation.manual.completed",
    "event.outcome": "success",
    "request.id": req.requestId,
    "quote.id": String(quote._id),
    "quote.status": quote.status,
    "product.physical.count": physicalProducts.length,
    "store.assignment.count": resolvedAssignments.length,
    "store.ids": requestedStoreIds,
  });

  res.json({
    quote: responseQuote,
    store_split: resolvedAssignments.map((assignment) => ({
      product_index: assignment.product_index,
      quoted_article_id: assignment.quoted_article_id,
      fulfillment_article_id: assignment.fulfillment_article_id,
      item_id: assignment.item_id,
      inv: assignment.inv,
      store_id: assignment.store_id,
      store: assignment.store,
    })),
  });
}

export async function getStores(req, res) {
  if (mongoose.connection.readyState !== 1) {
    res.status(503).json({
      code: "DATABASE_UNAVAILABLE",
      message: "The store database is not ready",
    });
    return;
  }

  const itemIds = parseItemIds(req.query.item_ids);
  const pagination = parsePagination(req.query);

  if (!pagination) {
    res.status(400).json({
      code: "INVALID_PAGINATION",
      message: "page must be a positive integer and limit must be between 1 and 100",
    });
    return;
  }

  const invalidItemIds = itemIds.filter(
    (itemId) => !mongoose.isObjectIdOrHexString(itemId),
  );

  if (invalidItemIds.length > 0) {
    res.status(400).json({
      code: "INVALID_ITEM_IDS",
      message: "Every item_ids value must be a valid MongoDB ObjectId",
      invalid_item_ids: invalidItemIds,
    });
    return;
  }

  const itemIdsByStore = new Map();

  if (itemIds.length > 0) {
    const articles = await Article.find({
      item_id: { $in: itemIds },
      store_id: { $ne: null },
    })
      .select("item_id store_id")
      .lean();

    for (const article of articles) {
      const storeId = String(article.store_id);
      const storeItemIds = itemIdsByStore.get(storeId) ?? new Set();
      storeItemIds.add(String(article.item_id));
      itemIdsByStore.set(storeId, storeItemIds);
    }
  }

  const storeFilter =
    itemIds.length === 0
      ? {}
      : { _id: { $in: [...itemIdsByStore.keys()] } };
  const { page, limit } = pagination;
  const [stores, total] = await Promise.all([
    Store.find(storeFilter)
      .sort({ _id: 1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    Store.countDocuments(storeFilter),
  ]);

  res.json({
    stores: stores.map((store) => ({
      ...store,
      ...(itemIds.length > 0
        ? { item_ids: [...itemIdsByStore.get(String(store._id))] }
        : {}),
    })),
    pagination: {
      page,
      limit,
      total,
      total_pages: Math.ceil(total / limit),
    },
  });
}
