import mongoose from "mongoose";
import { createLogger } from "@app/observability";
import {
  appendReportingHsn,
  Article,
  CategoryDiscount,
  Hsn,
  ITEM_CATEGORIES,
  Item,
  Quote,
  Store,
} from "../models.js";

const logger = createLogger("night-sky.product-controller", {
  "service.component": "product-controller",
});

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
const CATEGORY_DISCOUNT_FIELDS = Object.freeze({
  HARDWARE: "hardware",
  SERVICES: "service",
  SUBSCRIPTION: "subscription",
});

function sendDatabaseUnavailable(res) {
  res.status(503).json({
    code: "DATABASE_UNAVAILABLE",
    message: "The product database is not ready",
  });
}

function isDatabaseReady() {
  return mongoose.connection.readyState === 1;
}

function productQuery(itemId) {
  return Item.findById(itemId).populate("all_identifiers").lean();
}

function parsePositiveInteger(value, fallback, maximum) {
  if (value === undefined || value === "") return fallback;

  const parsed = Number(value);
  if (
    !Number.isInteger(parsed) ||
    parsed < 1 ||
    (maximum !== undefined && parsed > maximum)
  ) {
    return null;
  }

  return parsed;
}

export async function getQuoteInventory(req, res) {
  if (!isDatabaseReady()) {
    sendDatabaseUnavailable(res);
    return;
  }

  const { quote_id: quoteId } = req.params;
  if (!mongoose.isObjectIdOrHexString(quoteId)) {
    res.status(400).json({
      code: "INVALID_QUOTE_ID",
      message: "quote_id must be a valid MongoDB ObjectId",
    });
    return;
  }

  const page = parsePositiveInteger(req.query.page, DEFAULT_PAGE);
  const limit = parsePositiveInteger(req.query.limit, DEFAULT_LIMIT, MAX_LIMIT);
  if (page === null || limit === null) {
    res.status(400).json({
      code: "INVALID_PAGINATION",
      message: "page must be a positive integer and limit must be between 1 and 100",
    });
    return;
  }

  const unsupportedQueryFields = Object.keys(req.query).filter(
    (field) => !["page", "limit"].includes(field),
  );
  if (unsupportedQueryFields.length > 0) {
    res.status(400).json({
      code: "INVALID_FILTER",
      message: `Unsupported query field(s): ${unsupportedQueryFields.join(", ")}`,
    });
    return;
  }

  const quote = await Quote.findById(quoteId)
    .select("products.article_id products.inv products.store_id")
    .populate("products.store_id")
    .lean();

  if (!quote) {
    res.status(404).json({
      code: "QUOTE_NOT_FOUND",
      message: "Quotation not found",
    });
    return;
  }

  const quotedProducts = quote.products ?? [];
  const total = quotedProducts.length;
  const selectedProducts = quotedProducts.slice(
    (page - 1) * limit,
    page * limit,
  );
  const articles = await Article.find({
    _id: { $in: selectedProducts.map((product) => product.article_id) },
  })
    .populate("store_id")
    .lean();
  const articleById = new Map(
    articles.map((article) => [String(article._id), article]),
  );
  const missingArticleIds = selectedProducts
    .filter((product) => !articleById.has(String(product.article_id)))
    .map((product) => String(product.article_id));

  if (missingArticleIds.length > 0) {
    res.status(409).json({
      code: "QUOTE_ARTICLE_NOT_FOUND",
      message: "One or more quotation articles no longer exist",
      article_ids: [...new Set(missingArticleIds)],
    });
    return;
  }

  res.json({
    quote_id: String(quote._id),
    articles: selectedProducts.map((product) => ({
      ...articleById.get(String(product.article_id)),
      store_id:
        product.store_id ??
        articleById.get(String(product.article_id)).store_id,
      inv: product.inv,
    })),
    pagination: {
      page,
      limit,
      total,
      total_pages: Math.ceil(total / limit),
    },
  });
}

