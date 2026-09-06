import { Router } from 'express'
import { z } from 'zod'
import { config } from '../config.js'
import { SESSION_KINDS, USER_ROLES, USER_STATUSES } from '../constants.js'
import { asyncRoute, parseBody } from '../http.js'
import {
  requireInternalAuth,
  requirePortalAuth,
  requireRoles,
} from '../middleware.js'
import { AuditEvent, PortalInvitation, User } from '../models.js'
import {
  clearPortalCookie,
  createOpaqueToken,
  findPortalInvitation,
  hashToken,
  issuePortalSession,
  normalizeEmail,
  publicPortalSession,
  readInternalSession,
  readPortalSession,
  revokeSession,
} from '../security.js'
import {
  logger,
  requestLogContext,
  setRequestAttributes,
} from '../telemetry.js'

const router = Router()
const quoteServiceUrl = config.get('morning_star_url')
const customerVisibleStatuses = new Set(['NEGOTIATION', 'COMPLETED'])
const customerMutableStatuses = new Set(['NEGOTIATION'])

function customerFingerprint(email) {
  return hashToken(normalizeEmail(email)).slice(0, 16)
}

const accessSchema = z.object({
  accessToken: z.string().trim().min(16).max(300),
})

const negotiationSchema = z.object({
  quotationId: z.string().trim().min(1).max(100).optional(),
  changeRequest: z.string().trim().max(2000).optional().default(''),
  counterDiscount: z.number().min(0).max(100).nullable().optional().default(null),
  lineComments: z.array(z.object({
    productId: z.string().trim().min(1).max(100),
    comment: z.string().trim().min(1).max(1000),
  })).max(100).optional().default([]),
}).refine(
  (value) => value.changeRequest || value.counterDiscount !== null || value.lineComments.length,
  { message: 'Add a change request, line comment or counter discount.' },
)

const confirmSchema = z.object({
  quotationId: z.string().trim().min(1).max(100).optional(),
})

function upstreamError(status, code, message) {
  return Object.assign(new Error(message), { status, code })
}

async function callQuoteService(
  req,
  path,
  { body, fetchImpl = fetch, method = 'GET' } = {},
) {
  const url = new URL(path, quoteServiceUrl)
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
    throw upstreamError(
      timedOut ? 504 : 502,
      timedOut ? 'QUOTE_SERVICE_TIMEOUT' : 'QUOTE_SERVICE_UNAVAILABLE',
      timedOut
        ? 'The quotation service did not respond in time.'
        : 'The quotation service is unavailable.',
    )
  }

  const data = await response.json().catch(() => null)
  if (!data) {
    throw upstreamError(
      502,
      'INVALID_QUOTE_SERVICE_RESPONSE',
      'The quotation service returned an invalid response.',
    )
  }

  return { data, status: response.status }
}

function objectId(value) {
  return String(value?._id ?? value ?? '')
}

function applyDiscount(amount, percentage) {
  return amount * (1 - Math.min(100, Math.max(0, Number(percentage) || 0)) / 100)
}

function roundMoney(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100
}

function quoteReference(quote, revision) {
  const stableId = revision?.negotiation_id ?? String(quote._id)
  return `Q-${String(stableId).replaceAll('-', '').slice(0, 8).toUpperCase()}`
}

function accessIdentity(access) {
  const invitation = access?.invitation ?? access
  return {
    customerName: access?.customerName ?? invitation?.customerName ?? '',
    customerEmail: normalizeEmail(
      access?.customerEmail ?? invitation?.customerEmail ?? '',
    ),
  }
}

export function buildPortalQuoteUpdate(quote, revision, { status, reason }) {
  return {
    quote_id: String(quote._id),
    ...(revision?.quote_version
      ? { expected_version: revision.quote_version }
      : {}),
    updates: {
      customer: objectId(quote.customer),
      products: (quote.products ?? []).map((product) => ({
        article_id: objectId(product.article_id),
        category: product.category,
        inv: product.inv,
        applied_discount: product.applied_discount ?? 0,
      })),
      order_discount: quote.order_discount ?? 0,
      created_by: quote.created_by,
      approved_by: quote.approved_by ?? null,
      assigned_to: status === 'NEGOTIATION'
        ? quote.created_by
        : quote.assigned_to,
      status,
      reason,
      subscription_details: (quote.subscription_details ?? []).map(objectId),
    },
  }
}

