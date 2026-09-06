import PDFDocument from "pdfkit";

const COLORS = Object.freeze({
  navy: "#172554",
  blue: "#1D4ED8",
  paleBlue: "#EFF6FF",
  amber: "#B45309",
  paleAmber: "#FFFBEB",
  border: "#CBD5E1",
  muted: "#64748B",
  text: "#0F172A",
  white: "#FFFFFF",
});

const PAGE = Object.freeze({ left: 48, right: 547, bottom: 754 });
const TABLE_COLUMNS = Object.freeze([
  { key: "index", label: "#", x: 48, width: 20, align: "center" },
  { key: "description", label: "DESCRIPTION", x: 68, width: 112 },
  { key: "hsn", label: "HSN/SAC", x: 180, width: 52 },
  { key: "quantity", label: "QTY", x: 232, width: 30, align: "right" },
  { key: "unitPrice", label: "RATE", x: 262, width: 55, align: "right" },
  { key: "discount", label: "DISCOUNT", x: 317, width: 48, align: "right" },
  { key: "taxable", label: "TAXABLE", x: 365, width: 58, align: "right" },
  { key: "gstRate", label: "GST", x: 423, width: 31, align: "right" },
  { key: "tax", label: "TAX", x: 454, width: 43, align: "right" },
  { key: "total", label: "TOTAL", x: 497, width: 50, align: "right" },
]);

const SMALL_NUMBERS = Object.freeze([
  "Zero",
  "One",
  "Two",
  "Three",
  "Four",
  "Five",
  "Six",
  "Seven",
  "Eight",
  "Nine",
  "Ten",
  "Eleven",
  "Twelve",
  "Thirteen",
  "Fourteen",
  "Fifteen",
  "Sixteen",
  "Seventeen",
  "Eighteen",
  "Nineteen",
]);
const TENS = Object.freeze([
  "",
  "",
  "Twenty",
  "Thirty",
  "Forty",
  "Fifty",
  "Sixty",
  "Seventy",
  "Eighty",
  "Ninety",
]);

function roundMoney(value) {
  return Math.round(((Number(value) || 0) + Number.EPSILON) * 100) / 100;
}

function money(value) {
  return `INR ${new Intl.NumberFormat("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(value) || 0)}`;
}

function display(value, fallback = "Not provided") {
  if (value === null || value === undefined || value === "") return fallback;
  return String(value);
}

function formatIndiaDate(value) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date(value));
}

function applyDiscount(amount, percentage) {
  return amount * (1 - (Number(percentage) || 0) / 100);
}

export function invoiceLineTaxable(product, quote) {
  let taxable = (Number(product.unit_price) || 0) * (Number(product.inv) || 0);

  for (const discount of [
    product.category_discount,
    product.applied_discount,
    quote.tier_discount,
    quote.order_discount,
  ]) {
    taxable = applyDiscount(taxable, discount);
  }

  return roundMoney(taxable);
}

export function invoiceLineTotal(product, quote) {
  const taxable = invoiceLineTaxable(product, quote);
  return roundMoney(taxable * (1 + (Number(product.gst) || 0) / 100));
}

function integerWords(value) {
  const number = Math.trunc(value);
  if (number < 20) return SMALL_NUMBERS[number];
  if (number < 100) {
    const remainder = number % 10;
    return `${TENS[Math.floor(number / 10)]}${
      remainder ? ` ${SMALL_NUMBERS[remainder]}` : ""
    }`;
  }

  for (const [scale, label] of [
    [10_000_000, "Crore"],
    [100_000, "Lakh"],
    [1_000, "Thousand"],
    [100, "Hundred"],
  ]) {
    if (number >= scale) {
      const quotient = Math.floor(number / scale);
      const remainder = number % scale;
      return `${integerWords(quotient)} ${label}${
        remainder ? ` ${integerWords(remainder)}` : ""
      }`;
    }
  }

  return "Zero";
}

