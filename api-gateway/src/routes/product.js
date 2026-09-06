import { Router } from 'express'
import { USER_ROLES } from '../constants.js'
import { config } from '../config.js'
import { asyncRoute } from '../http.js'
import { requireInternalAuth, requireRoles } from '../middleware.js'
import { logger, requestLogContext, setRequestAttributes } from '../telemetry.js'
import { assertQuoteVisible } from './quote.js'

const router = Router()
const productServiceUrl = config.get('night_sky_url')
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

async function callProductService(
  req,
  path,
  { body, fetchImpl = fetch, method = 'GET' } = {},
) {
  const url = new URL(path, productServiceUrl)
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
          ? 'The product service did not respond in time.'
          : 'The product service is unavailable.',
      ),
      {
        status: timedOut ? 504 : 502,
        code: timedOut ? 'PRODUCT_SERVICE_TIMEOUT' : 'PRODUCT_SERVICE_UNAVAILABLE',
      },
    )
  }

  const data = await response.json().catch(() => null)
  if (!data) {
    throw Object.assign(new Error('The product service returned an invalid response.'), {
      status: 502,
      code: 'INVALID_PRODUCT_SERVICE_RESPONSE',
    })
  }
  return { data, status: response.status }
}

function sendResult(req, res, result, operation) {
  const outcome = result.status < 400 ? 'success' : 'failure'
  setRequestAttributes(req, {
    'event.outcome': outcome,
    'product.operation': operation,
    'product.service.status_code': result.status,
    'product.result_count': Array.isArray(result.data.products)
      ? result.data.products.length
      : undefined,
  })
  logger.info(
    'Product service request completed',
    requestLogContext(req, {
      'event.name': 'product.service.request.completed',
      'event.outcome': outcome,
    }),
  )
  res.status(result.status).json(result.data)
}

router.use(asyncRoute(requireInternalAuth))
router.use(requireRoles(...readerRoles))

router.get(
  '/get_products',
  asyncRoute(async (req, res) => {
    sendResult(
      req,
      res,
      await callProductService(req, '/product/get_products'),
      'list',
    )
  }),
)

router.post(
  '/create_hsn',
  requireRoles(USER_ROLES.ADMIN),
  asyncRoute(async (req, res) => {
    const result = await callProductService(req, '/product/create_hsn', {
      method: 'POST',
      body: req.body,
    })
    sendResult(req, res, result, 'create_hsn')
  }),
)

router.post(
  '/create_product',
  requireRoles(USER_ROLES.ADMIN),
  asyncRoute(async (req, res) => {
    const result = await callProductService(req, '/product/create_product', {
      method: 'POST',
      body: req.body,
    })
    if (result.data.product?._id) {
      setRequestAttributes(req, {
        'product.id': String(result.data.product._id),
      })
    }
    sendResult(req, res, result, 'create')
  }),
)

router.post(
  '/add_inventory',
  requireRoles(USER_ROLES.ADMIN),
  asyncRoute(async (req, res) => {
    const result = await callProductService(req, '/product/add_inventory', {
      method: 'POST',
      body: req.body,
    })
    if (result.data.article?._id) {
      setRequestAttributes(req, {
        'product.article.id': String(result.data.article._id),
      })
    }
    sendResult(req, res, result, 'add_inventory')
  }),
)

/**
 * Current inventory allocation for one quotation: the article behind each
 * quoted line, the store it is being pulled from, and the quantity. Scoped the
 * same way as the quotation itself, so a rep cannot read another rep's order.
 */
router.get(
  '/get_inv/:quote_id',
  asyncRoute(async (req, res) => {
    const visible = await assertQuoteVisible(req, res, req.params.quote_id)
    if (!visible) return

    setRequestAttributes(req, { 'quote.id': req.params.quote_id })
    sendResult(
      req,
      res,
      await callProductService(
        req,
        `/product/get_inv/${encodeURIComponent(req.params.quote_id)}`,
      ),
      'quote_inventory',
    )
  }),
)

router.get(
  '/:item_id',
  asyncRoute(async (req, res) => {
    setRequestAttributes(req, { 'product.id': req.params.item_id })
    sendResult(
      req,
      res,
      await callProductService(
        req,
        `/product/${encodeURIComponent(req.params.item_id)}`,
      ),
      'get',
    )
  }),
)

export { callProductService }
export default router