function positiveInteger(value, fallback, name, maximum) {
  if (value === undefined || value === "") return fallback;
  const parsed = Number(value);
  if (
    !Number.isInteger(parsed) ||
    parsed < 1 ||
    (maximum !== undefined && parsed > maximum)
  ) {
    throw Object.assign(
      new Error(
        `${name} must be a positive integer${maximum ? ` up to ${maximum}` : ""}`,
      ),
      { status: 400, code: "INVALID_PAGINATION" },
    );
  }
  return parsed;
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function parseProductListQuery(query) {
  const page = positiveInteger(query.page, DEFAULT_PAGE, "page");
  const limit = positiveInteger(query.limit, DEFAULT_LIMIT, "limit", MAX_LIMIT);
  const filter = {};

  if (query.category) {
    const category = String(query.category).trim().toUpperCase();
    if (!ITEM_CATEGORIES.includes(category)) {
      throw Object.assign(
        new Error(`category must be one of: ${ITEM_CATEGORIES.join(", ")}`),
        { status: 400, code: "INVALID_CATEGORY" },
      );
    }
    filter.categories = category;
  }

  if (query.search) {
    const search = String(query.search).trim();
    if (search.length > 100) {
      throw Object.assign(new Error("search must contain at most 100 characters"), {
        status: 400,
        code: "INVALID_SEARCH",
      });
    }
    if (search) filter.name = { $regex: escapeRegex(search), $options: "i" };
  }

  return { filter, page, limit };
}

export async function getProducts(req, res) {
  if (!isDatabaseReady()) {
    sendDatabaseUnavailable(res);
    return;
  }

  const { filter, page, limit } = parseProductListQuery(req.query);
  const [products, total] = await Promise.all([
    Item.find(filter)
      .sort({ name: 1, _id: 1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .populate("all_identifiers")
      .lean(),
    Item.countDocuments(filter),
  ]);

  res.json({
    products,
    pagination: {
      page,
      limit,
      total,
      total_pages: Math.ceil(total / limit),
    },
  });
}

export async function getProduct(req, res) {
  if (!isDatabaseReady()) {
    sendDatabaseUnavailable(res);
    return;
  }

  if (!mongoose.isObjectIdOrHexString(req.params.item_id)) {
    res.status(400).json({
      code: "INVALID_ITEM_ID",
      message: "item_id must be a valid MongoDB ObjectId",
    });
    return;
  }

  const [product, categoryDiscount] = await Promise.all([
    productQuery(req.params.item_id),
    CategoryDiscount.findOne()
      .sort({ updatedAt: -1, _id: -1 })
      .lean(),
  ]);

  if (!product) {
    res.status(404).json({
      code: "PRODUCT_NOT_FOUND",
      message: "Product not found",
    });
    return;
  }

  const categoryDiscountField = CATEGORY_DISCOUNT_FIELDS[product.categories[0]];
  const applicableCategoryDiscount =
    categoryDiscount && categoryDiscountField
      ? categoryDiscount[categoryDiscountField]
      : null;

  res.json({
    product: {
      ...product,
      category_discount: applicableCategoryDiscount,
    },
  });
}

export async function createHsn(req, res) {
  if (!isDatabaseReady()) {
    sendDatabaseUnavailable(res);
    return;
  }

  if (!req.body || Array.isArray(req.body) || typeof req.body !== "object") {
    res.status(400).json({
      code: "INVALID_REQUEST_BODY",
      message: "The request body must be a JSON object",
    });
    return;
  }

  const { hsn_code, gst } = req.body;

  if (typeof hsn_code !== "string" || hsn_code.trim().length === 0) {
    res.status(400).json({
      code: "INVALID_HSN_CODE",
      message: "hsn_code must be a non-empty string",
    });
    return;
  }

  if (typeof gst !== "number" || !Number.isFinite(gst) || gst < 0) {
    res.status(400).json({
      code: "INVALID_GST",
      message: "gst must be a non-negative number",
    });
    return;
  }

  const reportingHsn = await appendReportingHsn(hsn_code, gst);

  logger.info("Reporting HSN entry created", {
    "event.name": "catalog.reporting_hsn.created",
    "event.outcome": "success",
    "request.id": req.requestId,
    "hsn.code": hsn_code.trim(),
    "reporting_hsn.id": String(reportingHsn._id),
    "reporting_hsn.code": reportingHsn.reporting_hsn,
    "tax.gst.percent": reportingHsn.gst,
  });

  res.status(201).json({ reporting_hsn: reportingHsn });
}

export async function createProduct(req, res) {
  if (!isDatabaseReady()) {
    sendDatabaseUnavailable(res);
    return;
  }

  if (!req.body || Array.isArray(req.body) || typeof req.body !== "object") {
    res.status(400).json({
      code: "INVALID_REQUEST_BODY",
      message: "The request body must be a JSON object",
    });
    return;
  }

  const {
    name,
    reporting_hsn,
    categories,
    cycle = null,
    articles = [],
  } = req.body;

  if (!Array.isArray(articles)) {
    res.status(400).json({
      code: "INVALID_ARTICLES",
      message: "articles must be an array",
    });
    return;
  }

  if (
    !articles.every(
      (article) =>
        article && typeof article === "object" && !Array.isArray(article),
    )
  ) {
    res.status(400).json({
      code: "INVALID_ARTICLES",
      message: "Every article must be a JSON object",
    });
    return;
  }

  if (typeof reporting_hsn !== "string" || reporting_hsn.trim().length === 0) {
    res.status(400).json({
      code: "INVALID_REPORTING_HSN",
      message: "reporting_hsn must be a non-empty string",
    });
    return;
  }

  const normalizedReportingHsn = reporting_hsn.trim();

  if (
    !(await Hsn.exists({
      "reporting_hsn.reporting_hsn": normalizedReportingHsn,
    }))
  ) {
    res.status(404).json({
      code: "REPORTING_HSN_NOT_FOUND",
      message: "The reporting_hsn does not exist",
    });
    return;
  }

  let item;

  try {
    item = await Item.create({
      name,
      reporting_hsn: normalizedReportingHsn,
      categories,
      cycle,
      all_identifiers: [],
    });

    const createdArticles = [];

    for (const article of articles) {
      createdArticles.push(
        await Article.create({
          item_id: item._id,
          seller_identifier: article.seller_identifier,
          price: article.price,
          inventory: article.inventory,
          store_id: article.store_id,
          discount: article.discount,
          restock_point: article.restock_point,
        }),
      );
    }

    item.all_identifiers = createdArticles.map((article) => article._id);
    await item.save();

    const product = await productQuery(item._id);

    logger.info("Product created", {
      "event.name": "catalog.product.created",
      "event.outcome": "success",
      "request.id": req.requestId,
      "item.id": String(item._id),
      "item.name": item.name,
      "item.categories": item.categories,
      "item.reporting_hsn": item.reporting_hsn,
      "article.count": createdArticles.length,
      "article.ids": createdArticles.map((article) => String(article._id)),
    });

    res.status(201).json({ product });
  } catch (error) {
    if (item?._id) {
      await Promise.allSettled([
        Article.deleteMany({ item_id: item._id }),
        Item.deleteOne({ _id: item._id }),
      ]);
    }

    throw error;
  }
}

export async function addInventory(req, res) {
  if (!isDatabaseReady()) {
    sendDatabaseUnavailable(res);
    return;
  }

  if (!req.body || Array.isArray(req.body) || typeof req.body !== "object") {
    res.status(400).json({
      code: "INVALID_REQUEST_BODY",
      message: "The request body must be a JSON object",
    });
    return;
  }

  const unsupportedFields = Object.keys(req.body).filter(
    (field) => !["article_id", "store_id", "inventory"].includes(field),
  );
  if (unsupportedFields.length > 0) {
    res.status(400).json({
      code: "UNKNOWN_FIELDS",
      message: `Unsupported field(s): ${unsupportedFields.join(", ")}`,
    });
    return;
  }

  const {
    article_id: articleId,
    store_id: requestedStoreId,
    inventory,
  } = req.body;
  if (!mongoose.isObjectIdOrHexString(articleId)) {
    res.status(400).json({
      code: "INVALID_ARTICLE_ID",
      message: "article_id must be a valid MongoDB ObjectId",
    });
    return;
  }

  if (!inventory || Array.isArray(inventory) || typeof inventory !== "object") {
    res.status(400).json({
      code: "INVALID_INVENTORY",
      message: "inventory must be a JSON object",
    });
    return;
  }

  const unsupportedInventoryFields = Object.keys(inventory).filter(
    (field) => !["sellable", "reserved"].includes(field),
  );
  if (unsupportedInventoryFields.length > 0) {
    res.status(400).json({
      code: "UNKNOWN_INVENTORY_FIELDS",
      message: `Unsupported inventory field(s): ${unsupportedInventoryFields.join(", ")}`,
    });
    return;
  }

  const increments = {};
  for (const field of ["sellable", "reserved"]) {
    if (inventory[field] === undefined) continue;

    if (!Number.isInteger(inventory[field]) || inventory[field] < 0) {
      res.status(400).json({
        code: "INVALID_INVENTORY",
        message: `inventory.${field} must be a non-negative integer`,
      });
      return;
    }

    if (inventory[field] > 0) {
      increments[`inventory.${field}`] = inventory[field];
    }
  }

  if (Object.keys(increments).length === 0) {
    res.status(400).json({
      code: "INVALID_INVENTORY",
      message: "At least one inventory amount must be greater than 0",
    });
    return;
  }

  const existingArticle = await Article.findById(articleId)
    .select("item_id store_id")
    .lean();

  if (!existingArticle) {
    res.status(404).json({
      code: "ARTICLE_NOT_FOUND",
      message: "Article not found",
    });
    return;
  }

  const item = await Item.findById(existingArticle.item_id)
    .select("categories")
    .lean();
  if (!item) {
    res.status(409).json({
      code: "ITEM_NOT_FOUND",
      message: "The article does not reference an existing item",
    });
    return;
  }

  if (item.categories.includes("SUBSCRIPTION")) {
    res.status(409).json({
      code: "SUBSCRIPTION_INVENTORY_NOT_SUPPORTED",
      message: "Subscription products do not track store inventory",
    });
    return;
  }

  let storeId = existingArticle.store_id;
  if (!storeId) {
    if (!mongoose.isObjectIdOrHexString(requestedStoreId)) {
      res.status(400).json({
        code: "STORE_REQUIRED",
        message: "store_id is required when inventory is added for the first time",
      });
      return;
    }

    if (!(await Store.exists({ _id: requestedStoreId }))) {
      res.status(404).json({
        code: "STORE_NOT_FOUND",
        message: "Store not found",
      });
      return;
    }
    storeId = requestedStoreId;
  } else if (
    requestedStoreId !== undefined &&
    String(storeId) !== String(requestedStoreId)
  ) {
    res.status(409).json({
      code: "ARTICLE_STORE_MISMATCH",
      message: "Inventory for this article belongs to a different store",
    });
    return;
  }

  const update = { $inc: increments };
  const filter = { _id: articleId };
  if (!existingArticle.store_id) {
    filter.store_id = null;
    update.$set = { store_id: storeId };
  }

  const article = await Article.findOneAndUpdate(filter, update, {
    returnDocument: "after",
  }).populate("store_id");

  if (!article) {
    res.status(409).json({
      code: "INVENTORY_UPDATE_CONFLICT",
      message: "The article changed while inventory was being added",
    });
    return;
  }

  logger.info("Article inventory added", {
    "event.name": "catalog.inventory.added",
    "event.outcome": "success",
    "request.id": req.requestId,
    "item.id": String(existingArticle.item_id),
    "article.id": String(article._id),
    "store.id": String(article.store_id?._id ?? article.store_id),
    "inventory.added.sellable": increments["inventory.sellable"] ?? 0,
    "inventory.added.reserved": increments["inventory.reserved"] ?? 0,
    "inventory.current.sellable": article.inventory.sellable,
    "inventory.current.reserved": article.inventory.reserved,
  });

  res.json({ article });
}
