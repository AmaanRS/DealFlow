import mongoose from "mongoose";
import { AUTO_APPROVER } from "@app/models/constants";
import { User } from "@app/models/auth";
import {
  Article,
  Item,
  resolveLatestReportingHsns,
} from "@app/models/catalog";
import { CategoryDiscount, TierDiscount } from "@app/models/discounts";
import {
  RISK_CONFIGURATION_ID,
  RiskConfiguration,
  effectiveRiskThresholds,
} from "@app/models/risk";

export const QUOTE_INPUT_FIELDS = Object.freeze([
  "customer",
  "products",
  "order_discount",
  "created_by",
  "approved_by",
  "assigned_to",
  "status",
  "reason",
  "subscription_details",
]);

const PRODUCT_INPUT_FIELDS = Object.freeze([
  "article_id",
  "category",
  "inv",
  "applied_discount",
]);

const CATEGORY_DISCOUNT_FIELDS = Object.freeze({
  HARDWARE: "hardware",
  SERVICES: "service",
  SUBSCRIPTION: "subscription",
});

function pricingError(status, code, message, details) {
  return Object.assign(new Error(message), { status, code, details });
}

export function normalizeQuoteInput(input) {
  const normalized = { ...input };
  const effectiveStatus = normalized.status ?? "DRAFT";
  const effectiveRisk = normalized.risk ?? "LOW";

  if (
    effectiveStatus === "APPROVED" &&
    effectiveRisk === "LOW" &&
    (normalized.approved_by === undefined ||
      normalized.approved_by === null ||
      normalized.approved_by === "")
  ) {
    normalized.approved_by = AUTO_APPROVER;
  }

  if (
    effectiveStatus === "APPROVED" &&
    effectiveRisk !== "LOW" &&
    (!normalized.approved_by || normalized.approved_by === AUTO_APPROVER)
  ) {
    throw pricingError(
      400,
      "APPROVER_REQUIRED",
      "MEDIUM and HIGH risk approved quotations require an approver email",
    );
  }

  return normalized;
}

export function rejectedRevisionAsDraft(input) {
  if (input.status !== "REJECTED") return input;

  return {
    ...input,
    status: "DRAFT",
    approved_by: null,
  };
}

export function applyCreationRiskWorkflow(pricedQuotation) {
  if (pricedQuotation.status === "DRAFT") {
    return normalizeQuoteInput({
      ...pricedQuotation,
      status: "DRAFT",
      approved_by: null,
    });
  }

  const isLowRisk = pricedQuotation.risk === "LOW";

  return normalizeQuoteInput({
    ...pricedQuotation,
    status: isLowRisk ? "APPROVED" : "PENDING_APPROVAL",
    approved_by: isLowRisk ? AUTO_APPROVER : null,
  });
}

function rejectUnknownFields(value, allowedFields, location) {
  const unknownFields = Object.keys(value).filter(
    (field) => !allowedFields.includes(field),
  );

  if (unknownFields.length > 0) {
    throw pricingError(
      400,
      "UNKNOWN_FIELDS",
      `Unsupported field(s) in ${location}: ${unknownFields.join(", ")}`,
      { fields: unknownFields, location },
    );
  }
}

function percentage(value, field, defaultValue = 0) {
  const candidate = value ?? defaultValue;

  if (
    typeof candidate !== "number" ||
    !Number.isFinite(candidate) ||
    candidate < 0 ||
    candidate > 100
  ) {
    throw pricingError(
      400,
      "INVALID_DISCOUNT",
      `${field} must be a number between 0 and 100`,
    );
  }

  return candidate;
}

function configuredPercentage(value, field) {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < 0 ||
    value > 100
  ) {
    throw pricingError(
      409,
      "INVALID_PRICING_CONFIGURATION",
      `${field} must be configured as a number between 0 and 100`,
    );
  }

  return value;
}

