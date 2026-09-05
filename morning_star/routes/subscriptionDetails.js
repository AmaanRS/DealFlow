import { Router } from "express";
import {
  cancelSubscription,
  updateSubscription,
} from "../controllers/subscriptionController.js";

const router = Router();

function asyncRoute(handler) {
  return function subscriptionDetailsRoute(req, res, next) {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

router.post("/cancel/:subscription_id", asyncRoute(cancelSubscription));
router.patch("/:subscription_id", asyncRoute(updateSubscription));

export default router;
