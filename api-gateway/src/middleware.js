import { SESSION_KINDS } from './constants.js'
import { readInternalSession, readPortalSession } from './security.js'
import {
  logger,
  requestLogContext,
  setActorAttributes,
  setRequestAttributes,
  tracing,
} from './telemetry.js'

export async function requireInternalAuth(req, res, next) {
  const session = await readInternalSession(req)
  if (!session) {
    setRequestAttributes(req, {
      'event.outcome': 'failure',
      'error.code': 'AUTHENTICATION_REQUIRED',
      'auth.outcome': 'missing_or_expired_session',
      'session.kind': SESSION_KINDS.INTERNAL,
    })
    logger.info(
      'Internal authentication denied',
      requestLogContext(req, {
        'event.name': 'auth.internal.denied',
        'event.outcome': 'failure',
        'error.code': 'AUTHENTICATION_REQUIRED',
        'auth.outcome': 'missing_or_expired_session',
        'session.kind': SESSION_KINDS.INTERNAL,
      }),
    )
    return res.status(401).json({
      code: 'AUTHENTICATION_REQUIRED',
      message: 'Sign in to continue.',
    })
  }

  req.auth = { session, user: session.userId }
  setActorAttributes(tracing.getActiveSpan(), session.userId)
  setRequestAttributes(req, {
    'auth.outcome': 'authenticated',
    'session.kind': SESSION_KINDS.INTERNAL,
  })
  return next()
}

export function requireRoles(...roles) {
  return function roleGuard(req, res, next) {
    if (!req.auth?.user || !roles.includes(req.auth.user.role)) {
      setRequestAttributes(req, {
        'event.outcome': 'failure',
        'error.code': 'FORBIDDEN',
        'authorization.outcome': 'role_denied',
        'authorization.required_roles': roles,
      })
      logger.info(
        'Role authorization denied',
        requestLogContext(req, {
          'event.name': 'authorization.role.denied',
          'event.outcome': 'failure',
          'error.code': 'FORBIDDEN',
          'authorization.outcome': 'role_denied',
          'authorization.required_roles': roles,
        }),
      )
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
    setRequestAttributes(req, {
      'event.outcome': 'failure',
      'error.code': 'PORTAL_AUTHENTICATION_REQUIRED',
      'auth.outcome': 'missing_or_expired_session',
      'session.kind': SESSION_KINDS.CUSTOMER_PORTAL,
    })
    logger.info(
      'Customer portal authentication denied',
      requestLogContext(req, {
        'event.name': 'auth.customer_portal.denied',
        'event.outcome': 'failure',
        'error.code': 'PORTAL_AUTHENTICATION_REQUIRED',
        'auth.outcome': 'missing_or_expired_session',
        'session.kind': SESSION_KINDS.CUSTOMER_PORTAL,
      }),
    )
    return res.status(401).json({
      code: 'PORTAL_AUTHENTICATION_REQUIRED',
      message: 'Open the secure quotation link to continue.',
    })
  }

  req.portalAuth = { session, invitation: session.portalInvitationId }
  setRequestAttributes(req, {
    'auth.outcome': 'authenticated',
    'session.kind': SESSION_KINDS.CUSTOMER_PORTAL,
    'portal.invitation.id': String(session.portalInvitationId._id),
    'quotation.id': session.portalInvitationId.quotationId,
  })
  return next()
}
