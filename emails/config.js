import convict from "convict";
import { loadEnvFile } from "node:process";

loadEnvFile(new URL("./.env", import.meta.url));

// Redis conn string format validator
convict.addFormat({
  name: "redis_url",
  validate: function (val) {
    // Ensure it is a non-empty string first
    if (typeof val !== "string") {
      throw new Error("must be a string");
    }

    try {
      const parsedUrl = new URL(val);

      // Enforce the standard Redis protocol protocols
      if (parsedUrl.protocol !== "redis:" && parsedUrl.protocol !== "rediss:") {
        throw new Error('Protocol must be "redis:" or "rediss:"');
      }

      // Ensure host is explicitly provided
      if (!parsedUrl.hostname) {
        throw new Error("Missing hostname in connection string");
      }
    } catch (err) {
      throw new Error(`Invalid Redis connection string format: ${err.message}`);
    }
  },
});

convict.addFormat({
  name: "positive-int",
  validate(value) {
    if (!Number.isInteger(value) || value <= 0) {
      throw new Error("must be a positive integer");
    }
  },
  coerce(value) {
    return Number(value);
  },
});

const config = convict({
  email_worker_server_port: {
    format: "port",
    env: "EMAIL_WORKER_SERVER_PORT",
  },
  bullmq_email_redis_url: {
    format: "redis-url",
    env: "BULLMQ_EMAIL_REDIS_URL",
    sensitive: true,
  },

  bullmq_email_redis_host: {
    format: String,
  },

  bullmq_email_redis_port: {
    format: "port",
  },

  bullmq_email_redis_username: {
    format: String,
  },

  bullmq_email_redis_password: {
    format: String,
  },

  bullmq_email_redis_db: {
    format: "nat",
    default: 0,
  },

  bullmq_email_redis_tls: {
    format: Boolean,
    default: false,
  },
  otel_service_name: {
    format: String,
  },
  otel_exporter_otlp_endpoint: {
    format: String,
  },
  otel_metric_export_interval: {
    format: "positive-int",
  },
});

const redisUrl = new URL(config.get("bullmq_email_redis_url"));
const databasePath = redisUrl.pathname.slice(1);
const database = databasePath === "" ? 0 : Number(databasePath);

if (!Number.isInteger(database) || database < 0) {
  throw new Error("Redis URL database must be a non-negative integer");
}

config.load({
  bullmq_email_redis_host: redisUrl.hostname,
  bullmq_email_redis_port: Number(redisUrl.port),
  bullmq_email_redis_username: decodeURIComponent(redisUrl.username),
  bullmq_email_redis_password: decodeURIComponent(redisUrl.password),
  bullmq_email_redis_db: database,
  bullmq_email_redis_tls: redisUrl.protocol === "rediss:",
});

// config.loadFile("./.env");
config.validate({ allowed: "strict" });

export { config };
