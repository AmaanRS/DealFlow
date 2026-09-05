export function parseBody(schema, req, res) {
  const result = schema.safeParse(req.body)
  if (result.success) return result.data

  const fields = {}
  for (const issue of result.error.issues) {
    const field = issue.path[0]
    if (field && !fields[field]) fields[field] = issue.message
  }

  res.status(400).json({
    code: 'VALIDATION_ERROR',
    message: 'Please correct the highlighted information.',
    fields,
  })
  return null
}

export function asyncRoute(handler) {
  return function routeHandler(req, res, next) {
    Promise.resolve(handler(req, res, next)).catch(next)
  }
}