function positiveInteger(value, field) {
  if (!Number.isInteger(value) || value < 1) {
    throw pricingError(
      400,
      "INVALID_INVENTORY",
      `${field} must be a positive integer`,
    );
  }

  return value;
}

function roundMoney(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function applyDiscount(amount, discount) {
  return amount * (1 - discount / 100);
}

export function calculateQuoteRisk({
  products,
  costPrice,
  discountedPrice,
  mediumRiskThreshold,
  highRiskThreshold,
}) {
  if (
    !Number.isFinite(mediumRiskThreshold) ||
    !Number.isFinite(highRiskThreshold) ||
    mediumRiskThreshold < 0 ||
    highRiskThreshold > 100 ||
    mediumRiskThreshold >= highRiskThreshold
  ) {
    throw pricingError(
      409,
      "INVALID_RISK_CONFIGURATION",
      "Risk thresholds must satisfy 0 <= medium < high <= 100",
    );
  }

  const lineItemRuleTriggered = products.some(
    (product) => product.applied_discount > product.product_discount,
  );
  const discountPercentage =
    costPrice > 0
      ? Math.max(0, ((costPrice - discountedPrice) / costPrice) * 100)
      : 0;

  let risk = "LOW";
  if (discountPercentage > highRiskThreshold) {
    risk = "HIGH";
  } else if (
    lineItemRuleTriggered ||
    discountPercentage > mediumRiskThreshold
  ) {
    risk = "MEDIUM";
  }

  return {
    risk,
    discount_percentage: Math.round(discountPercentage * 100) / 100,
    line_item_rule_triggered: lineItemRuleTriggered,
  };
}

function normalizeProductInputs(products) {
  if (!Array.isArray(products) || products.length === 0) {
    throw pricingError(
      400,
      "PRODUCTS_REQUIRED",
      "products must contain at least one product",
    );
  }

  const seenArticleIds = new Set();

  return products.map((product, index) => {
    if (!product || typeof product !== "object" || Array.isArray(product)) {
      throw pricingError(
        400,
        "INVALID_PRODUCT",
        `products[${index}] must be a JSON object`,
      );
    }

    rejectUnknownFields(product, PRODUCT_INPUT_FIELDS, `products[${index}]`);

    if (!mongoose.isObjectIdOrHexString(product.article_id)) {
      throw pricingError(
        400,
        "INVALID_ARTICLE_ID",
        `products[${index}].article_id must be a valid MongoDB ObjectId`,
      );
    }

    const articleId = String(product.article_id);
    if (seenArticleIds.has(articleId)) {
      throw pricingError(
        400,
        "DUPLICATE_ARTICLE",
        `products[${index}].article_id is already present in this quotation`,
      );
    }
    seenArticleIds.add(articleId);

    let category;
    if (product.category !== undefined) {
      if (typeof product.category !== "string" || !product.category.trim()) {
        throw pricingError(
          400,
          "INVALID_CATEGORY",
          `products[${index}].category must be a non-empty string`,
        );
      }
      category = product.category.trim().toUpperCase();
    }

    return {
      article_id: articleId,
      category,
      inv: positiveInteger(product.inv, `products[${index}].inv`),
      applied_discount: percentage(
        product.applied_discount,
        `products[${index}].applied_discount`,
      ),
    };
  });
}

function selectCategory(product, item, index) {
  if (product.category !== undefined) {
    if (!item.categories.includes(product.category)) {
      throw pricingError(
        400,
        "INVALID_CATEGORY",
        `products[${index}].category is not available for the selected item`,
        { allowed_categories: item.categories },
      );
    }
    return product.category;
  }

  if (item.categories.length === 1) return item.categories[0];

  throw pricingError(
    400,
    "CATEGORY_REQUIRED",
    `products[${index}].category is required because the selected item has multiple categories`,
    { allowed_categories: item.categories },
  );
}

export async function priceQuotation(input, { inventoryCredits = new Map() } = {}) {
  if (!mongoose.isObjectIdOrHexString(input.customer)) {
    throw pricingError(
      400,
      "INVALID_CUSTOMER_ID",
      "customer must be a valid MongoDB ObjectId",
    );
  }

  const productInputs = normalizeProductInputs(input.products);
  const orderDiscount = percentage(input.order_discount, "order_discount");

  const [customer, articles, categoryDiscount, riskConfiguration] =
    await Promise.all([
      User.findOne({
        _id: input.customer,
        role: "CUSTOMER",
        status: "ACTIVE",
        is_verified: true,
        is_deleted: false,
      })
        .select("role requestedRole _custom_json.tier")
        .lean(),
      Article.find({
        _id: { $in: productInputs.map((product) => product.article_id) },
      })
        .select("item_id seller_identifier price inventory store_id discount")
        .lean(),
      CategoryDiscount.findOne().sort({ updatedAt: -1, _id: -1 }).lean(),
      RiskConfiguration.findById(RISK_CONFIGURATION_ID).lean(),
    ]);

  if (!customer) {
    throw pricingError(
      400,
      "CUSTOMER_NOT_FOUND",
      "customer must reference an existing user",
    );
  }

  const customerTier = customer._custom_json?.tier;
  if (!customerTier) {
    throw pricingError(
      409,
      "CUSTOMER_TIER_MISSING",
      "The selected customer does not have a pricing tier",
    );
  }

  if (!categoryDiscount) {
    throw pricingError(
      409,
      "CATEGORY_DISCOUNT_MISSING",
      "Category discounts must be configured before creating a quotation",
    );
  }

  const tierDiscount = await TierDiscount.findOne({ tier: customerTier }).lean();
  if (!tierDiscount) {
    throw pricingError(
      409,
      "TIER_DISCOUNT_MISSING",
      `No tier discount is configured for customer tier ${customerTier}`,
    );
  }

  const articleById = new Map(
    articles.map((article) => [String(article._id), article]),
  );
  const missingArticle = productInputs.find(
    (product) => !articleById.has(product.article_id),
  );
  if (missingArticle) {
    throw pricingError(
      400,
      "ARTICLE_NOT_FOUND",
      `article_id ${missingArticle.article_id} does not reference an existing article`,
    );
  }

  const itemIds = [...new Set(articles.map((article) => String(article.item_id)))];
  const items = await Item.find({ _id: { $in: itemIds } })
    .select("name reporting_hsn categories")
    .lean();
  const itemById = new Map(items.map((item) => [String(item._id), item]));
  const hsnByCode = await resolveLatestReportingHsns(
    items.map((item) => item.reporting_hsn),
  );

  const effectiveTierDiscount = configuredPercentage(
    tierDiscount.discount,
    `tier discount ${customerTier}`,
  );
  let costPrice = 0;
  let discountedPrice = 0;
  let sellingPrice = 0;
  const fulfillmentDetails = [];

  const products = productInputs.map((product, index) => {
    const article = articleById.get(product.article_id);
    const item = itemById.get(String(article.item_id));

    if (!item) {
      throw pricingError(
        409,
        "ITEM_NOT_FOUND",
        `The selected article ${product.article_id} does not reference an existing item`,
      );
    }

    const category = selectCategory(product, item, index);
    const hsn = hsnByCode.get(item.reporting_hsn);
    if (!hsn) {
      throw pricingError(
        409,
        "HSN_NOT_FOUND",
        `The item ${item._id} does not reference an existing reporting HSN`,
      );
    }

    if (!Number.isFinite(article.price) || article.price < 0) {
      throw pricingError(
        409,
        "INVALID_ARTICLE_PRICE",
        `The selected article ${product.article_id} does not have a valid price`,
      );
    }

    const availableInventory =
      (article.inventory?.sellable ?? 0) +
      (inventoryCredits.get(String(article._id)) ?? 0);
    if (category !== "SUBSCRIPTION" && product.inv > availableInventory) {
      throw pricingError(
        409,
        "INSUFFICIENT_INVENTORY",
        `Only ${availableInventory} unit(s) are available for article ${product.article_id}`,
        {
          article_id: product.article_id,
          requested: product.inv,
          available: availableInventory,
        },
      );
    }

    const productDiscount = configuredPercentage(
      article.discount,
      `discount for article ${product.article_id}`,
    );
    const categoryField = CATEGORY_DISCOUNT_FIELDS[category];
    const effectiveCategoryDiscount = configuredPercentage(
      categoryDiscount[categoryField],
      `${category} category discount`,
    );
    const gst = configuredPercentage(hsn.gst, `GST for ${hsn.reporting_hsn}`);
    const basePrice = article.price * product.inv;
    let lineDiscountedPrice = basePrice;

    // productDiscount is stored as a catalog reference. The sales rep's
    // applied_discount is the product-level discount used for pricing.
    for (const discount of [
      effectiveCategoryDiscount,
      product.applied_discount,
      effectiveTierDiscount,
      orderDiscount,
    ]) {
      lineDiscountedPrice = applyDiscount(lineDiscountedPrice, discount);
    }

    costPrice += basePrice;
    discountedPrice += lineDiscountedPrice;
    sellingPrice += lineDiscountedPrice * (1 + gst / 100);

    if (category !== "SUBSCRIPTION") {
      if (!mongoose.isObjectIdOrHexString(article.store_id)) {
        throw pricingError(
          409,
          "INVALID_ARTICLE_STORE",
          `The selected article ${product.article_id} does not reference a valid store`,
        );
      }

      fulfillmentDetails.push({
        seller_identifier: article.seller_identifier,
        store: article.store_id,
        inv: product.inv,
      });
    }

    return {
      article_id: article._id,
      item_id: item._id,
      name: item.name,
      hsn: hsn.reporting_hsn,
      category,
      gst,
      unit_price: article.price,
      product_discount: productDiscount,
      inv: product.inv,
      applied_discount: product.applied_discount,
      category_discount: effectiveCategoryDiscount,
    };
  });

  const roundedCostPrice = roundMoney(costPrice);
  const roundedDiscountedPrice = roundMoney(discountedPrice);
  const roundedSellingPrice = roundMoney(sellingPrice);
  const thresholds = effectiveRiskThresholds(riskConfiguration);
  const riskEvaluation = calculateQuoteRisk({
    products,
    costPrice: roundedCostPrice,
    discountedPrice: roundedDiscountedPrice,
    mediumRiskThreshold: thresholds.medium_risk_threshold,
    highRiskThreshold: thresholds.high_risk_threshold,
  });

  return {
    ...input,
    products,
    order_discount: orderDiscount,
    tier_discount: effectiveTierDiscount,
    cost_price: roundedCostPrice,
    discounted_price: roundedDiscountedPrice,
    selling_price: roundedSellingPrice,
    risk: riskEvaluation.risk,
    risk_evaluation: {
      discount_percentage: riskEvaluation.discount_percentage,
      line_item_rule_triggered: riskEvaluation.line_item_rule_triggered,
      medium_risk_threshold: thresholds.medium_risk_threshold,
      high_risk_threshold: thresholds.high_risk_threshold,
    },
    fulfillment_details: fulfillmentDetails,
  };
}

export function quoteIntentFromSnapshot(quote) {
  return {
    customer: quote.customer,
    products: quote.products.map((product) => ({
      article_id: String(product.article_id),
      category: product.category,
      inv: product.inv,
      applied_discount: product.applied_discount,
    })),
    order_discount: quote.order_discount,
    created_by: quote.created_by,
    approved_by: quote.approved_by,
    assigned_to: quote.assigned_to,
    status: quote.status,
    reason: quote.reason,
    subscription_details: (quote.subscription_details ?? []).map((subscription) =>
      String(subscription?._id ?? subscription),
    ),
  };
}
