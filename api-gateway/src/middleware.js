import { readInternalSession, readPortalSession } from './security.js'

export async function requireInternalAuth(req, res, next) {
  const session = await readInternalSession(req)
  if (!session) {
    return res.status(401).json({
      code: 'AUTHENTICATION_REQUIRED',
      message: 'Sign in to continue.',
    })
  }

  req.auth = { session, user: session.userId }
  return next()
}

export function requireRoles(...roles) {
  return function roleGuard(req, res, next) {
    if (!req.auth?.user || !roles.includes(req.auth.user.role)) {
      return res.status(403).json({
        code: 'FORBIDDEN',
        message: 'You do not have permission to perform this action.',
      })
    }
    return next()
  }
}

export async function requirePortalAuth(req, res, next) {
  const session = await readPortalSession(req)
  if (!session) {
    return res.status(401).json({
      code: 'PORTAL_AUTHENTICATION_REQUIRED',
      message: 'Open the secure quotation link to continue.',
    })
  }

  req.portalAuth = { session, invitation: session.portalInvitationId }
  return next()
}
