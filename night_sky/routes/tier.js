import { Router } from "express";
import { updateTierDiscount } from "../controllers/discountController.js";

const router = Router();

function asyncRoute(handler) {
  return function tierRoute(req, res, next) {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

router.patch("/tier_discount", asyncRoute(updateTierDiscount));

export default router;
