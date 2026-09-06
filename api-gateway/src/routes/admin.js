import { Router } from 'express'
import mongoose from 'mongoose'
import { z } from 'zod'
import { config } from '../config.js'
import { USER_ROLES, USER_STATUSES } from '../constants.js'
import { asyncRoute, parseBody } from '../http.js'
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
import { publicRegistration } from '../security.js'
import {
  logger,
  requestLogContext,
  setRequestAttributes,
} from '../telemetry.js'

const router = Router()
const discountServiceUrl = config.get('night_sky_url')
const discountPolicyRoles = [USER_ROLES.ADMIN]

router.use(asyncRoute(requireInternalAuth))

const createTierDiscountSchema = z.object({
  tier: z.string().trim().min(1).max(100),
  discount: z.number().int().min(0).max(100),
  threshold: z.number().min(0).optional().default(0),
}).strict()

const updateTierDiscountSchema = z
  .object({
    tier: z.string().trim().min(1).max(100),
    discount: z.number().int().min(0).max(100).optional(),
    threshold: z.number().min(0).optional(),
  })
  .strict()
  .refine(
    (body) => body.discount !== undefined || body.threshold !== undefined,
    {
      message: 'discount or threshold must be provided.',
    },
  )

const createCategoryDiscountSchema = z.object({
  hardware: z.number().min(0).max(100).optional().default(0),
  service: z.number().min(0).max(100).optional().default(0),
  subscription: z.literal(0).optional().default(0),
}).strict()

const configureRiskSchema = z
  .object({
    medium_risk_threshold: z.number().min(0).max(100),
    high_risk_threshold: z.number().min(0).max(100),
  })
  .strict()
  .refine(
    (body) => body.medium_risk_threshold < body.high_risk_threshold,
    {
      path: ['high_risk_threshold'],
      message: 'Must be greater than medium_risk_threshold.',
    },
  )

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Optional name or email search over registration requests.
 *
 * Returns `null` when no search was asked for and `false` when the term is
 * unusable, so the caller can reject a bad term instead of silently listing
 * everything.
 */
export function parseUserSearch(value) {
  if (value === undefined || value === '') return null
  if (Array.isArray(value)) return false

  const search = String(value).trim()
  if (!search) return null
  if (search.length > 100) return false

  return { $regex: escapeRegex(search), $options: 'i' }
}

function publicTierDiscount(discount) {
  return {
    id: String(discount._id),
    tier: discount.tier,
    discount: discount.discount,
    threshold: discount.threshold,
    createdAt: discount.createdAt,
    updatedAt: discount.updatedAt,
  }
}

function publicCategoryDiscount(discount) {
  return {
    id: String(discount._id),
    hardware: discount.hardware,
    service: discount.service,
    subscription: discount.subscription,
    createdAt: discount.createdAt,
    updatedAt: discount.updatedAt,
  }
}

export async function callDiscountService(
  req,
  path,
  body,
  { fetchImpl = fetch } = {},
) {
  let response
  try {
    response = await fetchImpl(new URL(path, discountServiceUrl), {
      method: 'PATCH',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'X-Request-Id': req.requestId,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(5_000),
    })
  } catch (error) {
    const timedOut = error?.name === 'TimeoutError'
    throw Object.assign(
      new Error(
        timedOut
          ? 'The discount service did not respond in time.'
          : 'The discount service is unavailable.',
      ),
      {
        status: timedOut ? 504 : 502,
        code: timedOut
          ? 'DISCOUNT_SERVICE_TIMEOUT'
          : 'DISCOUNT_SERVICE_UNAVAILABLE',
      },
    )
  }

  const data = await response.json().catch(() => null)
  if (!data) {
    throw Object.assign(
      new Error('The discount service returned an invalid response.'),
      { status: 502, code: 'INVALID_DISCOUNT_SERVICE_RESPONSE' },
    )
  }

  return { data, status: response.status }
}

