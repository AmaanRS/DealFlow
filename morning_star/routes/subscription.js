import { Router } from "express";
import {
  getSubscription,
  getSubscriptions,
} from "../controllers/subscriptionController.js";

const router = Router();

function asyncRoute(handler) {
  return function subscriptionRoute(req, res, next) {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

router.get("/get_subscriptions", asyncRoute(getSubscriptions));
router.get("/:subscription_id", asyncRoute(getSubscription));

export default router;
