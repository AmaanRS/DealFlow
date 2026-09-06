import { Router } from 'express'
import mongoose from 'mongoose'
import { USER_ROLES, USER_STATUSES } from '../constants.js'
import { asyncRoute } from '../http.js'
import { requireInternalAuth, requireRoles } from '../middleware.js'
import { User } from '../models.js'
import { callQuoteService } from './quote.js'
import {
  logger,
  requestLogContext,
  setRequestAttributes,
} from '../telemetry.js'

const router = Router()
const readerRoles = [
  USER_ROLES.ADMIN,
  USER_ROLES.SALES_REP,
  USER_ROLES.MANAGER,
  USER_ROLES.FINANCE,
]
const invoiceReaderRoles = [...readerRoles, USER_ROLES.CUSTOMER]

function positiveInteger(value, fallback, maximum) {
  if (value === undefined || value === '') return fallback
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > maximum) {
    throw Object.assign(new Error(`Value must be an integer from 1 to ${maximum}.`), {
      status: 400,
      code: 'INVALID_PAGINATION',
    })
  }
  return parsed
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function publicCustomer(user) {
  return {
    id: String(user._id),
    fullName: user.fullName,
    email: user.email,
    tier: user._custom_json?.tier ?? null,
    totalPrice: user._custom_json?.total_price ?? 0,
    deliveryAddress: user._custom_json?.delivery_address ?? null,
    location:
      Number.isFinite(user._custom_json?.lat) &&
      Number.isFinite(user._custom_json?.long)
        ? {
            lat: user._custom_json.lat,
            long: user._custom_json.long,
          }
        : null,
  }
}

function referencedId(value) {
  if (value && typeof value === 'object') {
    return value._id ?? value.id ?? null
  }
  return value ?? null
}

export function canReadCustomerInvoice(authenticatedUser, quote) {
  if (!authenticatedUser || !quote) return false

  if (
    [USER_ROLES.ADMIN, USER_ROLES.MANAGER, USER_ROLES.FINANCE].includes(
      authenticatedUser.role,
    )
  ) {
    return true
  }

  if (authenticatedUser.role === USER_ROLES.SALES_REP) {
    return quote.created_by === authenticatedUser.email
  }

  if (authenticatedUser.role === USER_ROLES.CUSTOMER) {
    const customerId = referencedId(quote.customer)
    return customerId !== null && String(customerId) === String(authenticatedUser._id)
  }

  return false
}

router.use(asyncRoute(requireInternalAuth))

router.get(
  '/:quote_id/invoice',
  requireRoles(...invoiceReaderRoles),
  asyncRoute(async (req, res) => {
    const quoteId = req.params.quote_id
    setRequestAttributes(req, {
      'customer.operation': 'get_invoice',
      'quote.id': quoteId,
    })

    if (!mongoose.isObjectIdOrHexString(quoteId)) {
      res.status(400).json({
        code: 'INVALID_QUOTE_ID',
        message: 'quote_id must be a valid MongoDB ObjectId.',
      })
      return
    }

    const quoteResult = await callQuoteService(
      req,
      `/quote/${encodeURIComponent(quoteId)}`,
    )
    if (quoteResult.status >= 400) {
      res.status(quoteResult.status).json(quoteResult.data)
      return
    }

    if (!canReadCustomerInvoice(req.auth.user, quoteResult.data.quote)) {
      setRequestAttributes(req, {
        'event.outcome': 'failure',
        'error.code': 'INVOICE_NOT_FOUND',
        'authorization.outcome': 'quote_ownership_denied',
      })
      logger.info(
        'Invoice access denied because the quotation is not owned by the requester',
        requestLogContext(req, {
          'event.name': 'customer.invoice.access.denied',
          'event.outcome': 'failure',
          'error.code': 'INVOICE_NOT_FOUND',
        }),
      )
      res.status(404).json({
        code: 'INVOICE_NOT_FOUND',
        message: 'Invoice not found.',
      })
      return
    }

    const invoiceResult = await callQuoteService(
      req,
      `/customer/${encodeURIComponent(quoteId)}/invoice`,
    )
    const outcome = invoiceResult.status < 400 ? 'success' : 'failure'
    setRequestAttributes(req, {
      'event.outcome': outcome,
      'quote.service.status_code': invoiceResult.status,
    })
    logger.info(
      'Customer invoice request completed',
      requestLogContext(req, {
        'event.name': 'customer.invoice.request.completed',
        'event.outcome': outcome,
      }),
    )
    res.status(invoiceResult.status).json(invoiceResult.data)
  }),
)

