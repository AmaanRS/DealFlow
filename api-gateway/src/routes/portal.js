import { Router } from 'express'
import { z } from 'zod'
import { config } from '../config.js'
import { SESSION_KINDS, USER_ROLES } from '../constants.js'
import { asyncRoute, parseBody } from '../http.js'
import {
  requireInternalAuth,
  requirePortalAuth,
  requireRoles,
} from '../middleware.js'
import { AuditEvent, PortalInvitation } from '../models.js'
import {
  clearPortalCookie,
  createOpaqueToken,
  findPortalInvitation,
  hashToken,
  issuePortalSession,
  normalizeEmail,
  publicPortalSession,
  readPortalSession,
  revokeSession,
} from '../security.js'
import {
  logger,
  requestLogContext,
  setRequestAttributes,
} from '../telemetry.js'

const router = Router()

function customerFingerprint(email) {
  return hashToken(normalizeEmail(email)).slice(0, 16)
}

const accessSchema = z.object({
  accessToken: z.string().trim().min(16).max(300),
})

router.post(
  '/session',
  asyncRoute(async (req, res) => {
    const body = parseBody(accessSchema, req, res)
    if (!body) return

    const invitation = await findPortalInvitation(body.accessToken)
    if (!invitation) {
      setRequestAttributes(req, {
        'event.outcome': 'failure',
        'error.code': 'INVALID_PORTAL_LINK',
        'auth.operation': 'portal_session_exchange',
        'auth.outcome': 'invalid_or_expired_link',
        'session.kind': SESSION_KINDS.CUSTOMER_PORTAL,
      })
      logger.info(
        'Customer portal access denied',
        requestLogContext(req, {
          'event.name': 'auth.customer_portal.link_rejected',
          'event.outcome': 'failure',
        }),
      )
      res.status(401).json({
        code: 'INVALID_PORTAL_LINK',
        message: 'This quotation link is invalid or expired.',
      })
      return
    }

    const expiresAt = await issuePortalSession(req, res, invitation)
    invitation.lastUsedAt = new Date()
    await invitation.save()

    await AuditEvent.create({
      eventType: 'CUSTOMER_PORTAL_OPENED',
      quotationId: invitation.quotationId,
      metadata: {
        portalInvitationId: String(invitation._id),
        customerEmail: invitation.customerEmail,
      },
    })

    setRequestAttributes(req, {
      'event.outcome': 'success',
      'auth.operation': 'portal_session_exchange',
      'auth.outcome': 'authenticated',
      'session.kind': SESSION_KINDS.CUSTOMER_PORTAL,
      'session.expires_at': expiresAt,
      'portal.invitation.id': String(invitation._id),
      'quotation.id': invitation.quotationId,
      'customer.fingerprint': customerFingerprint(invitation.customerEmail),
    })
    logger.info(
      'Customer portal session created',
      requestLogContext(req, {
        'event.name': 'auth.customer_portal.session_created',
        'event.outcome': 'success',
      }),
    )

    res.json({
      authenticated: true,
      customer: {
        name: invitation.customerName,
        email: invitation.customerEmail,
      },
      quotation: {
        id: invitation.quotationId,
        reference: invitation.quotationReference,
      },
      expiresAt,
    })
  }),
)

router.get(
  '/session',
  asyncRoute(async (req, res) => {
    const session = await readPortalSession(req)
    if (!session) {
      setRequestAttributes(req, {
        'event.outcome': 'success',
        'auth.operation': 'portal_session_check',
        'auth.outcome': 'unauthenticated',
        'session.kind': SESSION_KINDS.CUSTOMER_PORTAL,
      })
      logger.debug(
        'Customer portal authentication state resolved',
        requestLogContext(req, {
          'event.name': 'auth.customer_portal.session_checked',
          'event.outcome': 'success',
        }),
      )
      clearPortalCookie(res)
      res.json({ authenticated: false })
      return
    }

    setRequestAttributes(req, {
      'event.outcome': 'success',
      'auth.operation': 'portal_session_check',
      'auth.outcome': 'authenticated',
      'session.kind': SESSION_KINDS.CUSTOMER_PORTAL,
      'session.expires_at': session.expiresAt,
      'portal.invitation.id': String(session.portalInvitationId._id),
      'quotation.id': session.portalInvitationId.quotationId,
      'customer.fingerprint': customerFingerprint(
        session.portalInvitationId.customerEmail,
      ),
    })
    logger.debug(
      'Customer portal authentication state resolved',
      requestLogContext(req, {
        'event.name': 'auth.customer_portal.session_checked',
        'event.outcome': 'success',
      }),
    )
    res.json(publicPortalSession(session))
  }),
)

