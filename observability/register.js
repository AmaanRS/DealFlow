import { NodeSDK } from "@opentelemetry/sdk-node";
import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";
import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-http";
import { PeriodicExportingMetricReader } from "@opentelemetry/sdk-metrics";
import { BatchLogRecordProcessor } from "@opentelemetry/sdk-logs";
import { config, getOtlpSignalEndpoint } from "./convict.js";
import { createLogger } from "./logger.js";

const stateKey = Symbol.for("observability.node-sdk.state");

const state = globalThis[stateKey] ?? {
  sdk: undefined,
  started: false,
  shutdownPromise: undefined,
};

globalThis[stateKey] = state;
const logger = createLogger("observability.sdk", {
  "service.component": "telemetry",
});

/**
 * Start OpenTelemetry once for the current Node.js process.
 *
 * Exporter URLs and service metadata are read from the standard environment
 * variables, including OTEL_SERVICE_NAME and OTEL_EXPORTER_OTLP_ENDPOINT.
 */
export function startObservability() {
  if (state.started) {
    logger.debug("OpenTelemetry SDK start skipped because it is already running", {
      "event.name": "telemetry.sdk.start.skipped",
      "event.outcome": "success",
    });
    return state.sdk;
  }

  const sdk = new NodeSDK({
    serviceName: config.get("service.name"),
    traceExporter: new OTLPTraceExporter({
      url: getOtlpSignalEndpoint("traces"),
    }),
    metricReaders: [
      new PeriodicExportingMetricReader({
        exporter: new OTLPMetricExporter({
          url: getOtlpSignalEndpoint("metrics"),
        }),
        exportIntervalMillis: config.get("metrics.exportIntervalMillis"),
      }),
    ],
    logRecordProcessors: [
      new BatchLogRecordProcessor({
        exporter: new OTLPLogExporter({
          url: getOtlpSignalEndpoint("logs"),
        }),
      }),
    ],
    instrumentations: [getNodeAutoInstrumentations()],
  });

  // start() is synchronous and registers the providers globally.
  sdk.start();

  state.sdk = sdk;
  state.started = true;

  logger.info("OpenTelemetry SDK started", {
    "event.name": "telemetry.sdk.started",
    "event.outcome": "success",
    "service.name": config.get("service.name"),
    "telemetry.exporter.protocol": "otlp_http",
    "telemetry.metric.export_interval_ms": config.get(
      "metrics.exportIntervalMillis",
    ),
  });

  return sdk;
}

/**
 * Flush pending telemetry and stop the SDK. Safe to call more than once.
 * The application should call this from its SIGTERM/SIGINT shutdown handler.
 */
export function shutdownObservability() {
  if (!state.started || !state.sdk) {
    return Promise.resolve();
  }

  if (!state.shutdownPromise) {
    logger.info("OpenTelemetry SDK shutdown started", {
      "event.name": "telemetry.sdk.shutdown.started",
      "event.outcome": "success",
      "service.name": config.get("service.name"),
    });
    state.shutdownPromise = state.sdk.shutdown().finally(() => {
      state.sdk = undefined;
      state.started = false;
      state.shutdownPromise = undefined;
    });
  }

  return state.shutdownPromise;
}

export const sdk = startObservability();

// Flush telemetry when the application exits naturally. Services should still
// call shutdownObservability() while handling container termination signals.
process.once("beforeExit", () => {
  void shutdownObservability();
});
