import { Router } from 'express'
import { z } from 'zod'
import {
  REQUESTABLE_ROLES,
  SESSION_KINDS,
  USER_ROLES,
  USER_STATUSES,
} from '../constants.js'
import { config } from '../config.js'
import { asyncRoute, parseBody } from '../http.js'
import { AuditEvent, PasswordResetToken, Session, User } from '../models.js'
import {
  assertPasswordResetEmailConfigured,
  sendPasswordResetEmail,
} from '../mailer.js'
import {
  clearInternalCookie,
  createOpaqueToken,
  ensureUserVerifiedForLogin,
  hashPassword,
  hashToken,
  issueInternalSession,
  normalizeEmail,
  publicUser,
  readInternalSession,
  revokeSession,
  verifyPassword,
} from '../security.js'
import {
  errorLogAttributes,
  logger,
  requestLogContext,
  setRequestAttributes,
} from '../telemetry.js'

const router = Router()
const PASSWORD_RESET_LIFETIME_MS = 15 * 60 * 1000
const PASSWORD_RESET_LIFETIME_MINUTES = PASSWORD_RESET_LIFETIME_MS / 60_000

function identityFingerprint(email) {
  return hashToken(normalizeEmail(email)).slice(0, 16)
}

const registrationSchema = z.object({
  fullName: z.string().trim().min(2).max(80),
  email: z.string().trim().email().max(254),
  password: z.string().min(8).max(128),
  requestedRole: z.enum(REQUESTABLE_ROLES).optional().default(USER_ROLES.CUSTOMER),
  _custom_json: z
    .object({
      delivery_address: z.string().trim().min(1).max(500),
      lat: z.number().min(-90).max(90),
      long: z.number().min(-180).max(180),
    })
    .nullable()
    .optional(),
}).superRefine((body, context) => {
  if (body.requestedRole === 'CUSTOMER' && !body._custom_json) {
    context.addIssue({
      code: 'custom',
      path: ['_custom_json'],
      message: 'Customer delivery details are required.',
    })
  }

  if (body.requestedRole !== 'CUSTOMER' && body._custom_json) {
    context.addIssue({
      code: 'custom',
      path: ['_custom_json'],
      message: 'Customer delivery details are only allowed for CUSTOMER users.',
    })
  }
})

const loginSchema = z.object({
  email: z.string().trim().email().max(254),
  password: z.string().min(1).max(128),
  remember: z.boolean().optional().default(false),
})

const forgotPasswordSchema = z.object({
  email: z.string().trim().email().max(254),
})

const resetPasswordSchema = z.object({
  token: z.string().min(32).max(512),
  password: z.string().min(8).max(128),
})

export async function createRegistrationRequest(
  body,
  {
    UserModel = User,
    AuditEventModel = AuditEvent,
    passwordHasher = hashPassword,
    submittedAt = new Date(),
    requestId,
  } = {},
) {
  const emailLower = normalizeEmail(body.email)
  const requestedRole = body.requestedRole ?? USER_ROLES.CUSTOMER
  const existingUser = await UserModel.findOne({ emailLower })
  const passwordHash = await passwordHasher(body.password)

  if (existingUser && existingUser.status !== USER_STATUSES.REJECTED) {
    const duplicateError = new Error('An account already uses this email.')
    duplicateError.code = 11000
    throw duplicateError
  }

  if (!existingUser) {
    const user = await UserModel.create({
      fullName: body.fullName,
      email: emailLower,
      emailLower,
      passwordHash,
      role: null,
      requestedRole,
      status: USER_STATUSES.PENDING_APPROVAL,
      is_verified: false,
      is_deleted: false,
      _custom_json:
        requestedRole === USER_ROLES.CUSTOMER ? body._custom_json : null,
      approval: {
        requestedAt: submittedAt,
        reviewedAt: null,
        reviewedByUserId: null,
        reason: null,
      },
    })
    return { user, resubmitted: false, emailLower, submittedAt }
  }

  const previousRejection = {
    reason: existingUser.approval?.reason ?? null,
    reviewedAt: existingUser.approval?.reviewedAt ?? null,
    reviewedByUserId: existingUser.approval?.reviewedByUserId ?? null,
  }

  existingUser.fullName = body.fullName
  existingUser.email = emailLower
  existingUser.passwordHash = passwordHash
  existingUser.role = null
  existingUser.requestedRole = requestedRole
  existingUser.status = USER_STATUSES.PENDING_APPROVAL
  existingUser.is_verified = false
  existingUser.is_deleted = false
  existingUser._custom_json =
    requestedRole === USER_ROLES.CUSTOMER ? body._custom_json : null
  existingUser.approval = {
    requestedAt: submittedAt,
    reviewedAt: null,
    reviewedByUserId: null,
    reason: null,
  }
  const user = await existingUser.save()

  await AuditEventModel.create({
    eventType: 'USER_REGISTRATION_RESUBMITTED',
    targetUserId: user._id,
    metadata: {
      requestId,
      requestedRole: user.requestedRole,
      previousRejection,
    },
  })

  return { user, resubmitted: true, emailLower, submittedAt }
}