router.post(
  '/logout',
  asyncRoute(async (req, res) => {
    await revokeSession(req, SESSION_KINDS.CUSTOMER_PORTAL)
    clearPortalCookie(res)
    setRequestAttributes(req, {
      'event.outcome': 'success',
      'auth.operation': 'portal_logout',
      'auth.outcome': 'session_revoked_or_absent',
      'session.kind': SESSION_KINDS.CUSTOMER_PORTAL,
    })
    logger.info(
      'Customer portal logout completed',
      requestLogContext(req, {
        'event.name': 'auth.customer_portal.logout_completed',
        'event.outcome': 'success',
      }),
    )
    res.status(204).end()
  }),
)

const invitationSchema = z.object({
  quotationId: z.string().trim().min(1).max(100),
  quotationReference: z.string().trim().min(1).max(100),
  customerName: z.string().trim().min(2).max(120),
  customerEmail: z.string().trim().email().max(254),
  expiresInHours: z.number().int().min(1).max(24 * 30).optional().default(72),
})

router.post(
  '/invitations',
  asyncRoute(requireInternalAuth),
  requireRoles(
    USER_ROLES.ADMIN,
    USER_ROLES.SALES_REP,
    USER_ROLES.MANAGER,
  ),
  asyncRoute(async (req, res) => {
    const body = parseBody(invitationSchema, req, res)
    if (!body) return

    const now = new Date()
    const customerEmailLower = normalizeEmail(body.customerEmail)
    const revokeResult = await PortalInvitation.updateMany(
      {
        quotationId: body.quotationId,
        customerEmailLower,
        revokedAt: null,
      },
      { $set: { revokedAt: now } },
    )

    const rawToken = createOpaqueToken()
    const invitation = await PortalInvitation.create({
      tokenHash: hashToken(rawToken),
      quotationId: body.quotationId,
      quotationReference: body.quotationReference,
      customerName: body.customerName,
      customerEmail: customerEmailLower,
      customerEmailLower,
      createdByUserId: req.auth.user._id,
      expiresAt: new Date(now.getTime() + body.expiresInHours * 60 * 60 * 1000),
    })

    await AuditEvent.create({
      eventType: 'CUSTOMER_PORTAL_INVITATION_CREATED',
      actorUserId: req.auth.user._id,
      quotationId: invitation.quotationId,
      metadata: {
        portalInvitationId: String(invitation._id),
        customerEmail: invitation.customerEmail,
      },
    })

    setRequestAttributes(req, {
      'event.outcome': 'success',
      'portal.invitation.id': String(invitation._id),
      'portal.invitation.outcome': 'created',
      'portal.previous_invitations_revoked': revokeResult.modifiedCount,
      'quotation.id': invitation.quotationId,
      'customer.fingerprint': customerFingerprint(invitation.customerEmail),
      'session.expires_at': invitation.expiresAt,
    })
    logger.info(
      'Customer portal invitation created',
      requestLogContext(req, {
        'event.name': 'customer_portal.invitation.created',
        'event.outcome': 'success',
      }),
    )

    const appUrl = config.get('public_app_url').replace(/\/$/, '')
    res.status(201).json({
      invitation: {
        id: String(invitation._id),
        quotationId: invitation.quotationId,
        customerEmail: invitation.customerEmail,
        expiresAt: invitation.expiresAt,
        accessUrl: `${appUrl}/portal#token=${encodeURIComponent(rawToken)}`,
      },
    })
  }),
)

router.get(
  '/quotation-access',
  asyncRoute(requirePortalAuth),
  (req, res) => {
    setRequestAttributes(req, {
      'event.outcome': 'success',
      'authorization.outcome': 'granted',
      'portal.invitation.id': String(req.portalAuth.invitation._id),
      'quotation.id': req.portalAuth.invitation.quotationId,
    })
    logger.debug(
      'Customer quotation access granted',
      requestLogContext(req, {
        'event.name': 'customer_portal.quotation_access.granted',
        'event.outcome': 'success',
      }),
    )
    res.json({
      quotationId: req.portalAuth.invitation.quotationId,
      scope: ['quotation:read', 'quotation:comment', 'quotation:counter', 'quotation:confirm'],
    })
  },
)

export default router
