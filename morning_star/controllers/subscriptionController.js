import mongoose from "mongoose";
import { logger } from "@app/observability";
import {
  SUBSCRIPTION_STATUSES,
  SubscriptionDetails,
  SubscriptionRevisionHistory,
} from "../models.js";

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

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
      "The subscription database is not ready",
    );
  }
}

function requireSubscriptionId(subscriptionId) {
  if (!mongoose.isObjectIdOrHexString(subscriptionId)) {
    throw new ApiError(
      400,
      "INVALID_SUBSCRIPTION_ID",
      "subscription_id must be a valid MongoDB ObjectId",
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

function subscriptionQuery(subscriptionId) {
  return SubscriptionDetails.findById(subscriptionId)
    .populate("article_id")
    .populate("item_id")
    .lean();
}

function normalizeStatus(value) {
  if (typeof value !== "string") {
    throw new ApiError(
      400,
      "INVALID_SUBSCRIPTION_STATUS",
      `status must be one of: ${SUBSCRIPTION_STATUSES.join(", ")}`,
    );
  }

  const status = value.trim().toUpperCase();
  if (!SUBSCRIPTION_STATUSES.includes(status)) {
    throw new ApiError(
      400,
      "INVALID_SUBSCRIPTION_STATUS",
      `status must be one of: ${SUBSCRIPTION_STATUSES.join(", ")}`,
    );
  }

  return status;
}

function parseBoolean(value, field) {
  if (value === true || value === "true") return true;
  if (value === false || value === "false") return false;

  throw new ApiError(400, "INVALID_FILTER", `${field} must be true or false`);
}

async function changeSubscriptionStatus(subscriptionId, status) {
  requireSubscriptionId(subscriptionId);

  const current = await SubscriptionDetails.findById(subscriptionId).lean();
  if (!current) {
    throw new ApiError(
      404,
      "SUBSCRIPTION_NOT_FOUND",
      "Subscription not found",
    );
  }

  if (!current.is_latest) {
    throw new ApiError(
      409,
      "SUBSCRIPTION_VERSION_CONFLICT",
      "Only the latest subscription version can be changed",
    );
  }

  if (current.status === status) {
    return {
      subscription: await subscriptionQuery(subscriptionId),
      revision: null,
    };
  }

  if (current.status === "CANCELLED") {
    throw new ApiError(
      409,
      "INVALID_STATUS_TRANSITION",
      "A cancelled subscription cannot be reactivated or paused",
    );
  }

  const latestRevision = await SubscriptionRevisionHistory.findOne({
    subscription_details_id: current._id,
  })
    .sort({ sub_version: -1 })
    .lean();
  let revision;

  try {
    revision = await SubscriptionRevisionHistory.create({
      sub_version: (latestRevision?.sub_version ?? 0) + 1,
      subscription_details_id: current._id,
    });

    const updated = await SubscriptionDetails.findOneAndUpdate(
      {
        _id: current._id,
        status: current.status,
        is_latest: true,
        updatedAt: current.updatedAt,
      },
      { $set: { status } },
      { returnDocument: "after", runValidators: true },
    );

    if (!updated) {
      throw new ApiError(
        409,
        "SUBSCRIPTION_VERSION_CONFLICT",
        "The subscription changed. Reload and retry.",
      );
    }

    const subscription = await subscriptionQuery(updated._id);
    logger.info("Subscription status changed", {
      subscription_id: String(updated._id),
      previous_status: current.status,
      status,
      sub_version: revision.sub_version,
    });

    return { subscription, revision: revision.toObject() };
  } catch (error) {
    if (revision?._id) {
      await SubscriptionRevisionHistory.deleteOne({ _id: revision._id });
    }
    throw error;
  }
}

export async function getSubscriptions(req, res) {
  requireDatabase();

  const allowedQueryFields = [
    "page",
    "limit",
    "status",
    "is_latest",
    "article_id",
    "item_id",
  ];
  const unsupportedFields = Object.keys(req.query).filter(
    (field) => !allowedQueryFields.includes(field),
  );
  if (unsupportedFields.length > 0) {
    throw new ApiError(
      400,
      "INVALID_FILTER",
      `Unsupported filter(s): ${unsupportedFields.join(", ")}`,
      { fields: unsupportedFields },
    );
  }

  const page = parsePositiveInteger(req.query.page, DEFAULT_PAGE, "page");
  const limit = parsePositiveInteger(
    req.query.limit,
    DEFAULT_LIMIT,
    "limit",
    MAX_LIMIT,
  );
  const filter = {
    is_latest:
      req.query.is_latest === undefined
        ? true
        : parseBoolean(req.query.is_latest, "is_latest"),
  };

  if (req.query.status !== undefined && req.query.status !== "") {
    filter.status = normalizeStatus(req.query.status);
  }

  for (const field of ["article_id", "item_id"]) {
    if (req.query[field] === undefined || req.query[field] === "") continue;
    if (!mongoose.isObjectIdOrHexString(req.query[field])) {
      throw new ApiError(
        400,
        "INVALID_FILTER",
        `${field} must be a valid MongoDB ObjectId`,
      );
    }
    filter[field] = req.query[field];
  }

  const [subscriptions, total] = await Promise.all([
    SubscriptionDetails.find(filter)
      .populate("article_id")
      .populate("item_id")
      .sort({ updatedAt: -1, _id: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    SubscriptionDetails.countDocuments(filter),
  ]);

  res.json({
    subscriptions,
    pagination: {
      page,
      limit,
      total,
      total_pages: Math.ceil(total / limit),
    },
  });
}

export async function getSubscription(req, res) {
  requireDatabase();
  requireSubscriptionId(req.params.subscription_id);

  const subscription = await subscriptionQuery(req.params.subscription_id);
  if (!subscription) {
    throw new ApiError(
      404,
      "SUBSCRIPTION_NOT_FOUND",
      "Subscription not found",
    );
  }

  res.json({ subscription });
}

export async function cancelSubscription(req, res) {
  requireDatabase();
  const result = await changeSubscriptionStatus(
    req.params.subscription_id,
    "CANCELLED",
  );
  res.json(result);
}

export async function updateSubscription(req, res) {
  requireDatabase();

  if (!req.body || typeof req.body !== "object" || Array.isArray(req.body)) {
    throw new ApiError(
      400,
      "INVALID_REQUEST_BODY",
      "The request body must be a JSON object",
    );
  }

  const unsupportedFields = Object.keys(req.body).filter(
    (field) => field !== "article_id",
  );
  if (unsupportedFields.length > 0) {
    throw new ApiError(
      400,
      "UNKNOWN_FIELDS",
      `Unsupported field(s): ${unsupportedFields.join(", ")}`,
      { fields: unsupportedFields },
    );
  }

  const { article_id: articleId } = req.body;
  if (!mongoose.isObjectIdOrHexString(articleId)) {
    throw new ApiError(
      400,
      "INVALID_ARTICLE_ID",
      "article_id must be a valid MongoDB ObjectId",
    );
  }

  const subscriptionId = req.params.subscription_id;
  requireSubscriptionId(subscriptionId);

  const current = await SubscriptionDetails.findById(subscriptionId).lean();
  if (!current) {
    throw new ApiError(
      404,
      "SUBSCRIPTION_NOT_FOUND",
      "Subscription not found",
    );
  }
  if (!current.is_latest) {
    throw new ApiError(
      409,
      "SUBSCRIPTION_VERSION_CONFLICT",
      "Only the latest subscription version can be upgraded",
    );
  }
  if (current.status === "CANCELLED") {
    throw new ApiError(
      409,
      "INVALID_STATUS_TRANSITION",
      "A cancelled subscription cannot be upgraded",
    );
  }
  if (String(current.article_id) === String(articleId)) {
    throw new ApiError(
      400,
      "ARTICLE_UNCHANGED",
      "article_id must identify a different article",
    );
  }

  const latestRevision = await SubscriptionRevisionHistory.findOne({
    subscription_details_id: current._id,
  })
    .sort({ sub_version: -1 })
    .lean();
  const replacement = new SubscriptionDetails({
    article_id: articleId,
    status: current.status,
    is_latest: true,
  });

  await replacement.validate();

  const acquired = await SubscriptionDetails.updateOne(
    {
      _id: current._id,
      is_latest: true,
      updatedAt: current.updatedAt,
    },
    { $set: { is_latest: false } },
  );
  if (acquired.modifiedCount !== 1) {
    throw new ApiError(
      409,
      "SUBSCRIPTION_VERSION_CONFLICT",
      "The subscription changed. Reload and retry.",
    );
  }

  let originalRevision;
  let newSubscription;
  let newRevision;

  try {
    if (!latestRevision) {
      originalRevision = await SubscriptionRevisionHistory.create({
        sub_version: 1,
        subscription_details_id: current._id,
      });
    }

    newSubscription = await replacement.save();
    newRevision = await SubscriptionRevisionHistory.create({
      sub_version: (latestRevision?.sub_version ?? 1) + 1,
      subscription_details_id: newSubscription._id,
    });
    const populatedSubscription = await subscriptionQuery(newSubscription._id);

    logger.info("Subscription article upgraded", {
      previous_subscription_id: String(current._id),
      subscription_id: String(newSubscription._id),
      previous_article_id: String(current.article_id),
      article_id: String(newSubscription.article_id),
      sub_version: newRevision.sub_version,
    });

    res.json({
      previous_subscription_id: String(current._id),
      subscription: populatedSubscription,
      revision: newRevision.toObject(),
    });
  } catch (error) {
    await Promise.allSettled([
      newRevision?._id
        ? SubscriptionRevisionHistory.deleteOne({ _id: newRevision._id })
        : Promise.resolve(),
      newSubscription?._id
        ? SubscriptionDetails.deleteOne({ _id: newSubscription._id })
        : Promise.resolve(),
      originalRevision?._id
        ? SubscriptionRevisionHistory.deleteOne({ _id: originalRevision._id })
        : Promise.resolve(),
      SubscriptionDetails.updateOne(
        { _id: current._id },
        { $set: { is_latest: true } },
      ),
    ]);
    throw error;
  }
}
