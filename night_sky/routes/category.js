import { Router } from "express";
import { updateCategoryDiscount } from "../controllers/discountController.js";

const router = Router();

function asyncRoute(handler) {
  return function categoryRoute(req, res, next) {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

router.patch("/category_discount", asyncRoute(updateCategoryDiscount));

export default router;
