import { NodeSDK } from "@opentelemetry/sdk-node";
import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";
import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-http";
import { PeriodicExportingMetricReader } from "@opentelemetry/sdk-metrics";
import { BatchLogRecordProcessor } from "@opentelemetry/sdk-logs";
import { config, getOtlpSignalEndpoint } from "./convict.js";

const stateKey = Symbol.for("observability.node-sdk.state");

const state = globalThis[stateKey] ?? {
  sdk: undefined,
  started: false,
  shutdownPromise: undefined,
};

globalThis[stateKey] = state;

/**
 * Start OpenTelemetry once for the current Node.js process.
 *
 * Exporter URLs and service metadata are read from the standard environment
 * variables, including OTEL_SERVICE_NAME and OTEL_EXPORTER_OTLP_ENDPOINT.
 */
export function startObservability() {
  if (state.started) {
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