router.post(
  '/confirm_quote',
  requireRoles(USER_ROLES.CUSTOMER),
  asyncRoute(async (req, res) => {
    const body = req.body
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      res.status(400).json({
        code: 'INVALID_REQUEST_BODY',
        message: 'The request body must be a JSON object.',
      })
      return
    }

    const unknownFields = Object.keys(body).filter(
      (field) => field !== 'quote_id',
    )
    if (unknownFields.length > 0) {
      res.status(400).json({
        code: 'UNKNOWN_FIELDS',
        message: `Unsupported field(s): ${unknownFields.join(', ')}`,
      })
      return
    }

    const quoteId = body.quote_id
    setRequestAttributes(req, {
      'customer.operation': 'confirm_quote',
      'quote.id': quoteId,
    })
    if (!mongoose.isObjectIdOrHexString(quoteId)) {
      res.status(400).json({
        code: 'INVALID_QUOTE_ID',
        message: 'quote_id must be a valid MongoDB ObjectId.',
      })
      return
    }

    const quoteResult = await callQuoteService(
      req,
      `/quote/${encodeURIComponent(quoteId)}`,
    )
    if (quoteResult.status >= 400) {
      res.status(quoteResult.status).json(quoteResult.data)
      return
    }

    if (!canReadCustomerInvoice(req.auth.user, quoteResult.data.quote)) {
      setRequestAttributes(req, {
        'event.outcome': 'failure',
        'error.code': 'QUOTE_NOT_FOUND',
        'authorization.outcome': 'quote_ownership_denied',
      })
      logger.info(
        'Quotation confirmation denied because the customer does not own the quote',
        requestLogContext(req, {
          'event.name': 'customer.quote_confirmation.access.denied',
          'event.outcome': 'failure',
          'error.code': 'QUOTE_NOT_FOUND',
        }),
      )
      res.status(404).json({
        code: 'QUOTE_NOT_FOUND',
        message: 'Quotation not found.',
      })
      return
    }

    const confirmationResult = await callQuoteService(
      req,
      '/customer/confirm_quote',
      {
        method: 'POST',
        body: {
          quote_id: quoteId,
          customer_id: String(req.auth.user._id),
        },
      },
    )
    const outcome = confirmationResult.status < 400 ? 'success' : 'failure'
    setRequestAttributes(req, {
      'event.outcome': outcome,
      'quote.service.status_code': confirmationResult.status,
    })
    logger.info(
      'Customer quotation confirmation request completed',
      requestLogContext(req, {
        'event.name': 'customer.quote_confirmation.request.completed',
        'event.outcome': outcome,
      }),
    )
    res.status(confirmationResult.status).json(confirmationResult.data)
  }),
)

router.use(requireRoles(...readerRoles))

router.get(
  '/get_customers',
  asyncRoute(async (req, res) => {
    const page = positiveInteger(req.query.page, 1, 10_000)
    const limit = positiveInteger(req.query.limit, 20, 100)
    const filter = {
      role: USER_ROLES.CUSTOMER,
      status: USER_STATUSES.ACTIVE,
      is_verified: true,
      is_deleted: false,
    }

    if (req.query.search) {
      const search = String(req.query.search).trim()
      if (search.length > 100) {
        throw Object.assign(new Error('Search must contain at most 100 characters.'), {
          status: 400,
          code: 'INVALID_SEARCH',
        })
      }
      if (search) {
        const pattern = { $regex: escapeRegex(search), $options: 'i' }
        filter.$or = [{ fullName: pattern }, { email: pattern }]
      }
    }

    const [customers, total] = await Promise.all([
      User.find(filter)
        .sort({ fullName: 1, _id: 1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .select('fullName email _custom_json')
        .lean(),
      User.countDocuments(filter),
    ])

    setRequestAttributes(req, {
      'event.outcome': 'success',
      'customer.operation': 'list',
      'customer.result_count': customers.length,
    })
    res.json({
      customers: customers.map(publicCustomer),
      pagination: {
        page,
        limit,
        total,
        total_pages: Math.ceil(total / limit),
      },
    })
  }),
)

router.get(
  '/:user_id',
  asyncRoute(async (req, res) => {
    if (!mongoose.isObjectIdOrHexString(req.params.user_id)) {
      res.status(404).json({
        code: 'CUSTOMER_NOT_FOUND',
        message: 'Customer not found.',
      })
      return
    }

    const customer = await User.findOne({
      _id: req.params.user_id,
      role: USER_ROLES.CUSTOMER,
      status: USER_STATUSES.ACTIVE,
      is_verified: true,
      is_deleted: false,
    })
      .select('fullName email _custom_json')
      .lean()

    if (!customer) {
      res.status(404).json({
        code: 'CUSTOMER_NOT_FOUND',
        message: 'Customer not found.',
      })
      return
    }

    setRequestAttributes(req, {
      'event.outcome': 'success',
      'customer.operation': 'get',
      'customer.id': req.params.user_id,
    })
    res.json({ customer: publicCustomer(customer) })
  }),
)

export default router