export function amountInIndianWords(value) {
  const roundedPaise = Math.round((Number(value) || 0) * 100);
  const rupees = Math.floor(roundedPaise / 100);
  const paise = roundedPaise % 100;
  return `Rupees ${integerWords(rupees)}${
    paise ? ` and ${integerWords(paise)} Paise` : ""
  } Only`;
}

function gstHsn(reportingHsn) {
  const value = display(reportingHsn, "-");
  const match = value.match(/^(\d{4,8})(?:H\d+)?$/i);
  return match?.[1] ?? value;
}

function productRows(quote) {
  const products = (quote.products ?? []).map((product, index) => {
    const baseValue = roundMoney(
      (Number(product.unit_price) || 0) * (Number(product.inv) || 0),
    );
    const taxable = invoiceLineTaxable(product, quote);
    const total = invoiceLineTotal(product, quote);
    const internalReference = display(product.hsn, "-");
    const hsn = gstHsn(product.hsn);

    return {
      index: index + 1,
      description: `${display(product.name, "Product")}${
        internalReference !== hsn ? `\nItem code: ${internalReference}` : ""
      }`,
      hsn,
      quantity: Number(product.inv) || 0,
      unitPrice: Number(product.unit_price) || 0,
      discount: roundMoney(baseValue - taxable),
      taxable,
      gstRate: Number(product.gst) || 0,
      tax: roundMoney(total - taxable),
      total,
    };
  });

  const subscriptions = (quote.subscription_details ?? []).map(
    (subscription, index) => {
      const taxable = roundMoney(subscription?.subscription_price);
      const total = roundMoney(subscription?.selling_price);
      const gstRate =
        taxable > 0 ? roundMoney(((total - taxable) / taxable) * 100) : 0;

      return {
        index: products.length + index + 1,
        description: `Subscription charge ${index + 1}`,
        hsn: gstHsn(subscription?.hsn),
        quantity: 1,
        unitPrice: taxable,
        discount: 0,
        taxable,
        gstRate,
        tax: roundMoney(total - taxable),
        total,
      };
    },
  );

  return [...products, ...subscriptions];
}

function resolvedTaxType(profile) {
  if (profile.taxType !== "AUTO") return profile.taxType;
  if (!profile.supplierStateCode || !profile.placeOfSupplyCode) return "GST";
  return profile.supplierStateCode === profile.placeOfSupplyCode
    ? "CGST_SGST"
    : "IGST";
}

function drawTableHeader(doc, y) {
  doc
    .save()
    .rect(PAGE.left, y, PAGE.right - PAGE.left, 25)
    .fill(COLORS.navy)
    .restore();

  for (const column of TABLE_COLUMNS) {
    doc
      .fillColor(COLORS.white)
      .font("Helvetica-Bold")
      .fontSize(6.2)
      .text(column.label, column.x + 2, y + 9, {
        width: column.width - 4,
        align: column.align,
        lineBreak: false,
      });
  }
  return y + 25;
}

function drawRows(doc, rows, startY) {
  let y = drawTableHeader(doc, startY);

  for (const row of rows) {
    const rowHeight = Math.max(
      30,
      doc.heightOfString(row.description, { width: 108 }) + 12,
    );
    if (y + rowHeight > PAGE.bottom) {
      doc.addPage();
      y = drawTableHeader(doc, PAGE.left);
    }

    if (row.index % 2 === 0) {
      doc
        .save()
        .rect(PAGE.left, y, PAGE.right - PAGE.left, rowHeight)
        .fill("#F8FAFC")
        .restore();
    }

    const values = {
      ...row,
      unitPrice: money(row.unitPrice),
      discount: money(row.discount),
      taxable: money(row.taxable),
      gstRate: `${row.gstRate}%`,
      tax: money(row.tax),
      total: money(row.total),
    };

    for (const column of TABLE_COLUMNS) {
      doc
        .fillColor(COLORS.text)
        .font("Helvetica")
        .fontSize(column.key === "description" ? 6.8 : 6.1)
        .text(display(values[column.key], "-"), column.x + 2, y + 8, {
          width: column.width - 4,
          height: rowHeight - 10,
          align: column.align,
          ellipsis: true,
        });
    }

    doc
      .save()
      .moveTo(PAGE.left, y + rowHeight)
      .lineTo(PAGE.right, y + rowHeight)
      .strokeColor(COLORS.border)
      .stroke()
      .restore();
    y += rowHeight;
  }

  return y;
}

