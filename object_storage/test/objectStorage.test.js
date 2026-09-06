import assert from "node:assert/strict";
import test from "node:test";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import { ObjectStorage } from "../index.js";

function storageWithClient(client) {
  return new ObjectStorage(
    {
      endpoint: "http://garage:3900",
      region: "garage",
      bucket: "dealflow-objects",
      accessKeyId: "test-key",
      secretAccessKey: "test-secret",
    },
    { client },
  );
}

test("base64 objects are written under the supplied key", async () => {
  let command;
  const base64 = Buffer.from("%PDF-test").toString("base64");
  const storage = storageWithClient({
    async send(value) {
      command = value;
      return { ETag: "etag-1" };
    },
  });

  const result = await storage.putBase64Object({
    key: "invoice-id",
    data: base64,
    metadata: { "invoice-id": "invoice-id" },
  });

  assert.ok(command instanceof PutObjectCommand);
  assert.equal(command.input.Bucket, "dealflow-objects");
  assert.equal(command.input.Key, "invoice-id");
  assert.equal(command.input.Body, base64);
  assert.equal(command.input.ContentType, "text/plain; charset=utf-8");
  assert.equal(command.input.Metadata["stored-encoding"], "base64");
  assert.equal(result.key, "invoice-id");
});

test("object reads and deletes use the shared bucket", async () => {
  const commands = [];
  const storage = storageWithClient({
    async send(command) {
      commands.push(command);
      if (command instanceof GetObjectCommand) {
        return { Body: { transformToString: async () => "base64-data" } };
      }
      return {};
    },
  });

  assert.equal(await storage.getObjectText("invoice-id"), "base64-data");
  await storage.deleteObject("invoice-id");

  assert.ok(commands[0] instanceof GetObjectCommand);
  assert.ok(commands[1] instanceof DeleteObjectCommand);
  assert.equal(commands[1].input.Bucket, "dealflow-objects");
});

test("invalid base64 is rejected before an upload", async () => {
  const storage = storageWithClient({
    async send() {
      throw new Error("send must not be called");
    },
  });

  await assert.rejects(
    storage.putBase64Object({ key: "invoice-id", data: "not base64" }),
    /base64/,
  );
});
