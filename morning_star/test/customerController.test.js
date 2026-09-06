import assert from "node:assert/strict";
import { after, test } from "node:test";

await import("../convict.js");
const { shutdownObservability } = await import("@app/observability");
const { customerInvoiceResponse } = await import(
  "../controllers/customerController.js"
);
const { default: customerRoutes } = await import("../routes/customer.js");

after(() => shutdownObservability());

test("customer invoice endpoint is registered", () => {
  const route = customerRoutes.stack.find(
    (layer) => layer.route?.path === "/:quote_id/invoice",
  )?.route;

  assert.equal(route?.methods.get, true);
});

test("customer quotation confirmation endpoint is registered", () => {
  const route = customerRoutes.stack.find(
    (layer) => layer.route?.path === "/confirm_quote",
  )?.route;

  assert.equal(route?.methods.post, true);
});

test("customer invoice response includes PDF metadata and base64 data", () => {
  const result = customerInvoiceResponse({
    billing: {
      invoice_id: "e7181ba8-a8ea-4f74-9280-d1386dc4f41d",
      invoice_number: "DF/26-27/000001",
      quote_id: "507f1f77bcf86cd799439011",
      final_amt: 1180,
      invoice_created_at: new Date("2026-09-06T12:00:00.000Z"),
    },
    base64: "JVBERi0xLjQ=",
  });

  assert.equal(result.invoice.quote_id, "507f1f77bcf86cd799439011");
  assert.equal(result.invoice.content_type, "application/pdf");
  assert.equal(result.invoice.encoding, "base64");
  assert.equal(result.invoice.data, "JVBERi0xLjQ=");
});