function requestFromAudit(event) {
  if (!event) return null
  return {
    changeRequest: event.metadata?.changeRequest ?? '',
    counterDiscount: event.metadata?.counterDiscount ?? null,
    lineComments: event.metadata?.lineComments ?? [],
    submittedAt: event.occurredAt,
  }
}

export function publicPortalQuotation(quote, revision, access, latestRequest = null) {
  const identity = accessIdentity(access)
  const customer = quote.customer && typeof quote.customer === 'object'
    ? quote.customer
    : {}
  const lines = (quote.products ?? []).map((product) => {
    const subtotal = (Number(product.unit_price) || 0) * (Number(product.inv) || 0)
    let total = subtotal
    for (const discount of [
      product.category_discount,
      product.applied_discount,
      quote.tier_discount,
      quote.order_discount,
    ]) {
      total = applyDiscount(total, discount)
    }
    const discountedTotal = total
    total *= 1 + (Number(product.gst) || 0) / 100

    return {
      id: String(product._id ?? product.article_id),
      articleId: objectId(product.article_id),
      name: product.name,
      sku: product.hsn,
      category: product.category,
      quantity: product.inv,
      unitPrice: product.unit_price,
      discount: product.applied_discount ?? 0,
      tax: product.gst ?? 0,
      subtotal: roundMoney(subtotal),
      discountedTotal: roundMoney(discountedTotal),
      total: roundMoney(total),
    }
  })
  const subtotal = Number(quote.cost_price) || 0
  const discountedSubtotal = Number(quote.discounted_price) || 0
  const total = Number(quote.selling_price) || 0

  return {
    id: String(quote._id),
    reference: quoteReference(quote, revision),
    status: quote.status,
    customer: {
      name: customer.fullName ?? identity.customerName,
      email: customer.email ?? identity.customerEmail,
      tier: customer._custom_json?.tier ?? null,
    },
    salesContact: quote.created_by,
    lines,
    pricing: {
      subtotal,
      discountedSubtotal,
      discount: roundMoney(Math.max(0, subtotal - discountedSubtotal)),
      tax: roundMoney(Math.max(0, total - discountedSubtotal)),
      total,
      tierDiscount: quote.tier_discount ?? 0,
      orderDiscount: quote.order_discount ?? 0,
      taxIncluded: true,
    },
    revision: revision
      ? { version: revision.quote_version, negotiationId: revision.negotiation_id }
      : null,
    latestRequest: requestFromAudit(latestRequest),
    createdAt: quote.createdAt,
    updatedAt: quote.updatedAt,
    capabilities: {
      canNegotiate: customerMutableStatuses.has(quote.status),
      canConfirm: customerMutableStatuses.has(quote.status),
    },
  }
}

export function publicPortalQuoteSummary(quote) {
  return {
    id: String(quote._id),
    reference: quoteReference(quote, quote.revision),
    status: quote.status,
    lineCount: quote.products?.length ?? 0,
    total: Number(quote.selling_price) || 0,
    revision: quote.revision
      ? {
          version: quote.revision.quote_version,
          negotiationId: quote.revision.negotiation_id,
        }
      : null,
    salesContact: quote.created_by,
    createdAt: quote.createdAt,
    updatedAt: quote.updatedAt,
  }
}

