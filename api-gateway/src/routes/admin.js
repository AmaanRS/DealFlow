import { Router } from 'express'
import mongoose from 'mongoose'
import { z } from 'zod'
import { USER_ROLES, USER_STATUSES } from '../constants.js'
import { asyncRoute, parseBody } from '../http.js'
import { requireInternalAuth, requireRoles } from '../middleware.js'
import { AuditEvent, User } from '../models.js'
import { publicRegistration } from '../security.js'

const router = Router()

router.use(asyncRoute(requireInternalAuth), requireRoles(USER_ROLES.ADMIN))

router.get(
  '/registration-requests',
  asyncRoute(async (req, res) => {
    const status = req.query.status || USER_STATUSES.PENDING_APPROVAL
    if (!Object.values(USER_STATUSES).includes(status)) {
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

router.patch(
  '/registration-requests/:requestId',
  asyncRoute(async (req, res) => {
    const body = parseBody(reviewSchema, req, res)
    if (!body) return

    if (!mongoose.isObjectIdOrHexString(req.params.requestId)) {
      res.status(404).json({
        code: 'REQUEST_NOT_FOUND',
        message: 'Registration request not found.',
      })
      return
    }

    const pendingUser = await User.findOne({
      _id: req.params.requestId,
      status: USER_STATUSES.PENDING_APPROVAL,
    })

    if (!pendingUser) {
      const exists = await User.exists({ _id: req.params.requestId })
      res.status(exists ? 409 : 404).json({
        code: exists ? 'REQUEST_ALREADY_REVIEWED' : 'REQUEST_NOT_FOUND',
        message: exists
          ? 'This registration request has already been reviewed.'
          : 'Registration request not found.',
      })
      return
    }

    const approved = body.decision === 'APPROVE'
    const user = await User.findOneAndUpdate(
      {
        _id: pendingUser._id,
        status: USER_STATUSES.PENDING_APPROVAL,
      },
      {
        $set: {
          role: approved ? pendingUser.requestedRole : null,
          status: approved ? USER_STATUSES.ACTIVE : USER_STATUSES.REJECTED,
          'approval.reviewedAt': new Date(),
          'approval.reviewedByUserId': req.auth.user._id,
          'approval.reason': body.reason || null,
        },
      },
      { returnDocument: 'after', runValidators: true },
    )

    if (!user) {
      res.status(409).json({
        code: 'REQUEST_ALREADY_REVIEWED',
        message: 'This registration request has already been reviewed.',
      })
      return
    }

    await AuditEvent.create({
      eventType: approved ? 'USER_REGISTRATION_APPROVED' : 'USER_REGISTRATION_REJECTED',
      actorUserId: req.auth.user._id,
      targetUserId: user._id,
      metadata: {
        requestedRole: user.requestedRole,
        assignedRole: user.role,
        reason: body.reason || null,
      },
    })

    res.json({ user: publicRegistration(user) })
  }),
)

export default router
