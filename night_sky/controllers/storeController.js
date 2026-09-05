import mongoose from "mongoose";
import { getDistance } from "geolib";
import { logger } from "@app/observability";
import { Article, Quote, Store, User } from "../models.js";

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

  logger.info("Store created", { store_id: String(store._id) });
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
    quote_id: String(quote._id),
    assignment_count: assignments.length,
  });

  res.json({
    quote: updatedQuote,
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
