import assert from "node:assert/strict";
import test from "node:test";
import { logs, SeverityNumber } from "@opentelemetry/api-logs";

const records = [];

logs.setGlobalLoggerProvider({
  getLogger() {
    return {
      emit(record) {
        records.push(record);
      },
    };
  },
});

const { createLogger } = await import("../logger.js");

test.beforeEach(() => {
  records.length = 0;
});

test("logger emits normalized contextual attributes and exceptions", () => {
  const logger = createLogger("test.component", {
    "service.component": "test-component",
  });
  const error = Object.assign(new Error("database unavailable"), {
    code: "ECONNREFUSED",
  });

  logger.error(
    "Operation failed",
    {
      error,
      item: { id: "item-1", credentials: { password: "do-not-log" } },
      mixed_values: [1, "two"],
      redis_url: "redis://user:password@redis:6379/0",
    },
    error,
  );

  assert.equal(records.length, 1);
  assert.equal(records[0].severityNumber, SeverityNumber.ERROR);
  assert.equal(records[0].attributes["service.component"], "test-component");
  assert.equal(records[0].attributes["error.type"], "Error");
  assert.equal(records[0].attributes["error.code"], "ECONNREFUSED");
  assert.equal(records[0].attributes["exception.message"], "database unavailable");
  assert.equal(
    records[0].attributes.item,
    '{"id":"item-1","credentials":{"password":"[REDACTED]"}}',
  );
  assert.deepEqual(records[0].attributes.mixed_values, ["1", "two"]);
  assert.equal(records[0].attributes.redis_url, "[REDACTED]");
  assert.equal("error" in records[0].attributes, false);
});

test("logger supports warning severity", () => {
  const logger = createLogger("test.component");
  logger.warn("Connection interrupted", { retrying: true });

  assert.equal(records.length, 1);
  assert.equal(records[0].severityNumber, SeverityNumber.WARN);
  assert.equal(records[0].severityText, "WARN");
  assert.equal(records[0].attributes.retrying, true);
});
