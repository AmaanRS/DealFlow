import { logs, SeverityNumber } from "@opentelemetry/api-logs";

const levels = {
  trace: [SeverityNumber.TRACE, "TRACE"],
  debug: [SeverityNumber.DEBUG, "DEBUG"],
  info: [SeverityNumber.INFO, "INFO"],
  error: [SeverityNumber.ERROR, "ERROR"],
};

export function createLogger(name = "application") {
  const otelLogger = logs.getLogger(name);

  function emit(level, body, attributes = {}, exception) {
    const [severityNumber, severityText] = levels[level];

    otelLogger.emit({
      severityNumber,
      severityText,
      body,
      attributes,
      ...(exception ? { exception } : {}),
    });
  }

  return Object.freeze({
    trace: (body, attributes) => emit("trace", body, attributes),
    debug: (body, attributes) => emit("debug", body, attributes),
    info: (body, attributes) => emit("info", body, attributes),

    error: (body, attributes, exception) =>
      emit("error", body, attributes, exception),
  });
}

export const logger = createLogger();
