import convict from "convict";
import { loadEnvFile } from "node:process";

try {
  loadEnvFile(new URL("./.env", import.meta.url));
} catch (error) {
  if (error?.code !== "ENOENT") {
    throw error;
  }
}

convict.addFormat({
  name: "mongodb-uri",
  validate(value) {
    let uri;

    try {
      uri = new URL(value);
    } catch {
      throw new Error("must be a valid MongoDB connection string");
    }

    if (uri.protocol !== "mongodb:" && uri.protocol !== "mongodb+srv:") {
      throw new Error("must use mongodb or mongodb+srv");
    }
  },
});

convict.addFormat({
  name: "http-url",
  validate(value) {
    let url;

    try {
      url = new URL(value);
    } catch {
      throw new Error("must be a valid HTTP URL");
    }

    if (!["http:", "https:"].includes(url.protocol)) {
      throw new Error("must use http or https");
    }
  },
});

convict.addFormat({
  name: "gstin-or-empty",
  validate(value) {
    if (
      value !== "" &&
      !/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(value)
    ) {
      throw new Error("must be empty or a valid 15-character GSTIN");
    }
  },
  coerce(value) {
    return String(value).trim().toUpperCase();
  },
});

convict.addFormat({
  name: "gst-state-code-or-empty",
  validate(value) {
    if (value !== "" && !/^(0[1-9]|[12][0-9]|3[0-8]|9[79])$/.test(value)) {
      throw new Error("must be empty or a valid two-digit GST state code");
    }
  },
  coerce(value) {
    return String(value).trim();
  },
});

const config = convict({
  port: {
    doc: "Port used by the Morning Star HTTP server",
    format: "port",
    default: 3002,
    env: "MORNING_STAR_PORT",
  },
  mongodb: {
    uri: {
      doc: "MongoDB connection string used by Morning Star",
      format: "mongodb-uri",
      default: "mongodb://localhost:27017/dealflow",
      env: "MONGODB_URI",
      sensitive: true,
    },
  },
  objectStorage: {
    endpoint: {
      doc: "S3-compatible object storage endpoint",
      format: "http-url",
      default: "http://localhost:3900",
      env: "OBJECT_STORAGE_ENDPOINT",
    },
    region: {
      doc: "Object storage region",
      format: String,
      default: "garage",
      env: "OBJECT_STORAGE_REGION",
    },
    bucket: {
      doc: "Shared object storage bucket",
      format: String,
      default: "dealflow-objects",
      env: "OBJECT_STORAGE_BUCKET",
    },
    accessKeyId: {
      doc: "Object storage access key ID",
      format: String,
      default: "GK00000000000000000000000000000000",
      env: "OBJECT_STORAGE_ACCESS_KEY_ID",
      sensitive: true,
    },
    secretAccessKey: {
      doc: "Object storage secret access key",
      format: String,
      default:
        "0000000000000000000000000000000000000000000000000000000000000000",
      env: "OBJECT_STORAGE_SECRET_ACCESS_KEY",
      sensitive: true,
    },
    forcePathStyle: {
      doc: "Use S3 path-style bucket addressing",
      format: Boolean,
      default: true,
      env: "OBJECT_STORAGE_FORCE_PATH_STYLE",
    },
  },
  invoice: {
    supplierName: {
      doc: "Legal name printed for the supplier on Indian tax invoices",
      format: String,
      default: "DealFlow",
      env: "INVOICE_SUPPLIER_NAME",
    },
    supplierAddress: {
      doc: "Registered supplier address printed on tax invoices",
      format: String,
      default: "",
      env: "INVOICE_SUPPLIER_ADDRESS",
    },
    supplierGstin: {
      doc: "Supplier GSTIN; left empty until a real GSTIN is configured",
      format: "gstin-or-empty",
      default: "",
      env: "INVOICE_SUPPLIER_GSTIN",
      sensitive: true,
    },
    supplierState: {
      doc: "Supplier state or union territory",
      format: String,
      default: "",
      env: "INVOICE_SUPPLIER_STATE",
    },
    supplierStateCode: {
      doc: "Two-digit GST state code of the supplier",
      format: "gst-state-code-or-empty",
      default: "",
      env: "INVOICE_SUPPLIER_STATE_CODE",
    },
    placeOfSupply: {
      doc: "Default place of supply when the quote has no structured state",
      format: String,
      default: "",
      env: "INVOICE_PLACE_OF_SUPPLY",
    },
    placeOfSupplyCode: {
      doc: "Two-digit GST state code for the default place of supply",
      format: "gst-state-code-or-empty",
      default: "",
      env: "INVOICE_PLACE_OF_SUPPLY_CODE",
    },
    taxType: {
      doc: "GST presentation: automatic, IGST, CGST_SGST, or unsplit GST",
      format: ["AUTO", "GST", "IGST", "CGST_SGST"],
      default: "AUTO",
      env: "INVOICE_TAX_TYPE",
    },
    reverseCharge: {
      doc: "Whether tax is payable on a reverse-charge basis",
      format: Boolean,
      default: false,
      env: "INVOICE_REVERSE_CHARGE",
    },
    authorizedSignatory: {
      doc: "Name or title printed in the supplier signature area",
      format: String,
      default: "Authorised Signatory",
      env: "INVOICE_AUTHORIZED_SIGNATORY",
    },
  },
});

config.validate({ allowed: "strict" });

export { config };
