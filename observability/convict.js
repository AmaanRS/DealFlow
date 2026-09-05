import { loadEnvFile } from "node:process";
import convict from "convict";

convict.addFormat({
  name: "http-url",
  validate(value) {
    let url;

    try {
      url = new URL(value);
    } catch {
      throw new Error("must be a valid URL");
    }

    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new Error("must use http or https");
    }
  },
});

convict.addFormat({
  name: "positive-int",
  validate(value) {
    if (!Number.isInteger(value) || value <= 0) {
      throw new Error("must be a positive integer");
    }
  },
  coerce(value) {
    return Number(value);
  },
});

const config = convict({
  service: {
    name: {
      doc: "Name attached to telemetry emitted by this service",
      format: String,
      default: null,
      env: "OTEL_SERVICE_NAME",
    },
  },
  otlp: {
    endpoint: {
      doc: "Base OTLP/HTTP collector endpoint",
      format: "http-url",
      default: null,
      env: "OTEL_EXPORTER_OTLP_ENDPOINT",
    },
  },
  metrics: {
    exportIntervalMillis: {
      doc: "How frequently metrics are exported",
      format: "positive-int",
      default: null,
      env: "OTEL_METRIC_EXPORT_INTERVAL",
    },
  },
});

config.validate({ allowed: "strict" });

export function getOtlpSignalEndpoint(signal) {
  if (!new Set(["traces", "metrics", "logs"]).has(signal)) {
    throw new Error(`Unsupported OTLP signal: ${signal}`);
  }

  const endpoint = new URL(config.get("otlp.endpoint"));
  endpoint.pathname = `${endpoint.pathname.replace(/\/+$/, "")}/v1/${signal}`;

  return endpoint.toString();
}

export { config };
