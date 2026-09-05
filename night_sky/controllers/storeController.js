import mongoose from "mongoose";
import { Article, Store } from "../models.js";

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
      store_id: { $gt: 0 },
    })
      .select("item_id store_id")
      .lean();

    for (const article of articles) {
      const storeItemIds = itemIdsByStore.get(article.store_id) ?? new Set();
      storeItemIds.add(String(article.item_id));
      itemIdsByStore.set(article.store_id, storeItemIds);
    }
  }

  const storeFilter =
    itemIds.length === 0 ? {} : { _id: { $in: [...itemIdsByStore.keys()] } };
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
        ? { item_ids: [...itemIdsByStore.get(store._id)] }
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
