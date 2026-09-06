import { createObjectStorage } from "@app/object-storage";
import { createLogger } from "@app/observability";
import { allocateInvoiceNumber, Billing, Quote } from "../models.js";
import { config } from "../convict.js";
import { renderInvoicePdf } from "./invoiceTemplate.js";

const logger = createLogger("morning-star.invoice-service", {
  "service.component": "invoice-service",
});

export const invoiceStorage = createObjectStorage({
  endpoint: config.get("objectStorage.endpoint"),
  region: config.get("objectStorage.region"),
  bucket: config.get("objectStorage.bucket"),
  accessKeyId: config.get("objectStorage.accessKeyId"),
  secretAccessKey: config.get("objectStorage.secretAccessKey"),
  forcePathStyle: config.get("objectStorage.forcePathStyle"),
});

const invoiceProfile = Object.freeze({
  supplierName: config.get("invoice.supplierName"),
  supplierAddress: config.get("invoice.supplierAddress"),
  supplierGstin: config.get("invoice.supplierGstin"),
  supplierState: config.get("invoice.supplierState"),
  supplierStateCode: config.get("invoice.supplierStateCode"),
  placeOfSupply: config.get("invoice.placeOfSupply"),
  placeOfSupplyCode: config.get("invoice.placeOfSupplyCode"),
  taxType: config.get("invoice.taxType"),
  reverseCharge: config.get("invoice.reverseCharge"),
  authorizedSignatory: config.get("invoice.authorizedSignatory"),
});

export async function createBillingInvoice(
  quoteId,
  { storage = invoiceStorage } = {},
) {
  const existingBilling = await Billing.findOne({ quote_id: quoteId });
  if (existingBilling) {
    logger.info("Existing billing invoice reused", {
      "event.name": "billing.invoice.reused",
      "event.outcome": "success",
      "billing.id": String(existingBilling._id),
      "invoice.id": existingBilling.invoice_id,
      "invoice.number": existingBilling.invoice_number,
      "invoice.object.key": existingBilling.invoice_object_key,
      "quote.id": String(existingBilling.quote_id),
    });
    return existingBilling;
  }

  const invoiceCreatedAt = new Date();
  const billing = new Billing({
    quote_id: quoteId,
    invoice_number: await allocateInvoiceNumber(invoiceCreatedAt),
    invoice_created_at: invoiceCreatedAt,
  });
  await billing.validate();

  const quote = await Quote.findById(quoteId)
    .populate({
      path: "customer",
      select: "fullName email _custom_json.delivery_address",
    })
    .populate("subscription_details")
    .lean();
  if (!quote) {
    throw new Error(`Cannot create an invoice for missing quote ${quoteId}`);
  }

  const pdf = await renderInvoicePdf({
    billing,
    quote,
    invoiceProfile,
  });
  const base64 = pdf.toString("base64");
  const uploaded = await storage.putBase64Object({
    key: billing.invoice_object_key,
    data: base64,
    metadata: {
      "invoice-id": billing.invoice_id,
      "invoice-number": billing.invoice_number,
      "quote-id": String(billing.quote_id),
    },
  });
  billing.invoice_etag = uploaded.etag;

  try {
    await billing.save({ validateBeforeSave: false });
    logger.info("Billing invoice generated and stored", {
      "event.name": "billing.invoice.stored",
      "event.outcome": "success",
      "billing.id": String(billing._id),
      "invoice.id": billing.invoice_id,
      "invoice.number": billing.invoice_number,
      "invoice.object.key": billing.invoice_object_key,
      "invoice.pdf.size_bytes": pdf.length,
      "invoice.base64.size_bytes": Buffer.byteLength(base64),
      "quote.id": String(billing.quote_id),
      "billing.final_amount": billing.final_amt,
    });
    return billing;
  } catch (error) {
    let cleanupError = null;
    try {
      await storage.deleteObject(billing.invoice_object_key);
    } catch (caughtCleanupError) {
      cleanupError = caughtCleanupError;
    }

    // Concurrent retries can both upload, but only one may create the billing
    // row because quote_id is unique. Return the winner after cleaning up this
    // attempt's distinct object.
    if (error?.code === 11000) {
      const concurrentBilling = await Billing.findOne({ quote_id: quoteId });
      if (concurrentBilling) {
        logger.info("Concurrent billing invoice creation reused the winner", {
          "event.name": "billing.invoice.concurrent_retry",
          "event.outcome": cleanupError ? "failure" : "success",
          "billing.id": String(concurrentBilling._id),
          "invoice.id": concurrentBilling.invoice_id,
          "invoice.number": concurrentBilling.invoice_number,
          "invoice.object.key": concurrentBilling.invoice_object_key,
          "quote.id": String(concurrentBilling.quote_id),
          "orphan_cleanup.succeeded": !cleanupError,
        });
        return concurrentBilling;
      }
    }

    logger.error(
      "Billing invoice database write failed after object upload",
      {
        "event.name": "billing.invoice.persistence.failed",
        "event.outcome": "failure",
        "billing.id": String(billing._id),
        "invoice.id": billing.invoice_id,
        "invoice.number": billing.invoice_number,
        "invoice.object.key": billing.invoice_object_key,
        "quote.id": String(billing.quote_id),
        "orphan_cleanup.succeeded": !cleanupError,
      },
      error,
    );
    throw error;
  }
}

