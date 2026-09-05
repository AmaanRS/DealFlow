import express from "express";
import mongoose from "mongoose";
import { logger } from "@app/observability";
import { config } from "./convict.js";
import { initializeCollections } from "./models.js";
import productRoutes from "./routes/product.js";
import storeRoutes from "./routes/store.js";

const app = express();
const port = config.get("port");

app.use(express.json({ limit: "64kb" }));
app.use("/product", productRoutes);
app.use("/store", storeRoutes);

app.use((req, res) => {
  res.status(404).json({
    code: "ROUTE_NOT_FOUND",
    message: "The requested route does not exist",
  });
});

app.use((error, req, res, _next) => {
  logger.error(
    "Night Sky request failed",
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

  if (error?.code === 11000) {
    res.status(409).json({
      code: "DUPLICATE_VALUE",
      message: "A product record already uses one of these unique values",
    });
    return;
  }

  res.status(error.status ?? 500).json({
    code: error.code ?? "INTERNAL_ERROR",
    message:
      error.status && error.status < 500
        ? error.message
        : "The request could not be completed",
  });
});

const server = app.listen(port, async () => {
  logger.info("Night Sky started successfully", { port });

  try {
    await mongoose.connect(config.get("mongodb.uri"));
    const collections = await initializeCollections();

    logger.info("Night Sky connected to MongoDB", {
      database: mongoose.connection.name,
      collections: collections.join(","),
    });
  } catch (error) {
    logger.error(
      "Night Sky failed to initialize MongoDB",
      { error: error.message },
      error,
    );

    server.close();
    await mongoose.disconnect();
    process.exitCode = 1;
  }
});
