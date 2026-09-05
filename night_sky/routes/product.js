import { Router } from "express";
import {
  addInventory,
  createHsn,
  createProduct,
  getProduct,
  getQuoteInventory,
} from "../controllers/productController.js";

const router = Router();

function asyncRoute(handler) {
  return function productRoute(req, res, next) {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

router.get("/get_inv/:quote_id", asyncRoute(getQuoteInventory));
router.get("/:item_id", asyncRoute(getProduct));
router.post("/create_hsn", asyncRoute(createHsn));
router.post("/create_product", asyncRoute(createProduct));
router.post("/add_inventory", asyncRoute(addInventory));

export default router;
