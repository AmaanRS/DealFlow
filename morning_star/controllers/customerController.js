import mongoose from "mongoose";
import { getBillingInvoice } from "../services/invoiceService.js";

class ApiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function requireDatabase() {
  if (mongoose.connection.readyState !== 1) {
    throw new ApiError(
      503,
      "DATABASE_UNAVAILABLE",
      "The quotation database is not ready",
    );
  }
}

export function customerInvoiceResponse({ billing, base64 }) {
  return {
    invoice: {
      invoice_id: billing.invoice_id,
      invoice_number: billing.invoice_number,
      quote_id: String(billing.quote_id),
      final_amt: billing.final_amt,
      created_at: billing.invoice_created_at,
      content_type: "application/pdf",
      encoding: "base64",
      data: base64,
    },
  };
}

export async function getCustomerInvoice(req, res) {
  requireDatabase();

  if (!mongoose.isObjectIdOrHexString(req.params.quote_id)) {
    throw new ApiError(
      400,
      "INVALID_QUOTE_ID",
      "quote_id must be a valid MongoDB ObjectId",
    );
  }

  let result;
  try {
    result = await getBillingInvoice(req.params.quote_id);
  } catch (error) {
    if (
      [
        "INVOICE_STORAGE_READ_FAILED",
        "INVOICE_STORAGE_INVALID_DATA",
      ].includes(error?.code)
    ) {
      throw new ApiError(
        503,
        "INVOICE_STORAGE_UNAVAILABLE",
        "The invoice is temporarily unavailable",
      );
    }
    throw error;
  }

  if (!result) {
    throw new ApiError(
      404,
      "INVOICE_NOT_FOUND",
      "No invoice exists for this quotation",
    );
  }

  res.set("Cache-Control", "private, no-store");
  res.json(customerInvoiceResponse(result));
}
