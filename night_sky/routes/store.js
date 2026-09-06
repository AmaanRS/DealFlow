import { Router } from "express";
import {
  createStore,
  getStores,
  manuallySplitQuoteByStore,
  splitQuoteByStore,
} from "../controllers/storeController.js";

const router = Router();

function asyncRoute(handler) {
  return function storeRoute(req, res, next) {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

router.get("/get_stores", asyncRoute(getStores));
router.post("/create_store", asyncRoute(createStore));
router.post("/store_split", asyncRoute(splitQuoteByStore));
router.patch("/manual_store_split", asyncRoute(manuallySplitQuoteByStore));

export default router;
