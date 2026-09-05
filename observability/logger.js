import { logs, SeverityNumber } from "@opentelemetry/api-logs";

const levels = Object.freeze({
  trace: [SeverityNumber.TRACE, "TRACE"],
  debug: [SeverityNumber.DEBUG, "DEBUG"],
  info: [SeverityNumber.INFO, "INFO"],
  warn: [SeverityNumber.WARN, "WARN"],
  error: [SeverityNumber.ERROR, "ERROR"],
});

const sensitiveAttributePattern =
  /(?:^|[._-])(?:authorization|cookie|password|passwd|secret|token|api[._-]?key|connection[._-]?(?:string|url|uri)|redis[._-]?(?:url|uri)|mongodb[._-]?(?:url|uri))(?:$|[._-])/i;

function redactStructuredValue(value, seen = new WeakSet()) {
  if (typeof value === "bigint") return String(value);
  if (typeof value === "number" && !Number.isFinite(value)) {
    return String(value);
  }
  if (value === null || typeof value !== "object") return value;
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      ...(value.code !== undefined ? { code: String(value.code) } : {}),
    };
  }
  if (seen.has(value)) return "[Circular]";

  seen.add(value);
  if (Array.isArray(value)) {
    return value.map((entry) => redactStructuredValue(entry, seen));
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [
      key,
      sensitiveAttributePattern.test(key)
        ? "[REDACTED]"
        : redactStructuredValue(entry, seen),
    ]),
  );
}

function attributeValue(value) {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : String(value);
  }
  if (typeof value === "bigint") return String(value);
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) {
    const normalizedValues = value.map((entry) => {
      const normalized = attributeValue(entry);
      return ["string", "number", "boolean"].includes(typeof normalized)
        ? normalized
        : String(normalized);
    });
    const valueTypes = new Set(normalizedValues.map((entry) => typeof entry));
    return valueTypes.size <= 1
      ? normalizedValues
      : normalizedValues.map(String);
  }
  if (value instanceof Error) return value.message;

  try {
    return JSON.stringify(redactStructuredValue(value));
  } catch {
    return String(value);
  }
}

function normalizeAttributes(attributes) {
  return Object.fromEntries(
    Object.entries(attributes)
      .map(([key, value]) => [
        key,
        sensitiveAttributePattern.test(key)
          ? "[REDACTED]"
          : attributeValue(value),
      ])
      .filter(([, value]) => value !== undefined),
  );
}

export function errorAttributes(error) {
  if (!error) return {};

  return {
    "error.type": error.name ?? "Error",
    "error.message": error.message ?? String(error),
    "exception.type": error.name ?? "Error",
    "exception.message": error.message ?? String(error),
    ...(error.code !== undefined ? { "error.code": String(error.code) } : {}),
    ...(error.stack ? { "exception.stacktrace": error.stack } : {}),
  };
}

export function createLogger(name = "application", defaultAttributes = {}) {
  const otelLogger = logs.getLogger(name);

  function emit(level, body, attributes = {}, exception) {
    const [severityNumber, severityText] = levels[level];
    const inputAttributes =
      attributes && typeof attributes === "object" ? attributes : {};
    const effectiveException =
      exception ??
      (inputAttributes.error instanceof Error ? inputAttributes.error : null);
    const { error: _ignoredError, ...safeAttributes } = inputAttributes;

    otelLogger.emit({
      severityNumber,
      severityText,
      body: String(body),
      attributes: normalizeAttributes({
        ...defaultAttributes,
        ...safeAttributes,
        ...errorAttributes(effectiveException),
      }),
    });
  }

  return Object.freeze({
    trace: (body, attributes) => emit("trace", body, attributes),
    debug: (body, attributes) => emit("debug", body, attributes),
    info: (body, attributes) => emit("info", body, attributes),
    warn: (body, attributes, exception) =>
      emit("warn", body, attributes, exception),

    error: (body, attributes, exception) =>
      emit("error", body, attributes, exception),
  });
}

export const logger = createLogger();
