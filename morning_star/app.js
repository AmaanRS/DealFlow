import express from "express";
import mongoose from "mongoose";
import { logger } from "@app/observability";
import { config } from "./convict.js";
import { initializeQuoteCollections } from "./models.js";
import quoteRoutes from "./routes/quote.js";

const app = express();
const port = config.get("port");
let databaseReady = false;

app.use(express.json({ limit: "64kb" }));
app.use("/quote", quoteRoutes);

app.get("/health", (_req, res) => {
  res.status(databaseReady ? 200 : 503).json({
    service: "morning-star",
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
  logger.error(
    "Morning Star request failed",
    {
      method: req.method,
      path: req.path,
      error: error.message,
    },
    error,
  );

  if (error instanceof mongoose.Error.ValidationError) {
    res.status(400).json({
      code: "VALIDATION_ERROR",
      message: "The request data is invalid",
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
      message: "A unique value is already in use",
    });
    return;
  }

  if (Number.isInteger(error?.status) && error.status >= 400 && error.status < 600) {
    res.status(error.status).json({
      code: error.code ?? "REQUEST_ERROR",
      message: error.message,
      ...(error.details ? { details: error.details } : {}),
    });
    return;
  }

  res.status(500).json({
    code: "INTERNAL_ERROR",
    message: "The request could not be completed",
  });
});

const server = app.listen(port, async () => {
  logger.info("Morning Star started successfully", { port });

  try {
    await mongoose.connect(config.get("mongodb.uri"));
    const collections = await initializeQuoteCollections();
    databaseReady = true;

    logger.info("Morning Star connected to MongoDB", {
      database: mongoose.connection.name,
      collections: collections.join(","),
    });
  } catch (error) {
    logger.error(
      "Morning Star failed to initialize MongoDB",
      { error: error.message },
      error,
    );

    server.close();
    await mongoose.disconnect();
    process.exitCode = 1;
  }
});
