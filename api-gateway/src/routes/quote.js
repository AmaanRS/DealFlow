import { Router } from 'express'
import { USER_ROLES, USER_STATUSES } from '../constants.js'
import { config } from '../config.js'
import { asyncRoute } from '../http.js'
import { requireInternalAuth, requireRoles } from '../middleware.js'
import { User } from '../models.js'
import {
  logger,
  requestLogContext,
  setRequestAttributes,
} from '../telemetry.js'

const router = Router()
const quoteServiceUrl = config.get('morning_star_url')
const quoteReaderRoles = [
  USER_ROLES.ADMIN,
  USER_ROLES.SALES_REP,
  USER_ROLES.MANAGER,
  USER_ROLES.FINANCE,
]

function upstreamError(status, code, message) {
  return Object.assign(new Error(message), { status, code })
}

function appendQuery(url, query, authenticatedUser) {
  for (const [key, value] of Object.entries(query)) {
    for (const item of Array.isArray(value) ? value : [value]) {
      if (item !== undefined) url.searchParams.append(key, String(item))
    }
  }

  if (authenticatedUser.role === USER_ROLES.SALES_REP) {
    url.searchParams.set('created_by', authenticatedUser.email)
  }
}

async function callQuoteService(
  req,
  path,
  { body, fetchImpl = fetch, method = 'GET' } = {},
) {
  const url = new URL(path, quoteServiceUrl)
  if (method === 'GET') appendQuery(url, req.query, req.auth.user)

  let response
  try {
    response = await fetchImpl(url, {
      method,
      headers: {
        Accept: 'application/json',
        'X-Request-Id': req.requestId,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(5_000),
    })
  } catch (error) {
    const timedOut = error?.name === 'TimeoutError'
    throw upstreamError(
      timedOut ? 504 : 502,
      timedOut ? 'QUOTE_SERVICE_TIMEOUT' : 'QUOTE_SERVICE_UNAVAILABLE',
      timedOut
        ? 'The quotation service did not respond in time.'
        : 'The quotation service is unavailable.',
    )
  }

  const data = await response.json().catch(() => null)
  if (!data) {
    throw upstreamError(
      502,
      'INVALID_QUOTE_SERVICE_RESPONSE',
      'The quotation service returned an invalid response.',
    )
  }

  return { data, status: response.status }
}

export function buildCreateQuotationBody(body, authenticatedUser, reviewer) {
  const status = body.status === 'DRAFT' ? 'DRAFT' : 'PENDING_APPROVAL'
  return {
    ...body,
    created_by: authenticatedUser.email,
    approved_by: null,
    assigned_to: status === 'DRAFT' ? authenticatedUser.email : reviewer.email,
    status,
  }
}

function sendUpstreamResponse(req, res, result, operation) {
  const outcome = result.status < 400 ? 'success' : 'failure'
  setRequestAttributes(req, {
    'event.outcome': outcome,
    'quote.operation': operation,
    'quote.service.status_code': result.status,
    'quote.result_count': Array.isArray(result.data.quotes)
      ? result.data.quotes.length
      : undefined,
  })
  logger.info(
    'Quotation service request completed',
    requestLogContext(req, {
      'event.name': 'quote.service.request.completed',
      'event.outcome': outcome,
    }),
  )
  res.status(result.status).json(result.data)
}

router.use(asyncRoute(requireInternalAuth))

router.get(
  '/get_quotes',
  requireRoles(...quoteReaderRoles),
  asyncRoute(async (req, res) => {
    const result = await callQuoteService(req, '/quote/get_quotes')
    sendUpstreamResponse(req, res, result, 'list')
  }),
)

router.post(
  '/new_quotation',
  requireRoles(USER_ROLES.SALES_REP),
  asyncRoute(async (req, res) => {
    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
      res.status(400).json({
        code: 'INVALID_REQUEST_BODY',
        message: 'The request body must be a JSON object.',
      })
      return
    }

    const requestedStatus =
      req.body.status === 'DRAFT' ? 'DRAFT' : 'PENDING_APPROVAL'
    let reviewer = req.auth.user
    if (requestedStatus === 'PENDING_APPROVAL') {
      reviewer = await User.findOne({
        role: USER_ROLES.MANAGER,
        status: USER_STATUSES.ACTIVE,
        is_verified: true,
        is_deleted: false,
      })
        .sort({ createdAt: 1, _id: 1 })
        .select('email')
        .lean()

      if (!reviewer) {
        res.status(409).json({
          code: 'REVIEWER_UNAVAILABLE',
          message: 'An active sales manager is required before routing a quotation.',
        })
        return
      }
    }

    const result = await callQuoteService(req, '/quote/new_quotation', {
      method: 'POST',
      body: buildCreateQuotationBody(req.body, req.auth.user, reviewer),
    })
    if (result.data.quote?._id) {
      setRequestAttributes(req, { 'quote.id': String(result.data.quote._id) })
    }
    sendUpstreamResponse(req, res, result, 'create')
  }),
)

router.get(
  '/approved_quotes',
  requireRoles(...quoteReaderRoles),
  asyncRoute(async (req, res) => {
    const result = await callQuoteService(req, '/quote/approved_quotes')
    sendUpstreamResponse(req, res, result, 'list_approved')
  }),
)

router.get(
  '/:quote_id',
  requireRoles(...quoteReaderRoles),
  asyncRoute(async (req, res) => {
    setRequestAttributes(req, { 'quote.id': req.params.quote_id })
    const result = await callQuoteService(
      req,
      `/quote/${encodeURIComponent(req.params.quote_id)}`,
    )

    if (
      result.status < 400 &&
      req.auth.user.role === USER_ROLES.SALES_REP &&
      result.data.quote?.created_by !== req.auth.user.email
    ) {
      setRequestAttributes(req, {
        'event.outcome': 'failure',
        'error.code': 'QUOTE_NOT_FOUND',
        'quote.operation': 'get',
      })
      res.status(404).json({
        code: 'QUOTE_NOT_FOUND',
        message: 'Quotation not found.',
      })
      return
    }

    sendUpstreamResponse(req, res, result, 'get')
  }),
)

export { appendQuery, callQuoteService }
export default router
