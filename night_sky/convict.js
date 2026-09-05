import convict from "convict";
import { loadEnvFile } from "node:process";

try {
  loadEnvFile(new URL("./.env", import.meta.url));
} catch (error) {
  // Docker can inject the same values without copying .env into the image.
  if (error?.code !== "ENOENT") {
    throw error;
  }
}

convict.addFormat({
  name: "mongodb-uri",
  validate(value) {
    let uri;

    try {
      uri = new URL(value);
    } catch {
      throw new Error("must be a valid MongoDB connection string");
    }

    if (uri.protocol !== "mongodb:" && uri.protocol !== "mongodb+srv:") {
      throw new Error("must use mongodb or mongodb+srv");
    }
  },
});

const config = convict({
  port: {
    doc: "Port used by the Night Sky HTTP server",
    format: "port",
    default: 3001,
    env: "NIGHT_SKY_PORT",
  },
  mongodb: {
    uri: {
      doc: "MongoDB connection string used by Night Sky",
      format: "mongodb-uri",
      default: "mongodb://localhost:27017/night_sky",
      env: "MONGODB_URI",
      sensitive: true,
    },
  },
});

config.validate({ allowed: "strict" });

export { config };
