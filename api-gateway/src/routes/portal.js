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

const router = Router()

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
      clearPortalCookie(res)
      res.json({ authenticated: false })
      return
    }
    res.json(publicPortalSession(session))
  }),
)

router.post(
  '/logout',
  asyncRoute(async (req, res) => {
    await revokeSession(req, SESSION_KINDS.CUSTOMER_PORTAL)
    clearPortalCookie(res)
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
    USER_ROLES.SALES_MANAGER,
  ),
  asyncRoute(async (req, res) => {
    const body = parseBody(invitationSchema, req, res)
    if (!body) return

    const now = new Date()
    const customerEmailLower = normalizeEmail(body.customerEmail)
    await PortalInvitation.updateMany(
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
    res.json({
      quotationId: req.portalAuth.invitation.quotationId,
      scope: ['quotation:read', 'quotation:comment', 'quotation:counter', 'quotation:confirm'],
    })
  },
)

export default router