async function requireCustomerAccess(req, res, next) {
  const internalSession = await readInternalSession(req)
  if (internalSession?.userId.role === USER_ROLES.CUSTOMER) {
    req.customerAccess = {
      kind: SESSION_KINDS.INTERNAL,
      session: internalSession,
      invitation: null,
      customerName: internalSession.userId.fullName,
      customerEmail: normalizeEmail(internalSession.userId.email),
      actorUserId: internalSession.userId._id,
      customerId: String(internalSession.userId._id),
    }
    return next()
  }

  const portalSession = await readPortalSession(req)
  if (portalSession) {
    const invitation = portalSession.portalInvitationId
    req.customerAccess = {
      kind: SESSION_KINDS.CUSTOMER_PORTAL,
      session: portalSession,
      invitation,
      customerName: invitation.customerName,
      customerEmail: normalizeEmail(invitation.customerEmail),
      actorUserId: null,
    }
    return next()
  }

  if (!internalSession) {
    res.status(401).json({
      code: 'CUSTOMER_AUTHENTICATION_REQUIRED',
      message: 'Sign in as a customer or open a secure quotation link.',
    })
    return
  }
  res.status(403).json({
    code: 'CUSTOMER_ACCESS_REQUIRED',
    message: 'This area is available only to customers.',
  })
}

function requestedQuotationId(req, submittedId) {
  return submittedId ?? req.customerAccess?.invitation?.quotationId ?? null
}

async function customerRecordForAccess(access) {
  if (access.customerId) return { _id: access.customerId }
  return User.findOne({
    emailLower: normalizeEmail(access.customerEmail),
    role: USER_ROLES.CUSTOMER,
    status: USER_STATUSES.ACTIVE,
    is_verified: true,
    is_deleted: false,
  }).select('_id').lean()
}

async function getPortalQuote(req, quotationId) {
  if (!quotationId) {
    return {
      status: 400,
      data: {
        code: 'QUOTATION_ID_REQUIRED',
        message: 'Choose a quotation first.',
      },
    }
  }
  const result = await callQuoteService(
    req,
    `/quote/${encodeURIComponent(quotationId)}`,
  )
  if (result.status >= 400) return result

  const quote = result.data.quote
  const quoteCustomerEmail = normalizeEmail(quote?.customer?.email ?? '')
  if (
    String(quote?._id) !== quotationId ||
    quoteCustomerEmail !== normalizeEmail(req.customerAccess.customerEmail)
  ) {
    return {
      status: 404,
      data: { code: 'QUOTE_NOT_FOUND', message: 'Quotation not found.' },
    }
  }
  if (!quote.is_latest_quote) {
    return {
      status: 409,
      data: {
        code: 'QUOTE_VERSION_CONFLICT',
        message: 'A newer revision exists. Refresh your quotations and try again.',
      },
    }
  }
  if (!customerVisibleStatuses.has(quote.status)) {
    return {
      status: 409,
      data: {
        code: 'QUOTATION_NOT_AVAILABLE',
        message: 'This quotation is not currently available for customer review.',
      },
    }
  }
  return result
}

async function latestNegotiationRequest(access, quotationId) {
  return AuditEvent.findOne({
    eventType: 'CUSTOMER_NEGOTIATION_SUBMITTED',
    quotationId,
    'metadata.customerEmail': normalizeEmail(access.customerEmail),
  }).sort({ occurredAt: -1, _id: -1 }).lean()
}

function sendQuoteFailure(req, res, result, operation) {
  setRequestAttributes(req, {
    'event.outcome': 'failure',
    'error.code': result.data?.code ?? 'QUOTE_REQUEST_FAILED',
    'portal.operation': operation,
    'quote.service.status_code': result.status,
  })
  res.status(result.status).json(result.data)
}

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

router.get(
  '/quotations',
  asyncRoute(requireCustomerAccess),
  asyncRoute(async (req, res) => {
    const customer = await customerRecordForAccess(req.customerAccess)
    if (!customer) {
      res.json({ quotations: [], pagination: { page: 1, limit: 50, total: 0, totalPages: 0 } })
      return
    }

    const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1)
    const limit = Math.min(100, Math.max(1, Number.parseInt(req.query.limit, 10) || 50))
    const query = new URLSearchParams({
      customer: String(customer._id),
      is_latest_quote: 'true',
      status: [...customerVisibleStatuses].join(','),
      page: String(page),
      limit: String(limit),
    })
    const result = await callQuoteService(req, `/quote/get_quotes?${query}`)
    if (result.status >= 400) {
      sendQuoteFailure(req, res, result, 'list_quotations')
      return
    }

    res.json({
      quotations: (result.data.quotes ?? []).map(publicPortalQuoteSummary),
      pagination: {
        page: result.data.pagination?.page ?? page,
        limit: result.data.pagination?.limit ?? limit,
        total: result.data.pagination?.total ?? 0,
        totalPages: result.data.pagination?.total_pages ?? 0,
      },
    })
  }),
)