router.post(
  ['/signup', '/registrations'],
  asyncRoute(async (req, res) => {
    const body = parseBody(registrationSchema, req, res)
    if (!body) return

    const submittedAt = new Date()
    const emailLower = normalizeEmail(body.email)

    try {
      const { user, resubmitted } = await createRegistrationRequest(body, {
        submittedAt,
        requestId: req.requestId,
      })

      setRequestAttributes(req, {
        'event.outcome': 'success',
        'enduser.id': String(user._id),
        'auth.operation': 'registration',
        'auth.requested_role': user.requestedRole,
        'auth.outcome': resubmitted
          ? 'resubmitted_pending_approval'
          : 'pending_approval',
        'identity.fingerprint': identityFingerprint(emailLower),
        'registration.resubmitted': resubmitted,
        'user.status': user.status,
      })
      logger.info(
        resubmitted
          ? 'User registration resubmitted'
          : 'User registration requested',
        requestLogContext(req, {
          'event.name': resubmitted
            ? 'auth.registration.resubmitted'
            : 'auth.registration.requested',
          'event.outcome': 'success',
        }),
      )

      res.status(202).json({
        request: {
          id: String(user._id),
          status: user.status,
          is_verified: user.is_verified,
          requestedRole: user.requestedRole,
          submittedAt,
          resubmitted,
          applicant: {
            fullName: user.fullName,
            email: user.email,
          },
        },
        message: resubmitted
          ? 'Your new access request has been sent to an administrator.'
          : 'Your access request has been sent to an administrator.',
      })
    } catch (error) {
      if (error?.code === 11000) {
        setRequestAttributes(req, {
          'event.outcome': 'failure',
          'error.code': 'EMAIL_ALREADY_REGISTERED',
          'auth.operation': 'registration',
          'auth.outcome': 'duplicate_email',
          'identity.fingerprint': identityFingerprint(emailLower),
        })
        logger.info(
          'User registration rejected',
          requestLogContext(req, {
            'event.name': 'auth.registration.rejected',
            'event.outcome': 'failure',
          }),
        )
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
  '/forgot_password',
  asyncRoute(async (req, res) => {
    const body = parseBody(forgotPasswordSchema, req, res)
    if (!body) return

    // Validate configuration before looking up the email so configuration
    // errors cannot reveal whether an account exists.
    assertPasswordResetEmailConfigured()

    const user = await User.findOne({
      emailLower: normalizeEmail(body.email),
      status: USER_STATUSES.ACTIVE,
      is_verified: true,
      is_deleted: { $ne: true },
    }).select('_id fullName email')

    if (user) {
      const rawToken = createOpaqueToken()
      const tokenHash = hashToken(rawToken)
      const createdAt = new Date()
      const expiresAt = new Date(createdAt.getTime() + PASSWORD_RESET_LIFETIME_MS)

      await PasswordResetToken.updateMany(
        { userId: user._id, usedAt: null },
        { $set: { usedAt: createdAt } },
      )
      const resetToken = await PasswordResetToken.create({
        tokenHash,
        userId: user._id,
        createdAt,
        expiresAt,
      })

      const resetUrl = new URL('/', config.get('public_app_url'))
      resetUrl.searchParams.set('reset_token', rawToken)

      try {
        await sendPasswordResetEmail({
          to: user.email,
          fullName: user.fullName,
          resetUrl: resetUrl.toString(),
          expiresInMinutes: PASSWORD_RESET_LIFETIME_MINUTES,
        })

        await AuditEvent.create({
          eventType: 'PASSWORD_RESET_REQUESTED',
          targetUserId: user._id,
          metadata: {
            requestId: req.requestId,
            expiresAt,
            delivery: 'sent',
          },
        })
        setRequestAttributes(req, { 'email.delivery': 'sent' })
      } catch (error) {
        await PasswordResetToken.deleteOne({ _id: resetToken._id })
        await AuditEvent.create({
          eventType: 'PASSWORD_RESET_EMAIL_FAILED',
          targetUserId: user._id,
          metadata: {
            requestId: req.requestId,
            errorCode: error?.code ?? 'EMAIL_DELIVERY_FAILED',
          },
        })
        setRequestAttributes(req, {
          'email.delivery': 'failed',
          'error.code': error?.code ?? 'EMAIL_DELIVERY_FAILED',
        })
        logger.error(
          'Password reset email delivery failed',
          requestLogContext(req, {
            'event.name': 'auth.password_reset.email.failed',
            'event.outcome': 'failure',
            ...errorLogAttributes(error),
          }),
        )
      }
    }

    setRequestAttributes(req, {
      'event.outcome': 'success',
      'auth.operation': 'password_reset_request',
      'auth.outcome': 'accepted',
      'identity.fingerprint': identityFingerprint(body.email),
      'identity.account_matched': Boolean(user),
      'target.user.id': user ? String(user._id) : undefined,
    })
    logger.info(
      'Password reset request accepted',
      requestLogContext(req, {
        'event.name': 'auth.password_reset.requested',
        'event.outcome': 'success',
      }),
    )

    res.status(202).json({
      message: 'If an account exists for that email, the password reset request has been accepted.',
    })
  }),
)

router.post(
  '/reset_password',
  asyncRoute(async (req, res) => {
    const body = parseBody(resetPasswordSchema, req, res)
    if (!body) return

    const now = new Date()
    const tokenHash = hashToken(body.token)
    const resetToken = await PasswordResetToken.findOne({
      tokenHash,
      usedAt: null,
      expiresAt: { $gt: now },
    })

    if (!resetToken) {
      setRequestAttributes(req, {
        'event.outcome': 'failure',
        'error.code': 'INVALID_OR_EXPIRED_RESET_TOKEN',
        'auth.operation': 'password_reset',
        'auth.outcome': 'invalid_or_expired_token',
      })
      res.status(400).json({
        code: 'INVALID_OR_EXPIRED_RESET_TOKEN',
        message: 'This password reset link is invalid, expired, or has already been used.',
      })
      return
    }

    const passwordHash = await hashPassword(body.password)
    const consumed = await PasswordResetToken.findOneAndUpdate(
      {
        _id: resetToken._id,
        usedAt: null,
        expiresAt: { $gt: new Date() },
      },
      { $set: { usedAt: new Date() } },
      { returnDocument: 'after' },
    )

    if (!consumed) {
      res.status(400).json({
        code: 'INVALID_OR_EXPIRED_RESET_TOKEN',
        message: 'This password reset link is invalid, expired, or has already been used.',
      })
      return
    }

    const user = await User.findOneAndUpdate(
      {
        _id: consumed.userId,
        status: USER_STATUSES.ACTIVE,
        is_verified: true,
        is_deleted: { $ne: true },
      },
      { $set: { passwordHash } },
      { returnDocument: 'after' },
    )

    if (!user) {
      res.status(400).json({
        code: 'INVALID_OR_EXPIRED_RESET_TOKEN',
        message: 'This password reset link is invalid, expired, or has already been used.',
      })
      return
    }

    await Promise.all([
      Session.updateMany(
        {
          userId: user._id,
          kind: SESSION_KINDS.INTERNAL,
          revokedAt: null,
        },
        { $set: { revokedAt: now } },
      ),
      PasswordResetToken.updateMany(
        { userId: user._id, usedAt: null },
        { $set: { usedAt: now } },
      ),
      AuditEvent.create({
        eventType: 'PASSWORD_RESET_COMPLETED',
        targetUserId: user._id,
        metadata: { requestId: req.requestId },
      }),
    ])

    setRequestAttributes(req, {
      'event.outcome': 'success',
      'enduser.id': String(user._id),
      'auth.operation': 'password_reset',
      'auth.outcome': 'password_updated',
    })
    logger.info(
      'Password reset completed',
      requestLogContext(req, {
        'event.name': 'auth.password_reset.completed',
        'event.outcome': 'success',
      }),
    )

    res.json({
      message: 'Your password has been reset. You can now sign in with the new password.',
    })
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
      setRequestAttributes(req, {
        'event.outcome': 'failure',
        'error.code': 'INVALID_CREDENTIALS',
        'auth.operation': 'login',
        'auth.outcome': 'invalid_credentials',
        'identity.fingerprint': identityFingerprint(body.email),
      })
      logger.info(
        'User authentication failed',
        requestLogContext(req, {
          'event.name': 'auth.login.failed',
          'event.outcome': 'failure',
        }),
      )
      res.status(401).json({
        code: 'INVALID_CREDENTIALS',
        message: 'Email or password is incorrect.',
      })
      return
    }

    if (user.status === USER_STATUSES.PENDING_APPROVAL) {
      setRequestAttributes(req, {
        'event.outcome': 'failure',
        'error.code': 'ACCOUNT_PENDING_APPROVAL',
        'enduser.id': String(user._id),
        'auth.operation': 'login',
        'auth.outcome': 'pending_approval',
        'identity.fingerprint': identityFingerprint(body.email),
        'user.status': user.status,
      })
      logger.info(
        'User authentication blocked',
        requestLogContext(req, {
          'event.name': 'auth.login.blocked',
          'event.outcome': 'failure',
        }),
      )
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
      setRequestAttributes(req, {
        'event.outcome': 'failure',
        'error.code': 'ACCOUNT_REJECTED',
        'enduser.id': String(user._id),
        'auth.operation': 'login',
        'auth.outcome': 'account_rejected',
        'identity.fingerprint': identityFingerprint(body.email),
        'user.status': user.status,
      })
      logger.info(
        'User authentication blocked',
        requestLogContext(req, {
          'event.name': 'auth.login.blocked',
          'event.outcome': 'failure',
        }),
      )
      res.status(403).json({
        code: 'ACCOUNT_REJECTED',
        message: user.approval.reason || 'This access request was not approved.',
        details: {
          reason: user.approval.reason || 'This access request was not approved.',
          reviewedAt: user.approval.reviewedAt,
          requestedRole: user.requestedRole,
          applicant: {
            fullName: user.fullName,
            email: user.email,
          },
        },
      })
      return
    }

    if (user.status !== USER_STATUSES.ACTIVE) {
      setRequestAttributes(req, {
        'event.outcome': 'failure',
        'error.code': 'ACCOUNT_SUSPENDED',
        'enduser.id': String(user._id),
        'auth.operation': 'login',
        'auth.outcome': 'account_suspended',
        'identity.fingerprint': identityFingerprint(body.email),
        'user.status': user.status,
      })
      logger.info(
        'User authentication blocked',
        requestLogContext(req, {
          'event.name': 'auth.login.blocked',
          'event.outcome': 'failure',
        }),
      )
      res.status(403).json({
        code: 'ACCOUNT_SUSPENDED',
        message: 'This account is currently unavailable.',
      })
      return
    }

    if (!(await ensureUserVerifiedForLogin(user))) {
      setRequestAttributes(req, {
        'event.outcome': 'failure',
        'error.code': 'ACCOUNT_NOT_VERIFIED',
        'enduser.id': String(user._id),
        'auth.operation': 'login',
        'auth.outcome': 'account_not_verified',
        'identity.fingerprint': identityFingerprint(body.email),
        'user.status': user.status,
        'user.is_verified': false,
      })
      logger.info(
        'User authentication blocked',
        requestLogContext(req, {
          'event.name': 'auth.login.blocked',
          'event.outcome': 'failure',
        }),
      )
      res.status(403).json({
        code: 'ACCOUNT_NOT_VERIFIED',
        message: 'This account has not been verified by an administrator.',
      })
      return
    }

    const expiresAt = await issueInternalSession(
      req,
      res,
      user._id,
      body.remember,
    )

    setRequestAttributes(req, {
      'event.outcome': 'success',
      'enduser.id': String(user._id),
      'enduser.role': user.role,
      'auth.operation': 'login',
      'auth.outcome': 'authenticated',
      'identity.fingerprint': identityFingerprint(body.email),
      'user.is_verified': user.is_verified,
      'session.kind': SESSION_KINDS.INTERNAL,
      'session.remembered': body.remember,
      'session.expires_at': expiresAt,
    })
    logger.info(
      'User authenticated',
      requestLogContext(req, {
        'event.name': 'auth.login.succeeded',
        'event.outcome': 'success',
      }),
    )

    res.json({
      user: publicUser(user),
      session: { expiresAt },
    })
  }),
)

router.get(
  '/me',
  asyncRoute(async (req, res) => {
    const session = await readInternalSession(req)
    if (!session) {
      setRequestAttributes(req, {
        'event.outcome': 'success',
        'auth.operation': 'session_check',
        'auth.outcome': 'unauthenticated',
        'session.kind': SESSION_KINDS.INTERNAL,
      })
      logger.debug(
        'Internal authentication state resolved',
        requestLogContext(req, {
          'event.name': 'auth.session.checked',
          'event.outcome': 'success',
        }),
      )
      clearInternalCookie(res)
      res.json({ authenticated: false, user: null })
      return
    }

    setRequestAttributes(req, {
      'event.outcome': 'success',
      'enduser.id': String(session.userId._id),
      'enduser.role': session.userId.role,
      'auth.operation': 'session_check',
      'auth.outcome': 'authenticated',
      'session.kind': SESSION_KINDS.INTERNAL,
      'session.expires_at': session.expiresAt,
    })
    logger.debug(
      'Internal authentication state resolved',
      requestLogContext(req, {
        'event.name': 'auth.session.checked',
        'event.outcome': 'success',
      }),
    )

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
    setRequestAttributes(req, {
      'event.outcome': 'success',
      'auth.operation': 'logout',
      'auth.outcome': 'session_revoked_or_absent',
      'session.kind': SESSION_KINDS.INTERNAL,
    })
    logger.info(
      'Internal logout completed',
      requestLogContext(req, {
        'event.name': 'auth.logout.completed',
        'event.outcome': 'success',
      }),
    )
    res.status(204).end()
  }),
)

export default router
