// Nodemailer as smtp client and gmail as mail server based emailing soln

// This is an bull queue worker, it consumes task from email bull queue and then sends the email

import express from "express";
import { config } from "./config.js";
import { Worker } from "bullmq";
import { logger } from "@app/observability";

const app = express();

app.listen(config.get("email_worker_server_port"), (err) => {
  if (err) console.log(err);
  logger.info(
    `Email worker started successfully and is listening on ${config.get("email_worker_server_port")}`,
  );
  logger.info("Starting BullMQ worker");
  try {
    const wrkr = new Worker("email_consumer_worker", async () => {}, {
      connection: {
        host: config.get("bullmq_email_redis_host"),
        port: config.get("bullmq_email_redis_port"),
      },
    });
    logger.info(`BullMQ worker started successfully`, { wrkr });
  } catch (e) {
    logger.error(`Starting BullMQ Failed`, { error: e });
  }
});