export function publicRiskData(configuration) {
  const thresholds = effectiveRiskThresholds(configuration)

  return {
    configured: Boolean(configuration),
    ...thresholds,
    line_item_rule: {
      condition: 'applied_discount > product_discount',
      minimum_risk: 'MEDIUM',
      configurable: false,
    },
    updated_by: configuration?.updated_by
      ? String(configuration.updated_by)
      : null,
    updatedAt: configuration?.updatedAt ?? null,
  }
}

function logRegistrationReviewFailure(req, requestId, errorCode, outcome) {
  setRequestAttributes(req, {
    'event.outcome': 'failure',
    'error.code': errorCode,
    'registration.outcome': outcome,
    'registration.request_id': requestId,
  })
  logger.info(
    'Registration request review rejected',
    requestLogContext(req, {
      'event.name': 'admin.registration_review.rejected',
      'event.outcome': 'failure',
    }),
  )
}

router.get(
  '/discount_policy',
  requireRoles(...discountPolicyRoles),
  asyncRoute(async (req, res) => {
    const [tierDiscounts, categoryDiscount] = await Promise.all([
      TierDiscount.find().sort({ threshold: 1, tier: 1 }).lean(),
      CategoryDiscount.findOne().sort({ updatedAt: -1, _id: -1 }).lean(),
    ])

    setRequestAttributes(req, {
      'event.outcome': 'success',
      'discount.operation': 'read_policy',
      'discount.tier_count': tierDiscounts.length,
      'discount.category_configured': Boolean(categoryDiscount),
    })

    res.json({
      tier_discounts: tierDiscounts.map(publicTierDiscount),
      category_discount: categoryDiscount
        ? publicCategoryDiscount(categoryDiscount)
        : null,
    })
  }),
)

router.post(
  '/create_tier_discount',
  requireRoles(...discountPolicyRoles),
  asyncRoute(async (req, res) => {
    const body = parseBody(createTierDiscountSchema, req, res)
    if (!body) return

    try {
      const discount = await TierDiscount.create(body)

      await AuditEvent.create({
        eventType: 'TIER_DISCOUNT_CREATED',
        actorUserId: req.auth.user._id,
        metadata: {
          tierDiscountId: String(discount._id),
          tier: discount.tier,
          discount: discount.discount,
          threshold: discount.threshold,
        },
      })

      setRequestAttributes(req, {
        'event.outcome': 'success',
        'discount.type': 'tier',
        'discount.id': String(discount._id),
        'discount.tier': discount.tier,
        'discount.value': discount.discount,
        'tier.threshold': discount.threshold,
        'discount.outcome': 'created',
      })
      logger.info(
        'Tier discount created',
        requestLogContext(req, {
          'event.name': 'admin.tier_discount.created',
          'event.outcome': 'success',
        }),
      )

      res.status(201).json({ tier_discount: publicTierDiscount(discount) })
    } catch (error) {
      if (error?.code === 11000) {
        setRequestAttributes(req, {
          'event.outcome': 'failure',
          'error.code': 'TIER_ALREADY_EXISTS',
          'discount.type': 'tier',
          'discount.tier': body.tier,
          'discount.outcome': 'duplicate_tier',
        })
        logger.info(
          'Tier discount creation rejected',
          requestLogContext(req, {
            'event.name': 'admin.tier_discount.rejected',
            'event.outcome': 'failure',
          }),
        )
        res.status(409).json({
          code: 'TIER_ALREADY_EXISTS',
          message: 'A discount already exists for this tier.',
        })
        return
      }
      throw error
    }
  }),
)

