import { randomUUID } from 'node:crypto'
import cookieParser from 'cookie-parser'
import cors from 'cors'
import express from 'express'
import helmet from 'helmet'
import { config } from './config.js'
import adminRoutes from './routes/admin.js'
import authRoutes from './routes/auth.js'
import portalRoutes from './routes/portal.js'
import {
  errorLogAttributes,
  logger,
  requestLogContext,
  requestTelemetry,
  setRequestAttributes,
} from './telemetry.js'

export const app = express()
const allowedOrigins = config.get('allowed_origins')
const validRequestId = /^[a-z0-9][a-z0-9._:-]{0,127}$/i

app.disable('x-powered-by')
app.set('trust proxy', 1)

app.use(
  helmet({
    crossOriginResourcePolicy: { policy: 'same-site' },
  }),
)

app.use((req, res, next) => {
  const upstreamRequestId = req.get('x-request-id')
  const requestId = validRequestId.test(upstreamRequestId || '')
    ? upstreamRequestId
    : randomUUID()
  req.requestId = requestId
  req.requestIdSource = upstreamRequestId
    ? requestId === upstreamRequestId
      ? 'upstream'
      : 'regenerated'
    : 'generated'
  res.set('x-request-id', requestId)
  res.set('cache-control', 'no-store')
  next()
})

app.use(requestTelemetry)

app.use(
  cors({
    credentials: true,
    origin(origin, callback) {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true)
        return
      }
      const error = new Error('Origin is not allowed')
      error.status = 403
      error.code = 'ORIGIN_NOT_ALLOWED'
      callback(error)
    },
  }),
)

app.use((req, res, next) => {
  const stateChanging = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)
  const origin = req.get('origin')
  const fetchSite = req.get('sec-fetch-site')

  if (
    stateChanging &&
    ((origin && !allowedOrigins.includes(origin)) || fetchSite === 'cross-site')
  ) {
    setRequestAttributes(req, {
      'event.outcome': 'failure',
      'error.code': 'CSRF_CHECK_FAILED',
      'security.check': 'request_origin',
    })
    res.status(403).json({
      code: 'CSRF_CHECK_FAILED',
      message: 'The request origin could not be verified.',
    })
    return
  }
  next()
})

app.use(express.json({ limit: '64kb' }))
app.use(cookieParser())

app.get(['/v1/api/health', '/api/health'], (req, res) => {
  req.telemetry.route = req.path
  setRequestAttributes(req, {
    'event.outcome': 'success',
    'health.status': 'ok',
  })
  res.json({ status: 'ok', service: 'dealflow-api-gateway' })
})

app.use('/v1/api/user/auth', authRoutes)
app.use('/v1/api/admin', adminRoutes)

// Compatibility routes used by the existing frontend while it migrates to /v1/api.
app.use('/api/v1/auth', authRoutes)
app.use('/api/v1/admin', adminRoutes)
app.use('/api/v1/portal', portalRoutes)

app.use((req, res) => {
  setRequestAttributes(req, {
    'event.outcome': 'failure',
    'error.code': 'NOT_FOUND',
  })
  res.status(404).json({
    code: 'NOT_FOUND',
    message: 'The requested API route does not exist.',
  })
})

app.use((error, req, res, _next) => {
  const status = error.status || 500
  setRequestAttributes(req, {
    'event.outcome': 'failure',
    'error.code': error.code || 'INTERNAL_ERROR',
  })

  const attributes = requestLogContext(req, {
    'event.name': 'http.server.request.failed',
    'event.outcome': 'failure',
    'http.response.status_code': status,
    'error.type': error.name || 'Error',
    'error.code': error.code || 'INTERNAL_ERROR',
    ...(status >= 500 ? errorLogAttributes(error) : {}),
  })

  if (status >= 500) {
    logger.error('API request failed', attributes)
  } else {
    logger.info('API request rejected', attributes)
  }

  res.status(status).json({
    code: error.code || 'INTERNAL_ERROR',
    message:
      error.status && error.status < 500
        ? error.message
        : 'The request could not be completed.',
    requestId: req.requestId,
  })
})
