import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import { createHttpRequestLogger } from "../http.js";

function createRequest(path = "/products?category=hardware") {
  const headers = {
    "content-length": "24",
    "user-agent": "observability-test",
    "x-request-id": "request-123",
  };

  return {
    method: "GET",
    path: path.split("?", 1)[0],
    originalUrl: path,
    ip: "127.0.0.1",
    get(name) {
      return headers[name.toLowerCase()];
    },
  };
}

function createResponse() {
  const response = new EventEmitter();
  const headers = new Map();
  response.statusCode = 200;
  response.setHeader = (name, value) => headers.set(name.toLowerCase(), value);
  response.getHeader = (name) => headers.get(name.toLowerCase());
  response.json = (body) => body;
  response.setHeader("content-length", "48");
  return response;
}

function createCaptureLogger() {
  const records = [];
  return {
    records,
    logger: Object.fromEntries(
      ["debug", "info", "warn"].map((level) => [
        level,
        (body, attributes) => records.push({ level, body, attributes }),
      ]),
    ),
  };
}

test("HTTP request logger records completion context and propagates request ID", () => {
  const req = createRequest();
  const res = createResponse();
  const capture = createCaptureLogger();
  let continued = false;

  createHttpRequestLogger(capture.logger)(req, res, () => {
    continued = true;
  });
  res.emit("finish");

  assert.equal(continued, true);
  assert.equal(req.requestId, "request-123");
  assert.equal(res.getHeader("x-request-id"), "request-123");
  assert.equal(capture.records.length, 1);
  assert.equal(capture.records[0].level, "info");
  assert.equal(capture.records[0].attributes["url.path"], "/products");
  assert.equal(capture.records[0].attributes["http.response.status_code"], 200);
  assert.equal(capture.records[0].attributes["http.request.body.size"], 24);
  assert.equal(capture.records[0].attributes["http.response.body.size"], 48);
  assert.equal(capture.records[0].attributes["event.outcome"], "success");
});

test("HTTP request logger reports an aborted connection once", () => {
  const req = createRequest("/quote/123");
  const res = createResponse();
  const capture = createCaptureLogger();

  createHttpRequestLogger(capture.logger)(req, res, () => {});
  res.emit("close");

  assert.equal(capture.records.length, 1);
  assert.equal(capture.records[0].level, "warn");
  assert.equal(
    capture.records[0].attributes["event.name"],
    "http.server.request.aborted",
  );
});

test("HTTP request logger records application codes for handled error responses", () => {
  const req = createRequest("/product/not-an-id");
  const res = createResponse();
  const capture = createCaptureLogger();

  createHttpRequestLogger(capture.logger)(req, res, () => {});
  res.statusCode = 400;
  res.json({ code: "INVALID_ITEM_ID", message: "Invalid item" });
  res.emit("finish");

  assert.equal(capture.records.length, 1);
  assert.equal(capture.records[0].attributes["event.outcome"], "failure");
  assert.equal(
    capture.records[0].attributes["application.error.code"],
    "INVALID_ITEM_ID",
  );
});
