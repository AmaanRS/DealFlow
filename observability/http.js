import { randomUUID } from "node:crypto";

export function requestLogAttributes(req, attributes = {}) {
  return {
    "request.id": req.requestId,
    "http.request.method": req.method,
    "url.path": req.originalUrl?.split("?", 1)[0] ?? req.path,
    "client.address": req.ip ?? req.socket?.remoteAddress,
    "user_agent.original": req.get?.("user-agent"),
    ...attributes,
  };
}

export function createHttpRequestLogger(logger) {
  return function logHttpRequest(req, res, next) {
    const suppliedRequestId = req.get("x-request-id")?.trim();
    req.requestId =
      suppliedRequestId && suppliedRequestId.length <= 128
        ? suppliedRequestId
        : randomUUID();
    res.setHeader("x-request-id", req.requestId);

    const startedAt = process.hrtime.bigint();
    let completed = false;
    let applicationErrorCode;

    if (typeof res.json === "function") {
      const sendJson = res.json;
      res.json = function sendLoggedJson(body) {
        if (
          res.statusCode >= 400 &&
          body &&
          typeof body === "object" &&
          typeof body.code === "string"
        ) {
          applicationErrorCode = body.code;
        }

        return sendJson.call(this, body);
      };
    }

    res.once("finish", () => {
      completed = true;
      const durationMillis = Number(process.hrtime.bigint() - startedAt) / 1e6;
      const attributes = requestLogAttributes(req, {
        "event.name": "http.server.request.completed",
        "event.outcome": res.statusCode >= 400 ? "failure" : "success",
        "http.response.status_code": res.statusCode,
        "http.request.body.size": Number(req.get("content-length") ?? 0),
        "http.response.body.size": Number(res.getHeader("content-length") ?? 0),
        "http.server.duration_ms": Math.round(durationMillis * 100) / 100,
        ...(applicationErrorCode
          ? { "application.error.code": applicationErrorCode }
          : {}),
      });

      const method = req.path === "/health" ? "debug" : "info";
      logger[method]("HTTP request completed", attributes);
    });

    res.once("close", () => {
      if (completed) return;

      const durationMillis = Number(process.hrtime.bigint() - startedAt) / 1e6;
      logger.warn(
        "HTTP request connection closed before a response was completed",
        requestLogAttributes(req, {
          "event.name": "http.server.request.aborted",
          "event.outcome": "failure",
          "http.server.duration_ms": Math.round(durationMillis * 100) / 100,
        }),
      );
    });

    next();
  };
}
