import { Router } from "express";
import { getCustomerInvoice } from "../controllers/customerController.js";
import { confirmCustomerQuote } from "../controllers/quoteController.js";

const router = Router();

function asyncRoute(handler) {
  return function customerRoute(req, res, next) {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

router.get("/:quote_id/invoice", asyncRoute(getCustomerInvoice));
router.post("/confirm_quote", asyncRoute(confirmCustomerQuote));

export default router;
