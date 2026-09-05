// Nodemailer is the SMTP client and BullMQ supplies email-delivery jobs.

import express from "express";
import { Worker } from "bullmq";
import {
  createHttpRequestLogger,
  createLogger,
  shutdownObservability,
} from "@app/observability";
import { config } from "./config.js";

const queueName = "email_consumer_worker";
const port = config.get("email_worker_server_port");
const redisAttributes = {
  "db.system": "redis",
  "server.address": config.get("bullmq_email_redis_host"),
  "server.port": config.get("bullmq_email_redis_port"),
  "db.namespace": config.get("bullmq_email_redis_db"),
  "network.transport": config.get("bullmq_email_redis_tls") ? "tls" : "tcp",
};

const serviceLogger = createLogger("emails.service", {
  "service.component": "service-lifecycle",
});
const workerLogger = createLogger("emails.worker", {
  "service.component": "email-queue-worker",
  "messaging.system": "redis",
  "messaging.destination.name": queueName,
});
const httpLogger = createLogger("emails.http", {
  "service.component": "health-server",
});

const app = express();
let worker;
let workerReady = false;
let shuttingDown = false;

app.use(createHttpRequestLogger(httpLogger));
app.get("/health", (_req, res) => {
  res.status(workerReady ? 200 : 503).json({
    service: "emails",
    status: workerReady ? "ready" : "starting",
  });
});

const server = app.listen(port, () => {
  serviceLogger.info("Email worker health server is listening", {
    "event.name": "service.started",
    "event.outcome": "success",
    "server.port": port,
    "deployment.environment": process.env.NODE_ENV ?? "unknown",
    "process.pid": process.pid,
  });

  try {
    workerLogger.info("Email queue worker initialization started", {
      "event.name": "messaging.worker.initialization.started",
      "event.outcome": "success",
      ...redisAttributes,
    });

    worker = new Worker(
      queueName,
      async (job) => {
        workerLogger.info("Email queue job processing started", {
          "event.name": "messaging.message.processing.started",
          "event.outcome": "success",
          "messaging.operation.name": "process",
          "messaging.message.id": String(job.id),
          "messaging.message.type": job.name,
          "messaging.message.retry.count": job.attemptsMade,
        });
      },
      {
        connection: {
          host: config.get("bullmq_email_redis_host"),
          port: config.get("bullmq_email_redis_port"),
        },
      },
    );

    worker.on("ready", () => {
      workerReady = true;
      workerLogger.info("Email queue worker is ready to receive jobs", {
        "event.name": "messaging.worker.ready",
        "event.outcome": "success",
        ...redisAttributes,
      });
    });

    worker.on("completed", (job) => {
      workerLogger.info("Email queue job processing completed", {
        "event.name": "messaging.message.processing.completed",
        "event.outcome": "success",
        "messaging.operation.name": "process",
        "messaging.message.id": String(job.id),
        "messaging.message.type": job.name,
        "messaging.message.retry.count": job.attemptsMade,
      });
    });

    worker.on("failed", (job, error) => {
      workerLogger.error(
        "Email queue job processing failed",
        {
          "event.name": "messaging.message.processing.failed",
          "event.outcome": "failure",
          "messaging.operation.name": "process",
          ...(job
            ? {
                "messaging.message.id": String(job.id),
                "messaging.message.type": job.name,
                "messaging.message.retry.count": job.attemptsMade,
              }
            : {}),
        },
        error,
      );
    });

    worker.on("stalled", (jobId) => {
      workerLogger.warn("Email queue job stalled and will be retried", {
        "event.name": "messaging.message.processing.stalled",
        "event.outcome": "failure",
        "messaging.message.id": String(jobId),
      });
    });

    worker.on("error", (error) => {
      workerReady = false;
      workerLogger.error(
        "Email queue worker encountered an operational error",
        {
          "event.name": "messaging.worker.error",
          "event.outcome": "failure",
          ...redisAttributes,
        },
        error,
      );
    });

    worker.on("closed", () => {
      workerReady = false;
      workerLogger.info("Email queue worker closed", {
        "event.name": "messaging.worker.closed",
        "event.outcome": "success",
      });
    });
  } catch (error) {
    workerLogger.error(
      "Email queue worker initialization failed",
      {
        "event.name": "messaging.worker.initialization.failed",
        "event.outcome": "failure",
        ...redisAttributes,
      },
      error,
    );
    process.exitCode = 1;
    server.close();
  }
});

server.on("error", (error) => {
  serviceLogger.error(
    "Email worker health server encountered an error",
    {
      "event.name": "http.server.error",
      "event.outcome": "failure",
      "server.port": port,
    },
    error,
  );
});

async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  workerReady = false;

  serviceLogger.info("Email worker graceful shutdown started", {
    "event.name": "service.shutdown.started",
    "event.outcome": "success",
    "process.signal": signal,
  });

  try {
    await worker?.close();
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });

    serviceLogger.info("Email worker graceful shutdown completed", {
      "event.name": "service.shutdown.completed",
      "event.outcome": "success",
      "process.signal": signal,
    });
  } catch (error) {
    process.exitCode = 1;
    serviceLogger.error(
      "Email worker graceful shutdown failed",
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
