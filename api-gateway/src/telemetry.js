import { performance } from 'node:perf_hooks'
import { createLogger, createTracing } from '@app/observability'

const SERVICE_NAME = 'dealflow-api-gateway'
const MAX_ATTRIBUTE_LENGTH = 2_000
const MAX_STACK_LENGTH = 8_000
const SENSITIVE_ATTRIBUTE_KEY =
  /(^|[._-])(authorization|cookie|password|passwordhash|secret|token|email|full_name|customer_name|delivery_address|lat|long|latitude|longitude|mongodb_uri|connection_uri)([._-]|$)|^(customer|person|user)\.name$/i

export const logger = createLogger(SERVICE_NAME)
export const tracing = createTracing(SERVICE_NAME, '1.0.0')

function requestPath(req) {
  return req.originalUrl?.split('?')[0] || req.path
}

function redactText(value, maximumLength = MAX_ATTRIBUTE_LENGTH) {
  return String(value)
    .replace(
      /(mongodb(?:\+srv)?:\/\/[^:\s/]+:)[^@\s/]+@/gi,
      '$1[REDACTED]@',
    )
    .replace(/(bearer\s+)[a-z0-9._~+/-]+=*/gi, '$1[REDACTED]')
    .replace(
      /((?:password|secret|token|cookie|authorization)\s*[=:]\s*)[^\s,;]+/gi,
      '$1[REDACTED]',
    )
    .slice(0, maximumLength)
}

function safeAttributeValue(value) {
  if (value instanceof Date) return value.toISOString()

  if (Array.isArray(value)) {
    const values = value
      .map((item) => safeAttributeValue(item))
      .filter((item) => ['string', 'number', 'boolean'].includes(typeof item))

    if (!values.length) return undefined
    const expectedType = typeof values[0]
    return values.every((item) => typeof item === expectedType)
      ? values
      : values.map(String)
  }

  if (typeof value === 'string') return redactText(value)
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'boolean') return value
  return undefined
}

export function safeLogAttributes(attributes = {}) {
  const safe = {}

  for (const [key, value] of Object.entries(attributes)) {
    if (SENSITIVE_ATTRIBUTE_KEY.test(key)) continue
    const safeValue = safeAttributeValue(value)
    if (safeValue !== undefined) safe[key] = safeValue
  }

  return safe
}

function spanContext(span) {
  const context = span?.spanContext?.()
  if (!context?.traceId || !context?.spanId) return {}
  return { traceId: context.traceId, spanId: context.spanId }
}

function actorAttributes(req) {
  const user = req.auth?.user
  if (!user?._id) return {}

  return {
    'enduser.id': String(user._id),
    'enduser.role': user.role,
  }
}

export function setRequestAttributes(req, attributes) {
  const safe = safeLogAttributes({ ...actorAttributes(req), ...attributes })
  req.telemetry ??= { attributes: {} }
  req.telemetry.attributes ??= {}
  Object.assign(req.telemetry.attributes, safe)
  tracing.getActiveSpan()?.setAttributes(safe)
}

export function requestLogContext(req, attributes = {}) {
  const activeContext = spanContext(tracing.getActiveSpan())
  const initialContext = req.telemetry?.spanContext || {}

  return safeLogAttributes({
    'request.id': req.requestId,
    'request.id_source': req.requestIdSource,
    'trace.id': activeContext.traceId || initialContext.traceId,
    'span.id': activeContext.spanId || initialContext.spanId,
    'http.request.method': req.method,
    'http.route': req.telemetry?.route,
    'url.path': requestPath(req),
    'network.protocol.version': req.httpVersion,
    'user_agent.original': req.get?.('user-agent')?.slice(0, 500),
    'server.service': SERVICE_NAME,
    'gateway.name': 'apache-apisix',
    ...actorAttributes(req),
    ...req.telemetry?.attributes,
    ...attributes,
  })
}

export function errorLogAttributes(error) {
  return safeLogAttributes({
    'error.type': error?.name || 'Error',
    'error.code': error?.code || 'INTERNAL_ERROR',
    'exception.message': redactText(
      error?.message || 'The operation failed without an error message.',
    ),
    'exception.stacktrace': error?.stack
      ? redactText(error.stack, MAX_STACK_LENGTH)
      : undefined,
  })
}

export function requestTelemetry(req, res, next) {
  const startedAt = performance.now()
  const path = requestPath(req)
  const activeSpan = tracing.getActiveSpan()
  req.telemetry = {
    attributes: {},
    path,
    route: undefined,
    spanContext: spanContext(activeSpan),
  }

  activeSpan?.setAttributes({
    'request.id': req.requestId,
    'http.request.method': req.method,
    'url.path': path,
  })

  res.once('finish', () => {
    const eventOutcome =
      req.telemetry.attributes['event.outcome'] ||
      (res.statusCode >= 400 ? 'failure' : 'success')
    const responseLength = Number(res.getHeader('content-length'))
    const requestLength = Number(req.get('content-length'))
    const attributes = requestLogContext(req, {
      'event.name': 'http.server.request.completed',
      'event.outcome': eventOutcome,
      'http.response.status_code': res.statusCode,
      'http.request.body.size': Number.isFinite(requestLength)
        ? requestLength
        : undefined,
      'http.response.body.size': Number.isFinite(responseLength)
        ? responseLength
        : undefined,
      'request.duration_ms': Number((performance.now() - startedAt).toFixed(2)),
    })

    if (res.statusCode >= 500) {
      logger.error('API request completed with a server error', attributes)
      return
    }

    logger.info('API request completed', attributes)
  })

  next()
}

export function setActorAttributes(span, user) {
  if (!span || !user?._id) return

  span.setAttributes({
    'enduser.id': String(user._id),
    'enduser.role': user.role,
  })
}
