import {
  logger,
  requestLogContext,
  setRequestAttributes,
  tracing,
} from './telemetry.js'

export function parseBody(schema, req, res) {
  const result = schema.safeParse(req.body)
  if (result.success) return result.data

  const fields = {}
  for (const issue of result.error.issues) {
    const field = issue.path[0]
    if (field && !fields[field]) fields[field] = issue.message
  }

  const failedFields = Object.keys(fields)
  setRequestAttributes(req, {
    'event.outcome': 'failure',
    'error.code': 'VALIDATION_ERROR',
    'validation.failed_fields': failedFields,
    'validation.issue_count': result.error.issues.length,
  })
  logger.info(
    'API request validation failed',
    requestLogContext(req, {
      'event.name': 'api.request.validation.failed',
      'event.outcome': 'failure',
      'error.code': 'VALIDATION_ERROR',
      'validation.failed_fields': failedFields,
      'validation.issue_count': result.error.issues.length,
    }),
  )

  res.status(400).json({
    code: 'VALIDATION_ERROR',
    message: 'Please correct the highlighted information.',
    fields,
  })
  return null
}

function matchedRoutePath(req) {
  const configuredPaths = Array.isArray(req.route?.path)
    ? req.route.path
    : [req.route?.path].filter(Boolean)

  if (!configuredPaths.length) return undefined
  if (configuredPaths.length === 1) return configuredPaths[0]

  const requestPath = req.originalUrl?.split('?')[0] || req.path
  const pathInsideRouter = requestPath.startsWith(req.baseUrl)
    ? requestPath.slice(req.baseUrl.length) || '/'
    : req.path

  return (
    configuredPaths.find((configuredPath) => configuredPath === pathInsideRouter) ||
    configuredPaths[0]
  )
}

export function asyncRoute(handler) {
  return function routeHandler(req, res, next) {
    const configuredPath = matchedRoutePath(req)
    const route = configuredPath
      ? `${req.baseUrl}${configuredPath}`
      : req.baseUrl || req.path
    if (req.telemetry) req.telemetry.route = route

    Promise.resolve(
      tracing.withSpan(
        `${req.method} ${route}`,
        () => {
          setRequestAttributes(req, {
            'request.id': req.requestId,
            'http.request.method': req.method,
            'http.route': route,
          })
          return handler(req, res, next)
        },
      ),
    ).catch(next)
  }
}
