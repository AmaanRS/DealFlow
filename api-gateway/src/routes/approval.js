import { Router } from 'express'
import { z } from 'zod'
import { USER_ROLES, USER_STATUSES } from '../constants.js'
import { asyncRoute, parseBody } from '../http.js'
import { requireInternalAuth, requireRoles } from '../middleware.js'
import { User } from '../models.js'
import {
  logger,
  requestLogContext,
  setRequestAttributes,
} from '../telemetry.js'
import { callQuoteService, sendUpstreamResponse } from './quote.js'

const reviewQuoteSchema = z
  .object({
    quote_id: z.string().trim().regex(/^[a-f\d]{24}$/i, 'A valid quote_id is required.'),
    decision: z.enum(['APPROVE', 'REJECT']),
    reason: z.string().trim().min(3).max(2_000).optional(),
  })
  .strict()
  .refine((body) => body.decision !== 'REJECT' || body.reason, {
    path: ['reason'],
    message: 'A rejection reason is required.',
  })

function approvalError(status, code, message) {
  return Object.assign(new Error(message), { status, code })
}

async function findActiveFinanceReviewer() {
  return User.findOne({
    role: USER_ROLES.FINANCE,
    status: USER_STATUSES.ACTIVE,
    is_verified: true,
    is_deleted: false,
  })
    .sort({ createdAt: 1, _id: 1 })
    .select('email')
    .lean()
}

export function buildApprovalUpdate({
  quote,
  decision,
  reason = null,
  reviewer,
  financeReviewer = null,
}) {
  if (!quote?.is_latest_quote || quote.status !== 'PENDING_APPROVAL') {
    throw approvalError(
      409,
      'QUOTE_ALREADY_REVIEWED',
      'This quotation is no longer waiting for approval.',
    )
  }

  if (reviewer.role === USER_ROLES.FINANCE) {
    const managerApproved =
      quote.risk === 'HIGH' &&
      Boolean(quote.approved_by) &&
      quote.approved_by !== reviewer.email

    if (!managerApproved) {
      throw approvalError(
        409,
        'FINANCE_REVIEW_NOT_READY',
        'Finance review is available only after manager approval of a high-risk quotation.',
      )
    }
  } else if (reviewer.role === USER_ROLES.MANAGER) {
    if (!['MEDIUM', 'HIGH'].includes(quote.risk) || quote.approved_by) {
      throw approvalError(
        409,
        'MANAGER_REVIEW_NOT_READY',
        'This quotation is not waiting for manager approval.',
      )
    }
  }

  if (decision === 'REJECT') {
    return {
      updates: {
        status: 'REJECTED',
        approved_by:
          reviewer.role === USER_ROLES.FINANCE ? quote.approved_by : null,
        assigned_to: reviewer.email,
        reason,
      },
      nextReviewer: null,
    }
  }

  if (reviewer.role === USER_ROLES.MANAGER && quote.risk === 'HIGH') {
    if (!financeReviewer?.email) {
      throw approvalError(
        409,
        'REVIEWER_UNAVAILABLE',
        'An active Finance reviewer is required for a high-risk quotation.',
      )
    }

    return {
      updates: {
        status: 'PENDING_APPROVAL',
        approved_by: reviewer.email,
        assigned_to: financeReviewer.email,
        reason,
      },
      nextReviewer: {
        role: USER_ROLES.FINANCE,
        email: financeReviewer.email,
      },
    }
  }

  return {
    updates: {
      status: 'APPROVED',
      approved_by: reviewer.email,
      assigned_to: reviewer.email,
      reason,
    },
    nextReviewer: null,
  }
}

function createApprovalRouter(reviewerRole) {
  const router = Router()
  router.use(asyncRoute(requireInternalAuth))
  router.post(
    '/approve_quote',
    requireRoles(reviewerRole),
    asyncRoute(async (req, res) => {
      const body = parseBody(reviewQuoteSchema, req, res)
      if (!body) return

      const current = await callQuoteService(
        req,
        `/quote/${encodeURIComponent(body.quote_id)}`,
      )
      if (current.status >= 400) {
        sendUpstreamResponse(req, res, current, 'get_for_approval')
        return
      }

      const financeReviewer =
        body.decision === 'APPROVE' &&
        req.auth.user.role === USER_ROLES.MANAGER &&
        current.data.quote?.risk === 'HIGH'
          ? await findActiveFinanceReviewer()
          : null
      const approval = buildApprovalUpdate({
        quote: current.data.quote,
        decision: body.decision,
        reason: body.reason ?? null,
        reviewer: req.auth.user,
        financeReviewer,
      })

      const result = await callQuoteService(req, '/quote/quotation', {
        method: 'PATCH',
        body: {
          quote_id: body.quote_id,
          ...(current.data.revision?.quote_version
            ? { expected_version: current.data.revision.quote_version }
            : {}),
          updates: approval.updates,
        },
      })

      result.data.approval = {
        decision: body.decision,
        complete: result.status < 400 && !approval.nextReviewer,
        next_reviewer: approval.nextReviewer,
      }
      setRequestAttributes(req, {
        'approval.decision': body.decision,
        'approval.reviewer_role': req.auth.user.role,
        'approval.next_reviewer_role': approval.nextReviewer?.role,
        'quote.id': body.quote_id,
      })
      logger.info(
        'Quotation approval decision completed',
        requestLogContext(req, {
          'event.name': 'quote.approval.completed',
          'event.outcome': result.status < 400 ? 'success' : 'failure',
        }),
      )
      sendUpstreamResponse(req, res, result, 'review')
    }),
  )
  return router
}

export const financeApprovalRoutes = createApprovalRouter(USER_ROLES.FINANCE)
export default createApprovalRouter(USER_ROLES.MANAGER)
