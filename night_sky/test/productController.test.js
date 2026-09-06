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

test("product search is returned for the caller to widen across name and SKU", () => {
  const result = parseProductListQuery({ search: "Desk.*" });

  // The raw term is handed back rather than baked into a name-only filter, so
  // getProducts can also match a seller identifier held on the article.
  assert.equal(result.search, "Desk.*");
  assert.equal(result.filter.name, undefined);
});

test("product search combines with a category filter", () => {
  const result = parseProductListQuery({
    category: "hardware,services",
    search: "chair",
  });

  assert.deepEqual(result.filter, {
    categories: { $in: ["HARDWARE", "SERVICES"] },
  });
  assert.equal(result.search, "chair");
});

test("product search rejects an over-long term", () => {
  assert.throws(
    () => parseProductListQuery({ search: "x".repeat(101) }),
    (error) => error.code === "INVALID_SEARCH",
  );
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
