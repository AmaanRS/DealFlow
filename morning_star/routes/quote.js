import { Router } from "express";
import {
  createQuotation,
  getApprovedQuotes,
  getAtRiskDeals,
  getQuote,
  getQuotes,
  updateQuotation,
} from "../controllers/quoteController.js";

const router = Router();

function asyncRoute(handler) {
  return function quoteRoute(req, res, next) {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

router.get("/get_quotes", asyncRoute(getQuotes));
router.get("/approved_quotes", asyncRoute(getApprovedQuotes));
router.get("/at_risk_deals", asyncRoute(getAtRiskDeals));
router.get("/:quote_id", asyncRoute(getQuote));
router.post("/new_quotation", asyncRoute(createQuotation));
router.patch("/quotation", asyncRoute(updateQuotation));

export default router;