router.get(
  '/quotation',
  asyncRoute(requireCustomerAccess),
  asyncRoute(async (req, res) => {
    const quotationId = requestedQuotationId(req, req.query.quotationId)
    const result = await getPortalQuote(req, quotationId)
    if (result.status >= 400) {
      sendQuoteFailure(req, res, result, 'read_quotation')
      return
    }

    const latestRequest = await latestNegotiationRequest(
      req.customerAccess,
      quotationId,
    )
    setRequestAttributes(req, {
      'event.outcome': 'success',
      'portal.operation': 'read_quotation',
      'quote.status': result.data.quote.status,
      'quote.version': result.data.revision?.quote_version,
    })
    logger.info(
      'Customer portal quotation loaded',
      requestLogContext(req, {
        'event.name': 'customer_portal.quotation.loaded',
        'event.outcome': 'success',
      }),
    )
    res.json({
      quotation: publicPortalQuotation(
        result.data.quote,
        result.data.revision,
        req.customerAccess,
        latestRequest,
      ),
    })
  }),
)

router.get(
  '/quotation-history',
  asyncRoute(requireCustomerAccess),
  asyncRoute(async (req, res) => {
    const quotationId = requestedQuotationId(req, req.query.quotationId)
    const current = await getPortalQuote(req, quotationId)
    if (current.status >= 400) {
      sendQuoteFailure(req, res, current, 'read_quotation_history')
      return
    }

    const result = await callQuoteService(
      req,
      `/quote/${encodeURIComponent(quotationId)}/history`,
    )
    if (result.status >= 400) {
      sendQuoteFailure(req, res, result, 'read_quotation_history')
      return
    }

    res.json({
      negotiationId: result.data.negotiation_id,
      revisions: (result.data.revisions ?? [])
        .filter((revision) => revision.quote)
        .map((revision) => ({
          quoteId: String(revision.quote._id),
          version: revision.quote_version,
          status: revision.quote.status,
          total: Number(revision.quote.selling_price) || 0,
          risk: revision.quote.risk,
          isLatest: Boolean(revision.quote.is_latest_quote),
          createdAt: revision.createdAt ?? revision.quote.createdAt,
        })),
    })
  }),
)

