import { randomUUID } from 'node:crypto'
import cookieParser from 'cookie-parser'
import cors from 'cors'
import express from 'express'
import helmet from 'helmet'
import { config } from './config.js'
import adminRoutes from './routes/admin.js'
import authRoutes from './routes/auth.js'
import portalRoutes from './routes/portal.js'

export const app = express()
const allowedOrigins = config.get('allowed_origins')

app.disable('x-powered-by')
app.set('trust proxy', 1)

app.use(
  helmet({
    crossOriginResourcePolicy: { policy: 'same-site' },
  }),
)

app.use((req, res, next) => {
  const requestId = req.get('x-request-id') || randomUUID()
  req.requestId = requestId
  res.set('x-request-id', requestId)
  res.set('cache-control', 'no-store')
  next()
})

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

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', service: 'dealflow-api-gateway' })
})

app.use('/api/v1/auth', authRoutes)
app.use('/api/v1/admin', adminRoutes)
app.use('/api/v1/portal', portalRoutes)

app.use((req, res) => {
  res.status(404).json({
    code: 'NOT_FOUND',
    message: 'The requested API route does not exist.',
  })
})

app.use((error, req, res, _next) => {
  console.error('Request failed', {
    requestId: req.requestId,
    method: req.method,
    path: req.path,
    error: error.message,
  })

  res.status(error.status || 500).json({
    code: error.code || 'INTERNAL_ERROR',
    message:
      error.status && error.status < 500
        ? error.message
        : 'The request could not be completed.',
    requestId: req.requestId,
  })
})
