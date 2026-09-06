import { Router } from 'express'
import { USER_ROLES } from '../constants.js'
import { config } from '../config.js'
import { asyncRoute } from '../http.js'
import { requireInternalAuth, requireRoles } from '../middleware.js'
import { logger, requestLogContext, setRequestAttributes } from '../telemetry.js'
import { callQuoteService } from './quote.js'
import { assertQuoteVisible } from './quote.js'

const router = Router()
const storeServiceUrl = config.get('night_sky_url')
const readerRoles = [
  USER_ROLES.ADMIN,
  USER_ROLES.SALES_REP,
  USER_ROLES.MANAGER,
  USER_ROLES.FINANCE,
]

function appendQuery(url, query) {
  for (const [key, value] of Object.entries(query)) {
    for (const item of Array.isArray(value) ? value : [value]) {
      if (item !== undefined) url.searchParams.append(key, String(item))
    }
  }
}

async function callStoreService(
  req,
  path,
  { body, fetchImpl = fetch, method = 'GET' } = {},
) {
  const url = new URL(path, storeServiceUrl)
  if (method === 'GET') appendQuery(url, req.query)

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
    throw Object.assign(
      new Error(
        timedOut
          ? 'The store service did not respond in time.'
          : 'The store service is unavailable.',
      ),
      {
        status: timedOut ? 504 : 502,
        code: timedOut ? 'STORE_SERVICE_TIMEOUT' : 'STORE_SERVICE_UNAVAILABLE',
      },
    )
  }

  const data = await response.json().catch(() => null)
  if (!data) {
    throw Object.assign(new Error('The store service returned an invalid response.'), {
      status: 502,
      code: 'INVALID_STORE_SERVICE_RESPONSE',
    })
  }

  return { data, status: response.status }
}

router.use(asyncRoute(requireInternalAuth))
router.use(requireRoles(...readerRoles))

router.get(
  '/get_stores',
  asyncRoute(async (req, res) => {
    const result = await callStoreService(req, '/store/get_stores')
    const outcome = result.status < 400 ? 'success' : 'failure'
    setRequestAttributes(req, {
      'event.outcome': outcome,
      'store.operation': 'list',
      'store.service.status_code': result.status,
      'store.result_count': Array.isArray(result.data.stores)
        ? result.data.stores.length
        : undefined,
    })
    logger.info(
      'Store service request completed',
      requestLogContext(req, {
        'event.name': 'store.service.request.completed',
        'event.outcome': outcome,
      }),
    )
    res.status(result.status).json(result.data)
  }),
)

router.post(
  '/create_store',
  requireRoles(USER_ROLES.ADMIN),
  asyncRoute(async (req, res) => {
    const result = await callStoreService(req, '/store/create_store', {
      method: 'POST',
      body: req.body,
    })
    const outcome = result.status < 400 ? 'success' : 'failure'
    setRequestAttributes(req, {
      'event.outcome': outcome,
      'store.operation': 'create',
      'store.service.status_code': result.status,
      'store.id': result.data.store?._id
        ? String(result.data.store._id)
        : undefined,
    })
    logger.info(
      'Store service request completed',
      requestLogContext(req, {
        'event.name': 'store.service.request.completed',
        'event.outcome': outcome,
      }),
    )
    res.status(result.status).json(result.data)
  }),
)

router.patch(
  '/manual_store_split',
  requireRoles(USER_ROLES.ADMIN, USER_ROLES.SALES_REP, USER_ROLES.FINANCE),
  asyncRoute(async (req, res) => {
    if (req.auth.user.role === USER_ROLES.SALES_REP) {
      const current = await callQuoteService(
        req,
        `/quote/${encodeURIComponent(req.body?.quote_id ?? '')}`,
      )
      if (current.status >= 400) {
        res.status(current.status).json(current.data)
        return
      }
      if (current.data.quote?.created_by !== req.auth.user.email) {
        res.status(404).json({
          code: 'QUOTE_NOT_FOUND',
          message: 'Quotation not found.',
        })
        return
      }
    }

    const result = await callStoreService(req, '/store/manual_store_split', {
      method: 'PATCH',
      body: req.body,
    })
    const outcome = result.status < 400 ? 'success' : 'failure'
    setRequestAttributes(req, {
      'event.outcome': outcome,
      'store.operation': 'manual_split',
      'store.service.status_code': result.status,
      'quote.id': req.body?.quote_id ? String(req.body.quote_id) : undefined,
      'store.assignment.count': Array.isArray(req.body?.stores)
        ? req.body.stores.length
        : undefined,
    })
    logger.info(
      'Manual store allocation request completed',
      requestLogContext(req, {
        'event.name': 'store.manual_allocation.request.completed',
        'event.outcome': outcome,
      }),
    )
    res.status(result.status).json(result.data)
  }),
)

/**
 * Recompute and persist the warehouse allocation for a quotation.
 *
 * Night Sky picks the nearest store that holds enough sellable inventory for
 * each physical line and writes `products[].store_id` and
 * `fulfillment_details` back onto the quote, so this is not a preview: calling
 * it is the accept. A sales rep may only allocate their own quotation, checked
 * against Morning Star before the call rather than trusting the request body.
 */
router.post(
  '/store_split',
  requireRoles(USER_ROLES.ADMIN, USER_ROLES.SALES_REP, USER_ROLES.FINANCE),
  asyncRoute(async (req, res) => {
    const quoteId = req.body?.quote_id
    if (!quoteId || typeof quoteId !== 'string') {
      res.status(400).json({
        code: 'INVALID_REQUEST_BODY',
        message: 'quote_id is required.',
      })
      return
    }

    const owned = await assertQuoteVisible(req, res, quoteId)
    if (!owned) return

    const result = await callStoreService(req, '/store/store_split', {
      method: 'POST',
      body: { quote_id: quoteId },
    })
    const outcome = result.status < 400 ? 'success' : 'failure'
    setRequestAttributes(req, {
      'event.outcome': outcome,
      'store.operation': 'split',
      'store.service.status_code': result.status,
      'quote.id': quoteId,
      'store.assignment.count': Array.isArray(result.data.store_split)
        ? result.data.store_split.length
        : undefined,
      ...(outcome === 'failure' ? { 'error.code': result.data.code } : {}),
    })
    logger.info(
      'Store allocation request completed',
      requestLogContext(req, {
        'event.name': 'store.split.request.completed',
        'event.outcome': outcome,
      }),
    )
    res.status(result.status).json(result.data)
  }),
)

export { callStoreService }
export default router