router.patch(
  '/tier_discount',
  requireRoles(...discountPolicyRoles),
  asyncRoute(async (req, res) => {
    const body = parseBody(updateTierDiscountSchema, req, res)
    if (!body) return

    const result = await callDiscountService(req, '/tier/tier_discount', body)
    if (result.status >= 400) {
      setRequestAttributes(req, {
        'event.outcome': 'failure',
        'error.code': result.data.code,
        'discount.type': 'tier',
        'discount.tier': body.tier,
        'discount.outcome': 'update_rejected',
      })
      res.status(result.status).json(result.data)
      return
    }

    const discount = result.data.tier_discount
    await AuditEvent.create({
      eventType: 'TIER_DISCOUNT_UPDATED',
      actorUserId: req.auth.user._id,
      metadata: {
        tierDiscountId: String(discount._id),
        tier: discount.tier,
        discount: discount.discount,
        threshold: discount.threshold,
      },
    })

    setRequestAttributes(req, {
      'event.outcome': 'success',
      'discount.type': 'tier',
      'discount.id': String(discount._id),
      'discount.tier': discount.tier,
      'discount.value': discount.discount,
      'tier.threshold': discount.threshold,
      'discount.outcome': 'updated',
    })
    logger.info(
      'Tier discount updated',
      requestLogContext(req, {
        'event.name': 'admin.tier_discount.updated',
        'event.outcome': 'success',
      }),
    )

    res.json({ tier_discount: publicTierDiscount(discount) })
  }),
)

router.post(
  ['/create_category_discount', '/create_category_discount_'],
  requireRoles(...discountPolicyRoles),
  asyncRoute(async (req, res) => {
    const body = parseBody(createCategoryDiscountSchema, req, res)
    if (!body) return

    const discount = await CategoryDiscount.create(body)

    await AuditEvent.create({
      eventType: 'CATEGORY_DISCOUNT_CREATED',
      actorUserId: req.auth.user._id,
      metadata: {
        categoryDiscountId: String(discount._id),
        hardware: discount.hardware,
        service: discount.service,
        subscription: discount.subscription,
      },
    })

    setRequestAttributes(req, {
      'event.outcome': 'success',
      'discount.type': 'category',
      'discount.id': String(discount._id),
      'discount.hardware': discount.hardware,
      'discount.service': discount.service,
      'discount.subscription': discount.subscription,
      'discount.outcome': 'created',
    })
    logger.info(
      'Category discount created',
      requestLogContext(req, {
        'event.name': 'admin.category_discount.created',
        'event.outcome': 'success',
      }),
    )

    res.status(201).json({
      category_discount: publicCategoryDiscount(discount),
    })
  }),
)

router.patch(
  '/category_discount',
  requireRoles(...discountPolicyRoles),
  asyncRoute(async (req, res) => {
    const body = parseBody(createCategoryDiscountSchema, req, res)
    if (!body) return

    const result = await callDiscountService(
      req,
      '/category/category_discount',
      body,
    )
    if (result.status >= 400) {
      setRequestAttributes(req, {
        'event.outcome': 'failure',
        'error.code': result.data.code,
        'discount.type': 'category',
        'discount.outcome': 'update_rejected',
      })
      res.status(result.status).json(result.data)
      return
    }

    const discount = result.data.category_discount
    await AuditEvent.create({
      eventType: 'CATEGORY_DISCOUNT_UPDATED',
      actorUserId: req.auth.user._id,
      metadata: {
        categoryDiscountId: String(discount._id),
        hardware: discount.hardware,
        service: discount.service,
        subscription: discount.subscription,
      },
    })

    setRequestAttributes(req, {
      'event.outcome': 'success',
      'discount.type': 'category',
      'discount.id': String(discount._id),
      'discount.hardware': discount.hardware,
      'discount.service': discount.service,
      'discount.subscription': discount.subscription,
      'discount.outcome': 'updated',
    })
    logger.info(
      'Category discount updated',
      requestLogContext(req, {
        'event.name': 'admin.category_discount.updated',
        'event.outcome': 'success',
      }),
    )

    res.json({ category_discount: publicCategoryDiscount(discount) })
  }),
)

