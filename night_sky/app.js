import express from "express";
import mongoose from "mongoose";
import {
  createHttpRequestLogger,
  createLogger,
  requestLogAttributes,
  shutdownObservability,
} from "@app/observability";
import { config } from "./convict.js";
import { initializeCollections } from "./models.js";
import categoryRoutes from "./routes/category.js";
import productRoutes from "./routes/product.js";
import storeRoutes from "./routes/store.js";
import tierRoutes from "./routes/tier.js";

const app = express();
const port = config.get("port");
let databaseReady = false;
let shuttingDown = false;

const serviceLogger = createLogger("night-sky.service", {
  "service.component": "service-lifecycle",
});
const httpLogger = createLogger("night-sky.http", {
  "service.component": "http-server",
});

app.use(createHttpRequestLogger(httpLogger));
app.use(express.json({ limit: "64kb" }));
app.use("/category", categoryRoutes);
app.use("/product", productRoutes);
app.use("/store", storeRoutes);
app.use("/tier", tierRoutes);

app.get("/health", (_req, res) => {
  res.status(databaseReady ? 200 : 503).json({
    service: "night-sky",
    status: databaseReady ? "ready" : "starting",
  });
});

app.use((req, res) => {
  res.status(404).json({
    code: "ROUTE_NOT_FOUND",
    message: "The requested route does not exist",
  });
});

app.use((error, req, res, _next) => {
  let responseStatus = 500;
  let responseCode = "INTERNAL_ERROR";

  if (
    error instanceof mongoose.Error.ValidationError ||
    (error instanceof SyntaxError && error.status === 400 && "body" in error) ||
    error instanceof mongoose.Error.CastError
  ) {
    responseStatus = 400;
    responseCode =
      error instanceof mongoose.Error.ValidationError
        ? "VALIDATION_ERROR"
        : error instanceof mongoose.Error.CastError
          ? "INVALID_VALUE"
          : "INVALID_JSON";
  } else if (error?.code === 11000) {
    responseStatus = 409;
    responseCode = "DUPLICATE_VALUE";
  } else if (
    Number.isInteger(error?.status) &&
    error.status >= 400 &&
    error.status < 600
  ) {
    responseStatus = error.status;
    responseCode = error.code ?? "REQUEST_ERROR";
  }

  const logLevel = responseStatus >= 500 ? "error" : "warn";
  httpLogger[logLevel](
    responseStatus >= 500 ? "HTTP request failed" : "HTTP request rejected",
    requestLogAttributes(req, {
      "event.name": "http.server.request.failed",
      "event.outcome": "failure",
      "http.response.status_code": responseStatus,
      "application.error.code": responseCode,
      ...(error?.details ? { "application.error.details": error.details } : {}),
      ...(error instanceof mongoose.Error.ValidationError
        ? { "validation.fields": Object.keys(error.errors) }
        : {}),
    }),
    error,
  );

  if (error instanceof mongoose.Error.ValidationError) {
    res.status(400).json({
      code: "VALIDATION_ERROR",
      message: "The product data is invalid",
      fields: Object.fromEntries(
        Object.entries(error.errors).map(([field, fieldError]) => [
          field,
          fieldError.message,
        ]),
      ),
    });
    return;
  }

  if (error instanceof SyntaxError && error.status === 400 && "body" in error) {
    res.status(400).json({
      code: "INVALID_JSON",
      message: "The request body must contain valid JSON",
    });
    return;
  }

  if (error instanceof mongoose.Error.CastError) {
    res.status(400).json({
      code: "INVALID_VALUE",
      message: `${error.path} has an invalid value`,
    });
    return;
  }

  if (error?.code === 11000) {
    res.status(409).json({
      code: "DUPLICATE_VALUE",
      message: "A product record already uses one of these unique values",
    });
    return;
  }

  res.status(responseStatus).json({
    code: responseCode,
    message:
      responseStatus < 500
        ? error.message
        : "The request could not be completed",
  });
});

const server = app.listen(port, async () => {
  serviceLogger.info("Night Sky HTTP server is listening", {
    "event.name": "service.started",
    "event.outcome": "success",
    "server.port": port,
    "deployment.environment": process.env.NODE_ENV ?? "unknown",
    "process.pid": process.pid,
  });

  try {
    await mongoose.connect(config.get("mongodb.uri"));
    const collections = await initializeCollections();
    databaseReady = true;

    serviceLogger.info("Night Sky MongoDB initialization completed", {
      "event.name": "database.initialization.completed",
      "event.outcome": "success",
      "db.system": "mongodb",
      "db.namespace": mongoose.connection.name,
      "server.address": mongoose.connection.host,
      "server.port": mongoose.connection.port,
      "database.collection.count": collections.length,
      "database.collections": collections,
    });
  } catch (error) {
    serviceLogger.error(
      "Night Sky MongoDB initialization failed",
      {
        "event.name": "database.initialization.failed",
        "event.outcome": "failure",
        "db.system": "mongodb",
      },
      error,
    );

    server.close();
    await mongoose.disconnect();
    process.exitCode = 1;
  }
});

server.on("error", (error) => {
  serviceLogger.error(
    "Night Sky HTTP server encountered an error",
    {
      "event.name": "http.server.error",
      "event.outcome": "failure",
      "server.port": port,
    },
    error,
  );
});

mongoose.connection.on("disconnected", () => {
  databaseReady = false;
  const logLevel = shuttingDown ? "info" : "warn";
  serviceLogger[logLevel]("Night Sky disconnected from MongoDB", {
    "event.name": "database.connection.disconnected",
    "event.outcome": shuttingDown ? "success" : "failure",
    "db.system": "mongodb",
    "db.namespace": mongoose.connection.name,
  });
});

mongoose.connection.on("error", (error) => {
  databaseReady = false;
  serviceLogger.error(
    "Night Sky MongoDB connection encountered an error",
    {
      "event.name": "database.connection.error",
      "event.outcome": "failure",
      "db.system": "mongodb",
      "db.namespace": mongoose.connection.name,
    },
    error,
  );
});

async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  databaseReady = false;

  serviceLogger.info("Night Sky graceful shutdown started", {
    "event.name": "service.shutdown.started",
    "event.outcome": "success",
    "process.signal": signal,
  });

  try {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
    await mongoose.disconnect();

    serviceLogger.info("Night Sky graceful shutdown completed", {
      "event.name": "service.shutdown.completed",
      "event.outcome": "success",
      "process.signal": signal,
    });
  } catch (error) {
    process.exitCode = 1;
    serviceLogger.error(
      "Night Sky graceful shutdown failed",
      {
        "event.name": "service.shutdown.failed",
        "event.outcome": "failure",
        "process.signal": signal,
      },
      error,
    );
  } finally {
    await shutdownObservability();
  }
}

process.once("SIGTERM", () => void shutdown("SIGTERM"));
process.once("SIGINT", () => void shutdown("SIGINT"));
