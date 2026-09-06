import assert from "node:assert/strict";
import test from "node:test";
import { parseProductListQuery } from "../controllers/productController.js";

test("product list query applies pagination and category filters", () => {
  const result = parseProductListQuery({
    page: "2",
    limit: "25",
    category: "hardware",
  });

  assert.deepEqual(result, {
    filter: { categories: "HARDWARE" },
    page: 2,
    limit: 25,
  });
});

test("product search escapes regular-expression characters", () => {
  const result = parseProductListQuery({ search: "Desk.*" });

  assert.equal(result.filter.name.$regex, "Desk\\.\\*");
  assert.equal(result.filter.name.$options, "i");
});

test("product list accepts multiple categories for one paginated catalogue", () => {
  const result = parseProductListQuery({
    page: "3",
    limit: "8",
    category: "hardware,services",
  });

  assert.deepEqual(result, {
    filter: { categories: { $in: ["HARDWARE", "SERVICES"] } },
    page: 3,
    limit: 8,
  });
});

test("product list rejects unsupported categories", () => {
  assert.throws(
    () => parseProductListQuery({ category: "food" }),
    (error) => error.code === "INVALID_CATEGORY",
  );
});
