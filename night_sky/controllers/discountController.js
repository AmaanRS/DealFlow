import mongoose from "mongoose";
import { logger } from "@app/observability";
import { CategoryDiscount, TierDiscount } from "../models.js";

function requireDatabase(res) {
  if (mongoose.connection.readyState === 1) return true;

  res.status(503).json({
    code: "DATABASE_UNAVAILABLE",
    message: "The discount database is not ready",
  });
  return false;
}

function requireObject(body, res) {
  if (body && typeof body === "object" && !Array.isArray(body)) return true;

  res.status(400).json({
    code: "INVALID_REQUEST_BODY",
    message: "The request body must be a JSON object",
  });
  return false;
}

function rejectUnknownFields(body, allowedFields, res) {
  const unsupportedFields = Object.keys(body).filter(
    (field) => !allowedFields.includes(field),
  );
  if (unsupportedFields.length === 0) return false;

  res.status(400).json({
    code: "UNKNOWN_FIELDS",
    message: `Unsupported field(s): ${unsupportedFields.join(", ")}`,
  });
  return true;
}

function isPercentage(value, { integer = false } = {}) {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= 100 &&
    (!integer || Number.isInteger(value))
  );
}

export async function updateTierDiscount(req, res) {
  if (!requireDatabase(res) || !requireObject(req.body, res)) return;
  if (rejectUnknownFields(req.body, ["tier", "discount"], res)) return;

  const { tier, discount } = req.body;
  if (typeof tier !== "string" || tier.trim().length === 0) {
    res.status(400).json({
      code: "INVALID_TIER",
      message: "tier must be a non-empty string",
    });
    return;
  }
  if (tier.trim().length > 100) {
    res.status(400).json({
      code: "INVALID_TIER",
      message: "tier must contain at most 100 characters",
    });
    return;
  }
  if (!isPercentage(discount, { integer: true })) {
    res.status(400).json({
      code: "INVALID_DISCOUNT",
      message: "discount must be an integer between 0 and 100",
    });
    return;
  }

  const normalizedTier = tier.trim().toUpperCase();
  const tierDiscount = await TierDiscount.findOneAndUpdate(
    { tier: normalizedTier },
    { $set: { discount } },
    { returnDocument: "after", runValidators: true },
  );

  if (!tierDiscount) {
    res.status(404).json({
      code: "TIER_DISCOUNT_NOT_FOUND",
      message: "Create the tier discount before updating it",
    });
    return;
  }

  logger.info("Tier discount configured", {
    tier_discount_id: String(tierDiscount._id),
    tier: tierDiscount.tier,
    discount: tierDiscount.discount,
  });
  res.json({ tier_discount: tierDiscount });
}

export async function updateCategoryDiscount(req, res) {
  if (!requireDatabase(res) || !requireObject(req.body, res)) return;
  if (
    rejectUnknownFields(
      req.body,
      ["hardware", "service", "subscription"],
      res,
    )
  ) {
    return;
  }

  if (req.body.subscription !== undefined && req.body.subscription !== 0) {
    res.status(400).json({
      code: "INVALID_SUBSCRIPTION_DISCOUNT",
      message: "subscription discount must remain 0",
    });
    return;
  }

  const updates = {};
  for (const field of ["hardware", "service"]) {
    if (req.body[field] === undefined) continue;
    if (!isPercentage(req.body[field])) {
      res.status(400).json({
        code: "INVALID_DISCOUNT",
        message: `${field} must be a number between 0 and 100`,
      });
      return;
    }
    updates[field] = req.body[field];
  }

  if (Object.keys(updates).length === 0) {
    res.status(400).json({
      code: "EMPTY_UPDATE",
      message: "hardware or service must be provided",
    });
    return;
  }

  const current = await CategoryDiscount.findOne()
    .sort({ updatedAt: -1, _id: -1 })
    .select("_id")
    .lean();
  if (!current) {
    res.status(404).json({
      code: "CATEGORY_DISCOUNT_NOT_FOUND",
      message: "Create the category discount policy before updating it",
    });
    return;
  }

  const categoryDiscount = await CategoryDiscount.findByIdAndUpdate(
    current._id,
    { $set: updates },
    { returnDocument: "after", runValidators: true },
  );

  logger.info("Category discount configured", {
    category_discount_id: String(categoryDiscount._id),
    hardware: categoryDiscount.hardware,
    service: categoryDiscount.service,
    subscription: categoryDiscount.subscription,
  });
  res.json({ category_discount: categoryDiscount });
}
