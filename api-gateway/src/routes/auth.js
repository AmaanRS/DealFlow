import { Router } from 'express'
import { z } from 'zod'
import { REQUESTABLE_ROLES, SESSION_KINDS, USER_STATUSES } from '../constants.js'
import { asyncRoute, parseBody } from '../http.js'
import { User } from '../models.js'
import {
  clearInternalCookie,
  hashPassword,
  issueInternalSession,
  normalizeEmail,
  publicUser,
  readInternalSession,
  revokeSession,
  verifyPassword,
} from '../security.js'

const router = Router()

const registrationSchema = z.object({
  fullName: z.string().trim().min(2).max(80),
  email: z.string().trim().email().max(254),
  password: z.string().min(8).max(128),
  requestedRole: z.enum(REQUESTABLE_ROLES),
})

const loginSchema = z.object({
  email: z.string().trim().email().max(254),
  password: z.string().min(1).max(128),
  remember: z.boolean().optional().default(false),
})

router.post(
  '/registrations',
  asyncRoute(async (req, res) => {
    const body = parseBody(registrationSchema, req, res)
    if (!body) return

    const emailLower = normalizeEmail(body.email)
    const submittedAt = new Date()

    try {
      const user = await User.create({
        fullName: body.fullName,
        email: emailLower,
        emailLower,
        passwordHash: await hashPassword(body.password),
        role: null,
        requestedRole: body.requestedRole,
        status: USER_STATUSES.PENDING_APPROVAL,
        approval: {
          requestedAt: submittedAt,
          reviewedAt: null,
          reviewedByUserId: null,
          reason: null,
        },
      })

      res.status(202).json({
        request: {
          id: String(user._id),
          status: user.status,
          requestedRole: user.requestedRole,
          submittedAt,
          applicant: {
            fullName: user.fullName,
            email: user.email,
          },
        },
        message: 'Your access request has been sent to an administrator.',
      })
    } catch (error) {
      if (error?.code === 11000) {
        res.status(409).json({
          code: 'EMAIL_ALREADY_REGISTERED',
          message: 'An account already uses this email.',
        })
        return
      }
      throw error
    }
  }),
)

router.post(
  '/login',
  asyncRoute(async (req, res) => {
    const body = parseBody(loginSchema, req, res)
    if (!body) return

    const user = await User.findOne({
      emailLower: normalizeEmail(body.email),
    }).select('+passwordHash')

    if (!user || !(await verifyPassword(body.password, user.passwordHash))) {
      res.status(401).json({
        code: 'INVALID_CREDENTIALS',
        message: 'Email or password is incorrect.',
      })
      return
    }

    if (user.status === USER_STATUSES.PENDING_APPROVAL) {
      res.status(403).json({
        code: 'ACCOUNT_PENDING_APPROVAL',
        message: 'Your access request is still waiting for administrator approval.',
        details: {
          requestId: String(user._id),
          requestedRole: user.requestedRole,
          submittedAt: user.approval.requestedAt,
          applicant: {
            fullName: user.fullName,
            email: user.email,
          },
        },
      })
      return
    }

    if (user.status === USER_STATUSES.REJECTED) {
      res.status(403).json({
        code: 'ACCOUNT_REJECTED',
        message: user.approval.reason || 'This access request was not approved.',
      })
      return
    }

    if (user.status !== USER_STATUSES.ACTIVE) {
      res.status(403).json({
        code: 'ACCOUNT_SUSPENDED',
        message: 'This account is currently unavailable.',
      })
      return
    }

    const expiresAt = await issueInternalSession(
      req,
      res,
      user._id,
      body.remember,
    )

    res.json({
      user: publicUser(user),
      session: { expiresAt },
    })
  }),
)

router.get(
  '/session',
  asyncRoute(async (req, res) => {
    const session = await readInternalSession(req)
    if (!session) {
      clearInternalCookie(res)
      res.json({ authenticated: false, user: null })
      return
    }

    res.json({
      authenticated: true,
      user: publicUser(session.userId),
    })
  }),
)

router.post(
  '/logout',
  asyncRoute(async (req, res) => {
    await revokeSession(req, SESSION_KINDS.INTERNAL)
    clearInternalCookie(res)
    res.status(204).end()
  }),
)

export default router