function drawSummary(doc, { billing, quote, profile }, y) {
  const taxType = resolvedTaxType(profile);
  const taxableValue = roundMoney(
    (Number(quote.discounted_price) || 0) +
      (quote.subscription_details ?? []).reduce(
        (total, subscription) =>
          total + (Number(subscription?.subscription_price) || 0),
        0,
      ),
  );
  const taxAmount = roundMoney(
    Math.max(0, (Number(billing.final_amt) || 0) - taxableValue),
  );
  const taxRows =
    taxType === "CGST_SGST"
      ? [
          ["CGST", roundMoney(taxAmount / 2)],
          ["SGST", roundMoney(taxAmount - roundMoney(taxAmount / 2))],
        ]
      : [[taxType === "IGST" ? "IGST" : "GST amount", taxAmount]];
  const summaryRows = [["Taxable value", taxableValue], ...taxRows];
  const boxHeight = 59 + summaryRows.length * 18;
  const summaryX = 324;
  const summaryWidth = PAGE.right - summaryX;

  doc
    .save()
    .roundedRect(summaryX, y, summaryWidth, boxHeight, 4)
    .lineWidth(1)
    .strokeColor(COLORS.border)
    .stroke()
    .restore();

  for (const [index, [label, value]] of summaryRows.entries()) {
    const rowY = y + 12 + index * 18;
    doc
      .font("Helvetica")
      .fontSize(8)
      .fillColor(COLORS.muted)
      .text(label, summaryX + 12, rowY, { width: 100 })
      .fillColor(COLORS.text)
      .text(money(value), summaryX + 112, rowY, {
        width: summaryWidth - 124,
        align: "right",
      });
  }

  const totalY = y + 17 + summaryRows.length * 18;
  doc
    .save()
    .moveTo(summaryX + 12, totalY - 7)
    .lineTo(PAGE.right - 12, totalY - 7)
    .strokeColor(COLORS.border)
    .stroke()
    .restore()
    .font("Helvetica-Bold")
    .fontSize(10)
    .fillColor(COLORS.navy)
    .text("INVOICE TOTAL", summaryX + 12, totalY)
    .text(money(billing.final_amt), summaryX + 112, totalY, {
      width: summaryWidth - 124,
      align: "right",
    });

  doc
    .font("Helvetica-Bold")
    .fontSize(7.5)
    .fillColor(COLORS.muted)
    .text("AMOUNT IN WORDS", PAGE.left, y + 4)
    .font("Helvetica")
    .fontSize(8)
    .fillColor(COLORS.text)
    .text(amountInIndianWords(billing.final_amt), PAGE.left, y + 20, {
      width: 250,
      height: 48,
    });

  return y + boxHeight;
}

function addFooters(doc, profile) {
  const range = doc.bufferedPageRange();
  for (let index = range.start; index < range.start + range.count; index += 1) {
    doc.switchToPage(index);
    doc
      .save()
      .font("Helvetica")
      .fontSize(7)
      .fillColor(COLORS.muted)
      .text(
        `Computer-generated tax invoice | ${display(
          profile.authorizedSignatory,
          "Authorised Signatory",
        )} | Page ${index - range.start + 1} of ${range.count}`,
        PAGE.left,
        780,
        { width: PAGE.right - PAGE.left, align: "center", lineBreak: false },
      )
      .restore();
  }
}

