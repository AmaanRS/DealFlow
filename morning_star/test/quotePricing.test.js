import assert from "node:assert/strict";
import test from "node:test";
import { applyCreationRiskWorkflow } from "../controllers/quoteController.js";
import { calculateQuoteRisk } from "../services/quotePricing.js";

const thresholds = {
  mediumRiskThreshold: 25,
  highRiskThreshold: 50,
};

function product(appliedDiscount, productDiscount) {
  return {
    applied_discount: appliedDiscount,
    product_discount: productDiscount,
  };
}

test("an explicit draft stays a draft until the sales rep submits it", () => {
  const result = applyCreationRiskWorkflow({
    status: "DRAFT",
    risk: "LOW",
    approved_by: null,
  });

  assert.equal(result.status, "DRAFT");
  assert.equal(result.approved_by, null);
});

test("submitted LOW risk auto-approves while MEDIUM waits for approval", () => {
  const low = applyCreationRiskWorkflow({
    status: "PENDING_APPROVAL",
    risk: "LOW",
    approved_by: null,
  });
  const medium = applyCreationRiskWorkflow({
    status: "PENDING_APPROVAL",
    risk: "MEDIUM",
    approved_by: null,
  });

  assert.equal(low.status, "APPROVED");
  assert.equal(low.approved_by, "AUTO");
  assert.equal(medium.status, "PENDING_APPROVAL");
  assert.equal(medium.approved_by, null);
});

test("line-item discount rule raises risk to MEDIUM", () => {
  const result = calculateQuoteRisk({
    products: [product(11, 10)],
    costPrice: 100,
    discountedPrice: 90,
    ...thresholds,
  });

  assert.equal(result.risk, "MEDIUM");
  assert.equal(result.line_item_rule_triggered, true);
});

test("configured total discount thresholds produce MEDIUM and HIGH risk", () => {
  const medium = calculateQuoteRisk({
    products: [product(5, 10)],
    costPrice: 100,
    discountedPrice: 74,
    ...thresholds,
  });
  const high = calculateQuoteRisk({
    products: [product(5, 10)],
    costPrice: 100,
    discountedPrice: 49,
    ...thresholds,
  });

  assert.equal(medium.risk, "MEDIUM");
  assert.equal(high.risk, "HIGH");
});

test("threshold comparisons are strictly greater than", () => {
  const mediumBoundary = calculateQuoteRisk({
    products: [product(5, 10)],
    costPrice: 100,
    discountedPrice: 75,
    ...thresholds,
  });
  const highBoundary = calculateQuoteRisk({
    products: [product(5, 10)],
    costPrice: 100,
    discountedPrice: 50,
    ...thresholds,
  });

  assert.equal(mediumBoundary.risk, "LOW");
  assert.equal(highBoundary.risk, "MEDIUM");
});