export async function getBillingInvoice(
  quoteId,
  { storage = invoiceStorage } = {},
) {
  const billing = await Billing.findOne({ quote_id: quoteId }).lean();
  if (!billing) return null;

  const objectKey = billing.invoice_object_key ?? billing.invoice_id;
  let base64;
  try {
    base64 = await storage.getObjectText(objectKey);
  } catch (error) {
    logger.error(
      "Billing invoice could not be read from object storage",
      {
        "event.name": "billing.invoice.storage_read.failed",
        "event.outcome": "failure",
        "billing.id": String(billing._id),
        "invoice.id": billing.invoice_id,
        "invoice.number": billing.invoice_number,
        "invoice.object.key": objectKey,
        "quote.id": String(billing.quote_id),
      },
      error,
    );

    const storageError = new Error("Invoice data could not be read", {
      cause: error,
    });
    storageError.code = "INVOICE_STORAGE_READ_FAILED";
    throw storageError;
  }

  if (typeof base64 !== "string" || base64.length === 0) {
    const storageError = new Error("Stored invoice data is empty or invalid");
    storageError.code = "INVOICE_STORAGE_INVALID_DATA";
    throw storageError;
  }

  logger.info("Billing invoice retrieved from object storage", {
    "event.name": "billing.invoice.retrieved",
    "event.outcome": "success",
    "billing.id": String(billing._id),
    "invoice.id": billing.invoice_id,
    "invoice.number": billing.invoice_number,
    "invoice.object.key": objectKey,
    "invoice.pdf.size_bytes": Buffer.byteLength(base64, "base64"),
    "quote.id": String(billing.quote_id),
  });

  return { billing, base64 };
}

export async function deleteBillingInvoice(
  billing,
  { storage = invoiceStorage } = {},
) {
  if (!billing) return;

  const objectKey = billing.invoice_object_key ?? billing.invoice_id;
  let storageError;
  try {
    await storage.deleteObject(objectKey);
  } catch (error) {
    storageError = error;
  }

  await Billing.deleteOne({ _id: billing._id });
  logger.info("Billing invoice removed during workflow rollback", {
    "event.name": "billing.invoice.rollback.completed",
    "event.outcome": storageError ? "failure" : "success",
    "billing.id": String(billing._id),
    "invoice.id": billing.invoice_id,
    "invoice.number": billing.invoice_number,
    "invoice.object.key": objectKey,
    "quote.id": String(billing.quote_id),
    "object_storage.delete_succeeded": !storageError,
  });
  if (storageError) throw storageError;
}
