import { Router } from 'express'
import mongoose from 'mongoose'
import { z } from 'zod'
import { USER_ROLES, USER_STATUSES } from '../constants.js'
import { asyncRoute, parseBody } from '../http.js'
import { requireInternalAuth, requireRoles } from '../middleware.js'
import { AuditEvent, CategoryDiscount, TierDiscount, User } from '../models.js'
import { publicRegistration } from '../security.js'
import {
  logger,
  requestLogContext,
  setRequestAttributes,
} from '../telemetry.js'

const router = Router()

router.use(asyncRoute(requireInternalAuth))

const createTierDiscountSchema = z.object({
  tier: z.string().trim().min(1).max(100),
  discount: z.number().int().min(0),
}).strict()

const createCategoryDiscountSchema = z.object({
  hardware: z.number().min(0).optional().default(0),
  service: z.number().min(0).optional().default(0),
  subscription: z.literal(0).optional().default(0),
}).strict()

function publicTierDiscount(discount) {
  return {
    id: String(discount._id),
    tier: discount.tier,
    discount: discount.discount,
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

router.post(
  '/create_tier_discount',
  requireRoles(USER_ROLES.ADMIN, USER_ROLES.MANAGER),
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
        },
      })

      setRequestAttributes(req, {
        'event.outcome': 'success',
        'discount.type': 'tier',
        'discount.id': String(discount._id),
        'discount.tier': discount.tier,
        'discount.value': discount.discount,
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

router.post(
  ['/create_category_discount', '/create_category_discount_'],
  requireRoles(USER_ROLES.ADMIN, USER_ROLES.MANAGER),
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

    const users = await User.find({ status })
      .sort({ 'approval.requestedAt': -1, _id: -1 })
      .limit(100)

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
