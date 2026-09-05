import mongoose from "mongoose";
import { logger } from "@app/observability";
import { appendReportingHsn, Article, Hsn, Item } from "../models.js";

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

  const product = await productQuery(req.params.item_id);

  if (!product) {
    res.status(404).json({
      code: "PRODUCT_NOT_FOUND",
      message: "Product not found",
    });
    return;
  }

  res.json({ product });
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
      item_id: String(item._id),
      article_count: createdArticles.length,
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
