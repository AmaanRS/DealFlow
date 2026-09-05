import convict from 'convict'
import { loadEnvFile } from 'node:process'

try {
  loadEnvFile(new URL('../.env', import.meta.url))
} catch (error) {
  // The file is optional when the runtime injects values into process.env.
  if (error?.code !== 'ENOENT') {
    throw error
  }
}

convict.addFormat({
  name: 'required-string',
  validate(value) {
    if (typeof value !== 'string' || value.trim() === '') {
      throw new Error('must be a non-empty string')
    }
  },
  coerce(value) {
    return typeof value === 'string' ? value.trim() : value
  },
})

convict.addFormat({
  name: 'mongodb-uri',
  validate(value) {
    if (typeof value !== 'string' || !/^mongodb(?:\+srv)?:\/\//.test(value)) {
      throw new Error('must be a valid MongoDB connection string')
    }
  },
})

convict.addFormat({
  name: 'http-url',
  validate(value) {
    try {
      const url = new URL(value)
      if (!['http:', 'https:'].includes(url.protocol)) {
        throw new Error('must use http or https')
      }
    } catch (error) {
      throw new Error(`must be a valid HTTP URL: ${error.message}`)
    }
  },
})

convict.addFormat({
  name: 'origin-list',
  validate(value) {
    if (!Array.isArray(value) || value.length === 0) {
      throw new Error('must contain at least one origin')
    }

    for (const origin of value) {
      const url = new URL(origin)
      if (!['http:', 'https:'].includes(url.protocol) || url.origin !== origin) {
        throw new Error(`${origin} must be an HTTP origin without a path`)
      }
    }
  },
  coerce(value) {
    if (Array.isArray(value) || value === null) return value
    return String(value)
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean)
  },
})

convict.addFormat({
  name: 'session-pepper',
  validate(value) {
    if (typeof value !== 'string' || value.length < 32) {
      throw new Error('must contain at least 32 characters')
    }
  },
})

const config = convict({
  node_env: {
    format: ['development', 'test', 'production'],
    default: null,
    env: 'NODE_ENV',
  },
  port: {
    format: 'port',
    default: null,
    env: 'PORT',
  },
  mongodb_uri: {
    format: 'mongodb-uri',
    default: null,
    env: 'MONGODB_URI',
    sensitive: true,
  },
  public_app_url: {
    format: 'http-url',
    default: null,
    env: 'PUBLIC_APP_URL',
  },
  allowed_origins: {
    format: 'origin-list',
    default: null,
    env: 'ALLOWED_ORIGINS',
  },
  session_pepper: {
    format: 'session-pepper',
    default: null,
    env: 'SESSION_PEPPER',
    sensitive: true,
  },
})

config.validate({ allowed: 'strict' })

export { config }
