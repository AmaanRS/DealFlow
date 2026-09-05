import convict from "convict";
import { loadEnvFile } from "node:process";

try {
  loadEnvFile(new URL("./.env", import.meta.url));
} catch (error) {
  // The file is optional when the runtime injects values into process.env.
  if (error?.code !== "ENOENT") {
    throw error;
  }
}

// Redis conn string format validator
convict.addFormat({
  name: "redis-url",
  validate: function (val) {
    // The URL is optional because host and port are also supported.
    if (val === null || val === "") {
      return;
    }

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
    default: 3000,
    env: "EMAIL_WORKER_SERVER_PORT",
  },
  bullmq_email_redis_url: {
    format: "redis-url",
    default: null,
    env: "BULLMQ_EMAIL_REDIS_URL",
    sensitive: true,
  },

  bullmq_email_redis_host: {
    format: String,
    default: "localhost",
    env: "BULLMQ_EMAIL_REDIS_HOST",
  },

  bullmq_email_redis_port: {
    format: "port",
    default: 6379,
    env: "BULLMQ_EMAIL_REDIS_PORT",
  },

  bullmq_email_redis_username: {
    format: String,
    default: "",
    env: "BULLMQ_EMAIL_REDIS_USERNAME",
  },

  bullmq_email_redis_password: {
    format: String,
    default: "",
    env: "BULLMQ_EMAIL_REDIS_PASSWORD",
    sensitive: true,
  },

  bullmq_email_redis_db: {
    format: "nat",
    default: 0,
    env: "BULLMQ_EMAIL_REDIS_DB",
  },

  bullmq_email_redis_tls: {
    format: Boolean,
    default: false,
    env: "BULLMQ_EMAIL_REDIS_TLS",
  },
});

const redisConnectionString = config.get("bullmq_email_redis_url");

if (redisConnectionString) {
  const redisUrl = new URL(redisConnectionString);
  const databasePath = redisUrl.pathname.slice(1);
  const database = databasePath === "" ? 0 : Number(databasePath);

  if (!Number.isInteger(database) || database < 0) {
    throw new Error("Redis URL database must be a non-negative integer");
  }

  // A connection URL takes precedence over separate Redis environment values.
  config.set("bullmq_email_redis_host", redisUrl.hostname);
  config.set(
    "bullmq_email_redis_port",
    redisUrl.port ? Number(redisUrl.port) : 6379,
  );
  config.set(
    "bullmq_email_redis_username",
    decodeURIComponent(redisUrl.username),
  );
  config.set(
    "bullmq_email_redis_password",
    decodeURIComponent(redisUrl.password),
  );
  config.set("bullmq_email_redis_db", database);
  config.set("bullmq_email_redis_tls", redisUrl.protocol === "rediss:");
}

config.validate({ allowed: "strict" });

export { config };
