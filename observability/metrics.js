import { metrics as metricsApi } from "@opentelemetry/api";
import { performance } from "node:perf_hooks";

/**
 * Create metric helpers for one instrumentation scope.
 * Instruments should be created once and reused throughout the application.
 */
export function createMetrics(name = "application", version) {
  const meter = metricsApi.getMeter(name, version);

  /** Record the execution time of an operation in milliseconds. */
  async function recordDuration(histogram, operation, attributes = {}) {
    const startedAt = performance.now();

    try {
      return await operation();
    } finally {
      histogram.record(performance.now() - startedAt, attributes);
    }
  }

  return Object.freeze({
    meter,
    createCounter: (instrumentName, options) =>
      meter.createCounter(instrumentName, options),
    createUpDownCounter: (instrumentName, options) =>
      meter.createUpDownCounter(instrumentName, options),
    createGauge: (instrumentName, options) =>
      meter.createGauge(instrumentName, options),
    createHistogram: (instrumentName, options) =>
      meter.createHistogram(instrumentName, options),
    createObservableCounter: (instrumentName, options) =>
      meter.createObservableCounter(instrumentName, options),
    createObservableUpDownCounter: (instrumentName, options) =>
      meter.createObservableUpDownCounter(instrumentName, options),
    createObservableGauge: (instrumentName, options) =>
      meter.createObservableGauge(instrumentName, options),
    recordDuration,
  });
}

export const telemetryMetrics = createMetrics();
