import { Router } from 'express'
import mongoose from 'mongoose'
import { USER_ROLES, USER_STATUSES } from '../constants.js'
import { asyncRoute } from '../http.js'
import { requireInternalAuth, requireRoles } from '../middleware.js'
import { User } from '../models.js'
import { setRequestAttributes } from '../telemetry.js'

const router = Router()
const readerRoles = [
  USER_ROLES.ADMIN,
  USER_ROLES.SALES_REP,
  USER_ROLES.MANAGER,
  USER_ROLES.FINANCE,
]

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

router.use(asyncRoute(requireInternalAuth))
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
