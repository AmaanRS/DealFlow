import { Router } from "express";
import {
  createHsn,
  createProduct,
  getProduct,
} from "../controllers/productController.js";

const router = Router();

function asyncRoute(handler) {
  return function productRoute(req, res, next) {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

router.get("/:item_id", asyncRoute(getProduct));
router.post("/create_hsn", asyncRoute(createHsn));
router.post("/create_product", asyncRoute(createProduct));

export default router;