router.post(
  '/negotiations',
  asyncRoute(requireCustomerAccess),
  asyncRoute(async (req, res) => {
    const body = parseBody(negotiationSchema, req, res)
    if (!body) return

    const quotationId = requestedQuotationId(req, body.quotationId)
    const current = await getPortalQuote(req, quotationId)
    if (current.status >= 400) {
      sendQuoteFailure(req, res, current, 'submit_negotiation')
      return
    }
    if (!customerMutableStatuses.has(current.data.quote.status)) {
      res.status(409).json({
        code: 'QUOTATION_ALREADY_FINAL',
        message: 'This quotation has already been confirmed.',
      })
      return
    }

    const validProductIds = new Set(
      current.data.quote.products.flatMap((product) => [
        String(product._id),
        objectId(product.article_id),
      ]),
    )
    const unknownProduct = body.lineComments.find(
      (comment) => !validProductIds.has(comment.productId),
    )
    if (unknownProduct) {
      res.status(400).json({
        code: 'INVALID_QUOTATION_LINE',
        message: 'A line comment refers to a product outside this quotation.',
      })
      return
    }

    const reasonParts = ['Customer requested revised terms through the secure portal.']
    if (body.counterDiscount !== null) {
      reasonParts.push(`Counter discount proposed: ${body.counterDiscount}%.`)
    }
    if (body.changeRequest) reasonParts.push(body.changeRequest)
    const updated = await callQuoteService(req, '/quote/quotation', {
      method: 'PATCH',
      body: buildPortalQuoteUpdate(
        current.data.quote,
        current.data.revision,
        { status: 'NEGOTIATION', reason: reasonParts.join(' ').slice(0, 2000) },
      ),
    })
    if (updated.status >= 400) {
      sendQuoteFailure(req, res, updated, 'submit_negotiation')
      return
    }

    const updatedQuoteId = String(updated.data.quote._id)
    const invitation = req.customerAccess.invitation
    const auditEvent = await AuditEvent.create({
      eventType: 'CUSTOMER_NEGOTIATION_SUBMITTED',
      actorUserId: req.customerAccess.actorUserId,
      quotationId: updatedQuoteId,
      metadata: {
        ...(invitation ? { portalInvitationId: String(invitation._id) } : {}),
        previousQuoteId: quotationId,
        customerEmail: req.customerAccess.customerEmail,
        changeRequest: body.changeRequest,
        counterDiscount: body.counterDiscount,
        lineComments: body.lineComments,
        quoteVersion: updated.data.revision?.quote_version,
      },
    })

    setRequestAttributes(req, {
      'event.outcome': 'success',
      'portal.operation': 'submit_negotiation',
      'quote.id': updatedQuoteId,
      'quote.previous.id': quotationId,
      'quote.status': updated.data.quote.status,
      'quote.version': updated.data.revision?.quote_version,
      'quote.line_comment_count': body.lineComments.length,
      'quote.counter_discount_requested': body.counterDiscount !== null,
    })
    logger.info(
      'Customer negotiation submitted',
      requestLogContext(req, {
        'event.name': 'customer_portal.negotiation.submitted',
        'event.outcome': 'success',
      }),
    )
    res.json({
      quotation: publicPortalQuotation(
        updated.data.quote,
        updated.data.revision,
        req.customerAccess,
        auditEvent.toObject(),
      ),
    })
  }),
)

router.post(
  '/confirm',
  asyncRoute(requireCustomerAccess),
  asyncRoute(async (req, res) => {
    const body = parseBody(confirmSchema, req, res)
    if (!body) return
    const quotationId = requestedQuotationId(req, body.quotationId)
    const current = await getPortalQuote(req, quotationId)
    if (current.status >= 400) {
      sendQuoteFailure(req, res, current, 'confirm_quotation')
      return
    }
    if (!customerMutableStatuses.has(current.data.quote.status)) {
      res.status(409).json({
        code: 'QUOTATION_ALREADY_FINAL',
        message: 'This quotation has already been confirmed.',
      })
      return
    }

    const updated = await callQuoteService(req, '/quote/quotation', {
      method: 'PATCH',
      body: buildPortalQuoteUpdate(
        current.data.quote,
        current.data.revision,
        {
          status: 'COMPLETED',
          reason: 'Customer confirmed the current quotation through the secure portal.',
        },
      ),
    })
    if (updated.status >= 400) {
      sendQuoteFailure(req, res, updated, 'confirm_quotation')
      return
    }

    const updatedQuoteId = String(updated.data.quote._id)
    const invitation = req.customerAccess.invitation
    await AuditEvent.create({
      eventType: 'CUSTOMER_QUOTATION_CONFIRMED',
      actorUserId: req.customerAccess.actorUserId,
      quotationId: updatedQuoteId,
      metadata: {
        ...(invitation ? { portalInvitationId: String(invitation._id) } : {}),
        previousQuoteId: quotationId,
        customerEmail: req.customerAccess.customerEmail,
        quoteVersion: updated.data.revision?.quote_version,
      },
    })

    setRequestAttributes(req, {
      'event.outcome': 'success',
      'portal.operation': 'confirm_quotation',
      'quote.id': updatedQuoteId,
      'quote.previous.id': quotationId,
      'quote.status': updated.data.quote.status,
      'quote.version': updated.data.revision?.quote_version,
    })
    logger.info(
      'Customer quotation confirmed',
      requestLogContext(req, {
        'event.name': 'customer_portal.quotation.confirmed',
        'event.outcome': 'success',
      }),
    )
    res.json({
      quotation: publicPortalQuotation(
        updated.data.quote,
        updated.data.revision,
        req.customerAccess,
      ),
    })
  }),
)

export default router
