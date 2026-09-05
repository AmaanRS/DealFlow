import { createHmac, randomBytes } from 'node:crypto'
import bcrypt from 'bcryptjs'
import { config } from './config.js'
import { SESSION_KINDS, USER_ROLES, USER_STATUSES } from './constants.js'
import { PortalInvitation, Session, User } from './models.js'

const INTERNAL_COOKIE = 'dealflow_session'
const PORTAL_COOKIE = 'dealflow_portal_session'
const SHORT_SESSION_MS = 8 * 60 * 60 * 1000
const REMEMBERED_SESSION_MS = 7 * 24 * 60 * 60 * 1000
const PORTAL_SESSION_MS = 60 * 60 * 1000
const secureCookies = config.get('node_env') === 'production'

export function normalizeEmail(value) {
  return String(value ?? '').trim().toLowerCase()
}

export function hashPassword(password) {
  return bcrypt.hash(password, 12)
}

export function verifyPassword(password, passwordHash) {
  return bcrypt.compare(password, passwordHash)
}

export async function ensureUserVerifiedForLogin(user) {
  if (user.is_deleted) return false
  if (user.is_verified) return true

  const hasLegacyApprovalEvidence =
    user.role === USER_ROLES.ADMIN || Boolean(user.approval?.reviewedAt)

  if (
    user.status !== USER_STATUSES.ACTIVE ||
    !hasLegacyApprovalEvidence
  ) {
    return false
  }

  // Migrate only accounts with evidence that they were approved before
  // is_verified existed. An explicitly false field is never overwritten.
  const migration = await User.updateOne(
    {
      _id: user._id,
      status: USER_STATUSES.ACTIVE,
      is_verified: { $exists: false },
      $or: [
        { role: USER_ROLES.ADMIN },
        { 'approval.reviewedAt': { $ne: null } },
      ],
    },
    { $set: { is_verified: true } },
  )

  if (migration.modifiedCount !== 1) return false

  user.is_verified = true
  return true
}

export function createOpaqueToken() {
  return randomBytes(32).toString('base64url')
}

export function hashToken(token) {
  return createHmac('sha256', config.get('session_pepper')).update(token).digest('hex')
}

function cookieOptions(expiresAt) {
  return {
    httpOnly: true,
    secure: secureCookies,
    sameSite: 'lax',
    path: '/',
    expires: expiresAt,
  }
}

function clientMetadata(req) {
  const forwarded = req.get('x-forwarded-for')
  const ip = forwarded?.split(',')[0]?.trim() || req.ip || ''
  return {
    userAgent: req.get('user-agent')?.slice(0, 500) || null,
    ipHash: ip ? hashToken(ip) : null,
  }
}

async function issueSession({ req, res, kind, lifetimeMs, userId, invitation }) {
  const rawToken = createOpaqueToken()
  const expiresAt = new Date(Date.now() + lifetimeMs)
  const cookieName =
    kind === SESSION_KINDS.INTERNAL ? INTERNAL_COOKIE : PORTAL_COOKIE

  await Session.create({
    tokenHash: hashToken(rawToken),
    kind,
    userId: userId || null,
    portalInvitationId: invitation?._id || null,
    quotationId: invitation?.quotationId || null,
    expiresAt,
    ...clientMetadata(req),
  })

  res.cookie(cookieName, rawToken, cookieOptions(expiresAt))
  return expiresAt
}

export function issueInternalSession(req, res, userId, remember) {
  return issueSession({
    req,
    res,
    kind: SESSION_KINDS.INTERNAL,
    lifetimeMs: remember ? REMEMBERED_SESSION_MS : SHORT_SESSION_MS,
    userId,
  })
}

export function issuePortalSession(req, res, invitation) {
  return issueSession({
    req,
    res,
    kind: SESSION_KINDS.CUSTOMER_PORTAL,
    lifetimeMs: PORTAL_SESSION_MS,
    invitation,
  })
}