router.post(
  '/configure_risk',
  requireRoles(USER_ROLES.ADMIN),
  asyncRoute(async (req, res) => {
    const body = parseBody(configureRiskSchema, req, res)
    if (!body) return

    const configuration = await RiskConfiguration.findOneAndUpdate(
      { _id: RISK_CONFIGURATION_ID },
      {
        $set: {
          ...body,
          updated_by: req.auth.user._id,
        },
      },
      {
        upsert: true,
        returnDocument: 'after',
        runValidators: true,
        setDefaultsOnInsert: true,
      },
    )

    await AuditEvent.create({
      eventType: 'QUOTE_RISK_CONFIGURED',
      actorUserId: req.auth.user._id,
      metadata: {
        mediumRiskThreshold: configuration.medium_risk_threshold,
        highRiskThreshold: configuration.high_risk_threshold,
      },
    })

    setRequestAttributes(req, {
      'event.outcome': 'success',
      'risk.medium_threshold': configuration.medium_risk_threshold,
      'risk.high_threshold': configuration.high_risk_threshold,
    })
    logger.info(
      'Quote risk thresholds configured',
      requestLogContext(req, {
        'event.name': 'admin.quote_risk.configured',
        'event.outcome': 'success',
      }),
    )

    res.json({ risk_data: publicRiskData(configuration) })
  }),
)

router.get(
  '/risks_data',
  requireRoles(USER_ROLES.ADMIN),
  asyncRoute(async (_req, res) => {
    const configuration = await RiskConfiguration.findById(
      RISK_CONFIGURATION_ID,
    ).lean()

    res.json({ risk_data: publicRiskData(configuration) })
  }),
)

router.get(
  '/users',
  requireRoles(USER_ROLES.ADMIN),
  asyncRoute(async (_req, res) => {
    const users = await User.find({
      is_deleted: { $ne: true },
      status: { $ne: USER_STATUSES.REJECTED },
    })
      .sort({ createdAt: -1, _id: -1 })
      .limit(100)

    res.json({
      items: users.map(publicRegistration),
      page: { cursor: null, hasMore: false },
    })
  }),
)

router.get(
  '/registration-requests',
  requireRoles(USER_ROLES.ADMIN),
  asyncRoute(async (req, res) => {
    const status = req.query.status || USER_STATUSES.PENDING_APPROVAL
    if (!Object.values(USER_STATUSES).includes(status)) {
      setRequestAttributes(req, {
        'event.outcome': 'failure',
        'error.code': 'INVALID_STATUS',
        'registration.outcome': 'invalid_status_filter',
      })
      res.status(400).json({
        code: 'INVALID_STATUS',
        message: 'The requested account status is not supported.',
      })
      return
    }

    const search = parseUserSearch(req.query.search)
    if (search === false) {
      setRequestAttributes(req, {
        'event.outcome': 'failure',
        'error.code': 'INVALID_SEARCH',
      })
      res.status(400).json({
        code: 'INVALID_SEARCH',
        message: 'search must contain at most 100 characters.',
      })
      return
    }

    // Matched against the stored lowercase email so the term does not have to
    // be cased the way the applicant typed it.
    const filter = {
      status,
      ...(search
        ? { $or: [{ fullName: search }, { emailLower: search }] }
        : {}),
    }
    const users = await User.find(filter)
      .sort({ 'approval.requestedAt': -1, _id: -1 })
      .limit(100)

    setRequestAttributes(req, {
      'event.outcome': 'success',
      'registration.status_filter': status,
      'registration.searched': Boolean(search),
      'registration.result_count': users.length,
    })

    res.json({
      items: users.map(publicRegistration),
      page: { cursor: null, hasMore: false },
    })
  }),
)

const reviewSchema = z
  .object({
    decision: z.enum(['APPROVE', 'REJECT']),
    reason: z.string().trim().min(3).max(500).optional(),
  })
  .refine((body) => body.decision !== 'REJECT' || body.reason, {
    path: ['reason'],
    message: 'A rejection reason is required.',
  })

const approveUserSchema = z
  .object({
    userId: z.string().trim().min(1),
  })
  .strict()

