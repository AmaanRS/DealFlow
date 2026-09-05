import { SpanStatusCode, trace } from "@opentelemetry/api";

/**
 * Create tracing helpers for one instrumentation scope.
 * Use a stable scope name such as "email-worker" or "billing-service".
 */
export function createTracing(name = "application", version) {
  const tracer = trace.getTracer(name, version);

  /**
   * Run an operation inside an active span. The span is always ended, and
   * thrown errors are recorded before being rethrown to the caller.
   */
  async function withSpan(spanName, operation, options = {}) {
    return tracer.startActiveSpan(spanName, options, async (span) => {
      try {
        const result = await operation(span);
        span.setStatus({ code: SpanStatusCode.OK });
        return result;
      } catch (error) {
        const exception =
          error instanceof Error ? error : new Error(String(error));

        span.recordException(exception);
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: exception.message,
        });

        throw error;
      } finally {
        span.end();
      }
    });
  }

  return Object.freeze({
    tracer,
    withSpan,
    startSpan: (spanName, options, parentContext) =>
      tracer.startSpan(spanName, options, parentContext),
    getActiveSpan: () => trace.getActiveSpan(),
  });
}

export const tracing = createTracing();
