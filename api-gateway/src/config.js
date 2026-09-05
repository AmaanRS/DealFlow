import { loadEnvFile } from 'node:process'

try {
  loadEnvFile(new URL('../.env', import.meta.url))
} catch (error) {
  if (error?.code !== 'ENOENT') throw error
}

function positiveInteger(value, fallback, name) {
  const parsed = Number(value ?? fallback)
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`)
  }
  return parsed
}

function csv(value) {
  return String(value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}

const nodeEnv = process.env.NODE_ENV || 'development'
const defaultPepper = 'local-only-change-this-session-pepper'
const defaultAdminPassword = 'Admin@360'

if (
  nodeEnv === 'production' &&
  (!process.env.SESSION_PEPPER || process.env.SESSION_PEPPER === defaultPepper)
) {
  throw new Error('SESSION_PEPPER must be changed in production')
}

if (
  nodeEnv === 'production' &&
  (!process.env.ADMIN_PASSWORD || process.env.ADMIN_PASSWORD === defaultAdminPassword)
) {
  throw new Error('ADMIN_PASSWORD must be changed in production')
}

export const config = Object.freeze({
  nodeEnv,
  port: positiveInteger(process.env.PORT, 4000, 'PORT'),
  mongodbUri: process.env.MONGODB_URI || 'mongodb://localhost:27017/dealflow',
  publicAppUrl: process.env.PUBLIC_APP_URL || 'http://localhost:9080',
  allowedOrigins: csv(
    process.env.ALLOWED_ORIGINS ||
      'http://localhost:9080,http://127.0.0.1:9080,http://localhost:5173,http://127.0.0.1:5173,http://localhost:5174,http://127.0.0.1:5174',
  ),
  sessionPepper: process.env.SESSION_PEPPER || defaultPepper,
  secureCookies: nodeEnv === 'production',
  admin: {
    name: process.env.ADMIN_NAME || 'DealFlow Administrator',
    email: (process.env.ADMIN_EMAIL || 'admin@dealflow.local').trim().toLowerCase(),
    password: process.env.ADMIN_PASSWORD || defaultAdminPassword,
  },
  demoPortal: {
    token: process.env.DEMO_PORTAL_TOKEN || '',
    customerName: process.env.DEMO_PORTAL_CUSTOMER_NAME || 'Acme Corporation',
    customerEmail: (
      process.env.DEMO_PORTAL_CUSTOMER_EMAIL || 'procurement@acme.example'
    )
      .trim()
      .toLowerCase(),
    quotationId: process.env.DEMO_PORTAL_QUOTATION_ID || 'quote_acme_demo',
    quotationReference:
      process.env.DEMO_PORTAL_QUOTATION_REFERENCE || 'Q-2026-0042',
  },
})
