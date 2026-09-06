import assert from "node:assert/strict";
import test from "node:test";
import {
  amountInIndianWords,
  invoiceLineTotal,
  invoiceLineTaxable,
  renderInvoicePdf,
} from "../services/invoiceTemplate.js";

function invoiceFixture() {
  return {
    billing: {
      invoice_id: "e7181ba8-a8ea-4f74-9280-d1386dc4f41d",
      invoice_number: "DF/26-27/000001",
      invoice_created_at: new Date("2026-09-06T12:00:00.000Z"),
      final_amt: 1180,
    },
    quote: {
      _id: "507f1f77bcf86cd799439011",
      status: "NEGOTIATION",
      customer: {
        fullName: "Sample Customer",
        email: "customer@example.com",
        _custom_json: { delivery_address: "Mumbai, Maharashtra" },
      },
      products: [
        {
          name: "Business laptop",
          hsn: "8471H2",
          inv: 2,
          unit_price: 500,
          product_discount: 20,
          applied_discount: 0,
          category_discount: 0,
          gst: 18,
        },
      ],
      tier_discount: 0,
      order_discount: 0,
      cost_price: 1000,
      discounted_price: 1000,
      selling_price: 1180,
      subscription_details: [],
    },
  };
}

test("invoice pricing uses applied discounts but not reference product discounts", () => {
  const { quote } = invoiceFixture();
  assert.equal(invoiceLineTaxable(quote.products[0], quote), 1000);
  assert.equal(invoiceLineTotal(quote.products[0], quote), 1180);

  quote.products[0].applied_discount = 10;
  assert.equal(invoiceLineTotal(quote.products[0], quote), 1062);
});

test("invoice totals are written using the Indian numbering system", () => {
  assert.equal(
    amountInIndianWords(1234567.89),
    "Rupees Twelve Lakh Thirty Four Thousand Five Hundred Sixty Seven and Eighty Nine Paise Only",
  );
});

test("the hardcoded Indian tax invoice template generates a PDF buffer", async () => {
  const pdf = await renderInvoicePdf({
    ...invoiceFixture(),
    invoiceProfile: {
      supplierName: "DealFlow Private Limited",
      supplierAddress: "Mumbai, Maharashtra 400001",
      supplierGstin: "27ABCDE1234F1Z5",
      supplierState: "Maharashtra",
      supplierStateCode: "27",
      placeOfSupply: "Maharashtra",
      placeOfSupplyCode: "27",
      taxType: "AUTO",
      reverseCharge: false,
      authorizedSignatory: "Authorised Signatory",
    },
  });

  assert.ok(Buffer.isBuffer(pdf));
  assert.ok(pdf.length > 1_000);
  assert.equal(pdf.subarray(0, 5).toString("ascii"), "%PDF-");
  assert.doesNotThrow(() => Buffer.from(pdf.toString("base64"), "base64"));
});
