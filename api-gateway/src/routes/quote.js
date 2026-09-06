import { Router } from 'express'
import { USER_ROLES, USER_STATUSES } from '../constants.js'
import { config } from '../config.js'
import { asyncRoute } from '../http.js'
import { requireInternalAuth, requireRoles } from '../middleware.js'
import {
  AuditEvent,
  CategoryDiscount,
  RISK_CONFIGURATION_ID,
  RiskConfiguration,
  TierDiscount,
  User,
  effectiveRiskThresholds,
} from '../models.js'
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

const SALES_EDITABLE_QUOTE_FIELDS = Object.freeze([
  'customer',
  'products',
  'order_discount',
  'status',
  'reason',
  'subscription_details',
])

export function buildUpdateQuotationBody(body, authenticatedUser, reviewer) {
  const submittedUpdates =
    body.updates && typeof body.updates === 'object' && !Array.isArray(body.updates)
      ? body.updates
      : {}
  const updates = Object.fromEntries(
    Object.entries(submittedUpdates).filter(([field]) =>
      SALES_EDITABLE_QUOTE_FIELDS.includes(field),
    ),
  )
  const status = ['DRAFT', 'REJECTED'].includes(updates.status)
    ? 'DRAFT'
    : 'PENDING_APPROVAL'

  return {
    quote_id: body.quote_id,
    ...(body.expected_version === undefined
      ? {}
      : { expected_version: body.expected_version }),
    updates: {
      ...updates,
      created_by: authenticatedUser.email,
      approved_by: null,
      assigned_to: status === 'DRAFT' ? authenticatedUser.email : reviewer.email,
      status,
    },
  }
}

async function findActiveManager() {
  return User.findOne({
    role: USER_ROLES.MANAGER,
    status: USER_STATUSES.ACTIVE,
    is_verified: true,
    is_deleted: false,
  })
    .sort({ createdAt: 1, _id: 1 })
    .select('email')
    .lean()
}