export async function reviewPendingRegistration(
  { requestId, decision, reason = null, reviewerUserId },
  { UserModel = User, AuditEventModel = AuditEvent } = {},
) {
  if (!mongoose.isObjectIdOrHexString(requestId)) {
    return {
      ok: false,
      status: 404,
      code: 'REQUEST_NOT_FOUND',
      message: 'Registration request not found.',
      outcome: 'invalid_request_id',
    }
  }

  const pendingUser = await UserModel.findOne({
    _id: requestId,
    status: USER_STATUSES.PENDING_APPROVAL,
  })

  if (!pendingUser) {
    const exists = await UserModel.exists({ _id: requestId })
    return {
      ok: false,
      status: exists ? 409 : 404,
      code: exists ? 'REQUEST_ALREADY_REVIEWED' : 'REQUEST_NOT_FOUND',
      message: exists
        ? 'This registration request has already been reviewed.'
        : 'Registration request not found.',
      outcome: exists ? 'already_reviewed' : 'not_found',
    }
  }

  const approved = decision === 'APPROVE'
  const user = await UserModel.findOneAndUpdate(
    {
      _id: pendingUser._id,
      status: USER_STATUSES.PENDING_APPROVAL,
    },
    {
      $set: {
        role: approved ? pendingUser.requestedRole : null,
        status: approved ? USER_STATUSES.ACTIVE : USER_STATUSES.REJECTED,
        is_verified: approved,
        is_deleted: !approved,
        'approval.reviewedAt': new Date(),
        'approval.reviewedByUserId': reviewerUserId,
        'approval.reason': reason,
      },
    },
    { returnDocument: 'after', runValidators: true },
  )

  if (!user) {
    return {
      ok: false,
      status: 409,
      code: 'REQUEST_ALREADY_REVIEWED',
      message: 'This registration request has already been reviewed.',
      outcome: 'concurrent_review',
    }
  }

  await AuditEventModel.create({
    eventType: approved
      ? 'USER_REGISTRATION_APPROVED'
      : 'USER_REGISTRATION_REJECTED',
    actorUserId: reviewerUserId,
    targetUserId: user._id,
    metadata: {
      requestedRole: user.requestedRole,
      assignedRole: user.role,
      is_verified: user.is_verified,
      is_deleted: user.is_deleted,
      reason,
    },
  })

  return { ok: true, user, approved }
}

function sendRegistrationReviewResult(req, res, requestId, decision, result) {
  if (!result.ok) {
    logRegistrationReviewFailure(
      req,
      requestId,
      result.code,
      result.outcome,
    )
    res.status(result.status).json({
      code: result.code,
      message: result.message,
    })
    return
  }

  const { user, approved } = result
  setRequestAttributes(req, {
    'event.outcome': 'success',
    'registration.request_id': String(user._id),
    'registration.decision': decision,
    'registration.requested_role': user.requestedRole,
    'registration.assigned_role': user.role,
    'registration.outcome': approved ? 'approved' : 'rejected',
    'user.is_verified': user.is_verified,
    'user.is_deleted': user.is_deleted,
  })
  logger.info(
    'Registration request reviewed',
    requestLogContext(req, {
      'event.name': 'admin.registration_review.completed',
      'event.outcome': 'success',
    }),
  )

  res.json({ user: publicRegistration(user) })
}

router.post(
  '/approve_user',
  requireRoles(USER_ROLES.ADMIN),
  asyncRoute(async (req, res) => {
    const body = parseBody(approveUserSchema, req, res)
    if (!body) return

    const result = await reviewPendingRegistration({
      requestId: body.userId,
      decision: 'APPROVE',
      reviewerUserId: req.auth.user._id,
    })

    sendRegistrationReviewResult(req, res, body.userId, 'APPROVE', result)
  }),
)

router.patch(
  '/registration-requests/:requestId',
  requireRoles(USER_ROLES.ADMIN),
  asyncRoute(async (req, res) => {
    const body = parseBody(reviewSchema, req, res)
    if (!body) return

    const result = await reviewPendingRegistration({
      requestId: req.params.requestId,
      decision: body.decision,
      reason: body.reason || null,
      reviewerUserId: req.auth.user._id,
    })

    sendRegistrationReviewResult(
      req,
      res,
      req.params.requestId,
      body.decision,
      result,
    )
  }),
)

export default router