export async function renderInvoicePdf({ billing, quote, invoiceProfile = {} }) {
  const configuredProfile = {
    supplierName: "DealFlow",
    supplierAddress: "",
    supplierGstin: "",
    supplierState: "",
    supplierStateCode: "",
    placeOfSupply: "",
    placeOfSupplyCode: "",
    taxType: "AUTO",
    reverseCharge: false,
    authorizedSignatory: "Authorised Signatory",
    ...invoiceProfile,
  };
  const generatedAt = new Date(
    billing.invoice_created_at ?? billing.createdAt ?? Date.now(),
  );
  const customer =
    quote.customer && typeof quote.customer === "object" ? quote.customer : null;
  const customerDetails = customer?._custom_json ?? {};
  const profile = {
    ...configuredProfile,
    placeOfSupply: customerDetails.state || configuredProfile.placeOfSupply,
    placeOfSupplyCode:
      customerDetails.state_code || configuredProfile.placeOfSupplyCode,
  };
  const rows = productRows(quote);
  const gstConfigured = Boolean(
    profile.supplierAddress &&
      profile.supplierGstin &&
      profile.supplierState &&
      profile.supplierStateCode &&
      profile.placeOfSupply &&
      profile.placeOfSupplyCode,
  );
  const doc = new PDFDocument({
    size: "A4",
    margin: PAGE.left,
    bufferPages: true,
    info: {
      Title: `Tax Invoice ${billing.invoice_number ?? billing.invoice_id}`,
      Author: profile.supplierName,
      Subject: `Tax invoice for quote ${quote._id}`,
      CreationDate: generatedAt,
    },
  });
  const chunks = [];
  const completed = new Promise((resolve, reject) => {
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });

  const paintPageBackground = () => {
    doc
      .save()
      .rect(0, 0, doc.page.width, doc.page.height)
      .fill(COLORS.white)
      .restore();
  };
  doc.on("pageAdded", paintPageBackground);
  paintPageBackground();

  doc.save().rect(0, 0, doc.page.width, 88).fill(COLORS.navy).restore();
  doc
    .fillColor(COLORS.white)
    .font("Helvetica-Bold")
    .fontSize(21)
    .text(display(profile.supplierName, "DealFlow"), PAGE.left, 27, {
      width: 290,
      height: 28,
      ellipsis: true,
    })
    .fontSize(20)
    .text("TAX INVOICE", 355, 27, { width: 192, align: "right" })
    .font("Helvetica")
    .fontSize(7)
    .text("Original for Recipient", 355, 54, {
      width: 192,
      align: "right",
    });

  if (!gstConfigured) {
    doc
      .save()
      .rect(PAGE.left, 96, PAGE.right - PAGE.left, 20)
      .fill(COLORS.paleAmber)
      .restore()
      .fillColor(COLORS.amber)
      .font("Helvetica-Bold")
      .fontSize(7.5)
      .text(
        "DRAFT - CONFIGURE SUPPLIER GSTIN, ADDRESS, STATE AND PLACE OF SUPPLY BEFORE ISSUE",
        PAGE.left + 8,
        103,
        { width: PAGE.right - PAGE.left - 16, align: "center" },
      );
  }

  const detailsY = gstConfigured ? 102 : 126;
  doc
    .font("Helvetica-Bold")
    .fontSize(8)
    .fillColor(COLORS.blue)
    .text("SUPPLIER", PAGE.left, detailsY)
    .fillColor(COLORS.text)
    .fontSize(10)
    .text(display(profile.supplierName, "DealFlow"), PAGE.left, detailsY + 15, {
      width: 245,
      height: 14,
      ellipsis: true,
    })
    .font("Helvetica")
    .fontSize(7.5)
    .text(display(profile.supplierAddress), PAGE.left, detailsY + 31, {
      width: 245,
      height: 28,
      ellipsis: true,
    })
    .text(`GSTIN: ${display(profile.supplierGstin)}`, PAGE.left, detailsY + 62)
    .text(
      `State: ${display(profile.supplierState)} | Code: ${display(
        profile.supplierStateCode,
      )}`,
      PAGE.left,
      detailsY + 75,
    );

  doc
    .font("Helvetica-Bold")
    .fontSize(8)
    .fillColor(COLORS.blue)
    .text("INVOICE DETAILS", 330, detailsY)
    .font("Helvetica")
    .fontSize(7.5)
    .fillColor(COLORS.muted)
    .text("Invoice number", 330, detailsY + 17)
    .fillColor(COLORS.text)
    .font("Helvetica-Bold")
    .text(display(billing.invoice_number), 414, detailsY + 17, {
      width: 133,
      align: "right",
    })
    .font("Helvetica")
    .fillColor(COLORS.muted)
    .text("Invoice date", 330, detailsY + 32)
    .fillColor(COLORS.text)
    .text(formatIndiaDate(generatedAt), 414, detailsY + 32, {
      width: 133,
      align: "right",
    })
    .fillColor(COLORS.muted)
    .text("Quote reference", 330, detailsY + 47)
    .fillColor(COLORS.text)
    .text(display(quote._id), 414, detailsY + 47, {
      width: 133,
      align: "right",
      ellipsis: true,
    })
    .fillColor(COLORS.muted)
    .text("Internal invoice ID", 330, detailsY + 62)
    .fillColor(COLORS.text)
    .text(display(billing.invoice_id), 414, detailsY + 62, {
      width: 133,
      align: "right",
      ellipsis: true,
    })
    .fillColor(COLORS.muted)
    .text("Reverse charge", 330, detailsY + 77)
    .fillColor(COLORS.text)
    .text(profile.reverseCharge ? "Yes" : "No", 414, detailsY + 77, {
      width: 133,
      align: "right",
    });

  const recipientY = detailsY + 100;
  doc
    .save()
    .roundedRect(PAGE.left, recipientY, PAGE.right - PAGE.left, 76, 4)
    .fill(COLORS.paleBlue)
    .restore()
    .font("Helvetica-Bold")
    .fontSize(8)
    .fillColor(COLORS.blue)
    .text("BILL TO / SHIP TO", PAGE.left + 12, recipientY + 11)
    .fillColor(COLORS.text)
    .fontSize(9)
    .text(display(customer?.fullName, "Customer"), PAGE.left + 12, recipientY + 26, {
      width: 255,
      height: 13,
      ellipsis: true,
    })
    .font("Helvetica")
    .fontSize(7.5)
    .text(display(customerDetails.delivery_address), PAGE.left + 12, recipientY + 42, {
      width: 255,
      height: 24,
      ellipsis: true,
    })
    .font("Helvetica-Bold")
    .fontSize(7.5)
    .text(
      `Recipient GSTIN/UIN: ${display(customerDetails.gstin, "UNREGISTERED")}`,
      330,
      recipientY + 12,
      { width: 205 },
    )
    .font("Helvetica")
    .text(
      `Place of supply: ${display(
        profile.placeOfSupply,
      )}`,
      330,
      recipientY + 30,
      { width: 205 },
    )
    .text(
      `State code: ${display(
        profile.placeOfSupplyCode,
      )} | Tax: ${resolvedTaxType(profile).replace("_", "+")}`,
      330,
      recipientY + 47,
      { width: 205 },
    );

  doc
    .font("Helvetica-Bold")
    .fontSize(8)
    .fillColor(COLORS.text)
    .text("GOODS AND SERVICES", PAGE.left, recipientY + 90);
  let y = drawRows(doc, rows, recipientY + 104) + 18;

  if (y > 620) {
    doc.addPage();
    y = PAGE.left;
  }
  y = drawSummary(doc, { billing, quote, profile }, y) + 18;

  if (y > 714) {
    doc.addPage();
    y = PAGE.left;
  }
  doc
    .font("Helvetica")
    .fontSize(7.5)
    .fillColor(COLORS.muted)
    .text(
      "Declaration: The particulars shown above are true and correct to the information available in the quote and billing records.",
      PAGE.left,
      y,
      { width: 310 },
    )
    .font("Helvetica-Bold")
    .fillColor(COLORS.text)
    .text(`For ${display(profile.supplierName, "DealFlow")}`, 365, y, {
      width: 182,
      align: "right",
    })
    .font("Helvetica")
    .text(
      display(profile.authorizedSignatory, "Authorised Signatory"),
      365,
      y + 36,
      { width: 182, align: "right" },
    );

  addFooters(doc, profile);
  doc.end();
  return completed;
}