async function readSession(req, kind) {
  const cookieName =
    kind === SESSION_KINDS.INTERNAL ? INTERNAL_COOKIE : PORTAL_COOKIE
  const rawToken = req.cookies?.[cookieName]
  if (!rawToken) return null

  const session = await Session.findOne({
    tokenHash: hashToken(rawToken),
    kind,
    revokedAt: null,
    expiresAt: { $gt: new Date() },
  }).populate(kind === SESSION_KINDS.INTERNAL ? 'userId' : 'portalInvitationId')

  if (!session) return null

  if (kind === SESSION_KINDS.INTERNAL) {
    const user = session.userId
    if (
      !user ||
      user.status !== USER_STATUSES.ACTIVE ||
      !(await ensureUserVerifiedForLogin(user))
    ) {
      await Session.updateOne(
        { _id: session._id },
        { $set: { revokedAt: new Date() } },
      )
      return null
    }
  }

  if (kind === SESSION_KINDS.CUSTOMER_PORTAL) {
    const invitation = session.portalInvitationId
    if (
      !invitation ||
      invitation.revokedAt ||
      invitation.expiresAt <= new Date() ||
      invitation.quotationId !== session.quotationId
    ) {
      await Session.updateOne({ _id: session._id }, { $set: { revokedAt: new Date() } })
      return null
    }
  }

  const now = new Date()
  if (now.getTime() - session.lastSeenAt.getTime() > 5 * 60 * 1000) {
    Session.updateOne({ _id: session._id }, { $set: { lastSeenAt: now } }).catch(
      () => {},
    )
  }
  return session
}

export function readInternalSession(req) {
  return readSession(req, SESSION_KINDS.INTERNAL)
}

export function readPortalSession(req) {
  return readSession(req, SESSION_KINDS.CUSTOMER_PORTAL)
}

export async function revokeSession(req, kind) {
  const cookieName =
    kind === SESSION_KINDS.INTERNAL ? INTERNAL_COOKIE : PORTAL_COOKIE
  const rawToken = req.cookies?.[cookieName]
  if (!rawToken) return

  await Session.updateOne(
    { tokenHash: hashToken(rawToken), kind },
    { $set: { revokedAt: new Date() } },
  )
}

export function clearInternalCookie(res) {
  res.clearCookie(INTERNAL_COOKIE, {
    httpOnly: true,
    secure: secureCookies,
    sameSite: 'lax',
    path: '/',
  })
}

export function clearPortalCookie(res) {
  res.clearCookie(PORTAL_COOKIE, {
    httpOnly: true,
    secure: secureCookies,
    sameSite: 'lax',
    path: '/',
  })
}

export function publicUser(user) {
  return {
    id: String(user._id),
    fullName: user.fullName,
    email: user.email,
    role: user.role,
    requestedRole: user.requestedRole,
    status: user.status,
    is_verified: Boolean(user.is_verified),
    is_deleted: Boolean(user.is_deleted),
    _custom_json: user._custom_json
      ? {
          delivery_address: user._custom_json.delivery_address,
          lat: user._custom_json.lat,
          long: user._custom_json.long,
          tier: user._custom_json.tier,
        }
      : null,
  }
}

export function publicRegistration(user) {
  return {
    ...publicUser(user),
    approval: {
      requestedAt: user.approval.requestedAt,
      reviewedAt: user.approval.reviewedAt,
      reviewedByUserId: user.approval.reviewedByUserId
        ? String(user.approval.reviewedByUserId)
        : null,
      reason: user.approval.reason,
    },
  }
}

export function publicPortalSession(session) {
  const invitation = session.portalInvitationId
  return {
    authenticated: true,
    customer: {
      name: invitation.customerName,
      email: invitation.customerEmail,
    },
    quotation: {
      id: invitation.quotationId,
      reference: invitation.quotationReference,
    },
    expiresAt: session.expiresAt,
  }
}

export async function findPortalInvitation(rawToken) {
  return PortalInvitation.findOne({
    tokenHash: hashToken(rawToken),
    revokedAt: null,
    expiresAt: { $gt: new Date() },
  })
}