export function sendUpstreamResponse(req, res, result, operation) {
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

/**
 * Confirm the caller is allowed to touch this quotation before letting a
 * downstream service act on it. A sales rep is scoped to their own quotations
 * and gets a 404 rather than a 403 for anyone else's, so the endpoint cannot be
 * used to probe which quote ids exist. Responds and returns false when denied.
 */
async function assertQuoteVisible(req, res, quoteId) {
  const current = await callQuoteService(
    req,
    `/quote/${encodeURIComponent(quoteId)}`,
  )

  if (current.status >= 400) {
    setRequestAttributes(req, {
      'event.outcome': 'failure',
      'error.code': current.data.code,
    })
    res.status(current.status).json(current.data)
    return false
  }

  if (
    req.auth.user.role === USER_ROLES.SALES_REP &&
    current.data.quote?.created_by !== req.auth.user.email
  ) {
    setRequestAttributes(req, {
      'event.outcome': 'failure',
      'error.code': 'QUOTE_NOT_FOUND',
    })
    res.status(404).json({
      code: 'QUOTE_NOT_FOUND',
      message: 'Quotation not found.',
    })
    return false
  }

  return current.data.quote
}

router.use(asyncRoute(requireInternalAuth))

router.get(
  '/pricing_policy',
  requireRoles(...quoteReaderRoles),
  asyncRoute(async (req, res) => {
    const [tierDiscounts, categoryDiscount, riskConfiguration] =
      await Promise.all([
        TierDiscount.find().sort({ threshold: 1, tier: 1 }).lean(),
        CategoryDiscount.findOne().sort({ updatedAt: -1, _id: -1 }).lean(),
        RiskConfiguration.findById(RISK_CONFIGURATION_ID).lean(),
      ])
    const thresholds = effectiveRiskThresholds(riskConfiguration)

    setRequestAttributes(req, {
      'event.outcome': 'success',
      'quote.operation': 'read_pricing_policy',
      'discount.tier_count': tierDiscounts.length,
      'discount.category_configured': Boolean(categoryDiscount),
    })

    res.json({
      tier_discounts: tierDiscounts.map((discount) => ({
        tier: discount.tier,
        discount: discount.discount,
        threshold: discount.threshold,
      })),
      category_discount: categoryDiscount
        ? {
            hardware: categoryDiscount.hardware,
            service: categoryDiscount.service,
            subscription: categoryDiscount.subscription,
          }
        : null,
      risk_data: {
        ...thresholds,
        line_item_rule: {
          condition: 'applied_discount > product_discount',
          minimum_risk: 'MEDIUM',
        },
      },
    })
  }),
)

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
      reviewer = await findActiveManager()

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

router.patch(
  '/quotation',
  requireRoles(USER_ROLES.SALES_REP),
  asyncRoute(async (req, res) => {
    const body = req.body
    if (
      !body ||
      typeof body !== 'object' ||
      Array.isArray(body) ||
      !body.quote_id ||
      !body.updates ||
      typeof body.updates !== 'object' ||
      Array.isArray(body.updates)
    ) {
      res.status(400).json({
        code: 'INVALID_REQUEST_BODY',
        message: 'quote_id and an updates object are required.',
      })
      return
    }

    const current = await callQuoteService(
      req,
      `/quote/${encodeURIComponent(body.quote_id)}`,
    )
    if (current.status >= 400) {
      sendUpstreamResponse(req, res, current, 'get_for_update')
      return
    }
    if (current.data.quote?.created_by !== req.auth.user.email) {
      res.status(404).json({
        code: 'QUOTE_NOT_FOUND',
        message: 'Quotation not found.',
      })
      return
    }

    const requestedStatus = ['DRAFT', 'REJECTED'].includes(
      body.updates.status,
    )
      ? 'DRAFT'
      : 'PENDING_APPROVAL'
    let reviewer = req.auth.user
    if (requestedStatus === 'PENDING_APPROVAL') {
      reviewer = await findActiveManager()
      if (!reviewer) {
        res.status(409).json({
          code: 'REVIEWER_UNAVAILABLE',
          message: 'An active sales manager is required before routing a quotation.',
        })
        return
      }
    }

    const result = await callQuoteService(req, '/quote/quotation', {
      method: 'PATCH',
      body: buildUpdateQuotationBody(body, req.auth.user, reviewer),
    })
    sendUpstreamResponse(req, res, result, 'update')
  }),
)

router.post(
  '/start_negotiation',
  requireRoles(USER_ROLES.SALES_REP, USER_ROLES.FINANCE),
  asyncRoute(async (req, res) => {
    const body = req.body
    if (
      !body ||
      typeof body !== 'object' ||
      Array.isArray(body) ||
      typeof body.quote_id !== 'string' ||
      Object.keys(body).some((field) => field !== 'quote_id')
    ) {
      res.status(400).json({
        code: 'INVALID_REQUEST_BODY',
        message: 'quote_id is required and no other fields are supported.',
      })
      return
    }

    const visible = await assertQuoteVisible(req, res, body.quote_id)
    if (!visible) return

    setRequestAttributes(req, {
      'quote.id': body.quote_id,
      'quote.operation': 'start_negotiation',
    })
    const result = await callQuoteService(req, '/quote/start_negotiation', {
      method: 'POST',
      body: { quote_id: body.quote_id },
    })
    sendUpstreamResponse(req, res, result, 'start_negotiation')
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
  '/:quote_id/history',
  requireRoles(...quoteReaderRoles),
  asyncRoute(async (req, res) => {
    const visible = await assertQuoteVisible(req, res, req.params.quote_id)
    if (!visible) return

    const result = await callQuoteService(
      req,
      `/quote/${encodeURIComponent(req.params.quote_id)}/history`,
    )
    if (result.status >= 400) {
      sendUpstreamResponse(req, res, result, 'get_history')
      return
    }

    const quoteIds = (result.data.revisions ?? [])
      .map((revision) => revision.quote?._id)
      .filter(Boolean)
      .map(String)
    const customerEvents = quoteIds.length
      ? await AuditEvent.find({
          quotationId: { $in: quoteIds },
          eventType: {
            $in: [
              'CUSTOMER_NEGOTIATION_SUBMITTED',
              'CUSTOMER_QUOTATION_CONFIRMED',
            ],
          },
        })
          .sort({ occurredAt: -1, _id: -1 })
          .lean()
      : []
    const eventByQuoteId = new Map()
    for (const event of customerEvents) {
      const eventQuoteId = String(event.quotationId)
      if (!eventByQuoteId.has(eventQuoteId)) {
        eventByQuoteId.set(eventQuoteId, event)
      }
    }

    result.data.revisions = (result.data.revisions ?? []).map((revision) => {
      const event = eventByQuoteId.get(String(revision.quote?._id))
      return {
        ...revision,
        customer_event: event
          ? {
              type: event.eventType,
              change_request: event.metadata?.changeRequest ?? '',
              counter_discount: event.metadata?.counterDiscount ?? null,
              line_comments: event.metadata?.lineComments ?? [],
              occurred_at: event.occurredAt,
            }
          : null,
      }
    })

    setRequestAttributes(req, {
      'quote.id': req.params.quote_id,
      'quote.negotiation.id': result.data.negotiation_id,
      'quote.revision.count': result.data.revisions.length,
    })
    sendUpstreamResponse(req, res, result, 'get_history')
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

export { appendQuery, assertQuoteVisible, callQuoteService }
export default router
