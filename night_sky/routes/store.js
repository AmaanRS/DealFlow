import { Router } from "express";
import { getStores } from "../controllers/storeController.js";

const router = Router();

function asyncRoute(handler) {
  return function storeRoute(req, res, next) {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

router.get("/get_stores", asyncRoute(getStores));

export default router;
