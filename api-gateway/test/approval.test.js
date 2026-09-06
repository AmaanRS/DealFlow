import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { USER_ROLES } from '@app/models/constants'

await import('../src/config.js')
const { buildApprovalUpdate, default: approvalRoutes } = await import(
  '../src/routes/approval.js'
)
const { shutdownObservability } = await import('@app/observability')

after(() => shutdownObservability())

const pendingQuote = {
  _id: '507f1f77bcf86cd799439011',
  is_latest_quote: true,
  status: 'PENDING_APPROVAL',
  risk: 'MEDIUM',
  approved_by: null,
  assigned_to: 'manager@example.com',
}

const manager = {
  role: USER_ROLES.MANAGER,
  email: 'manager@example.com',
}

test('approve_quote is registered for persisted approval decisions', () => {
  const route = approvalRoutes.stack.find(
    (layer) => layer.route?.path === '/approve_quote',
  )?.route

  assert.equal(route?.methods.post, true)
})

test('manager approval completes a MEDIUM-risk quotation', () => {
  const result = buildApprovalUpdate({
    quote: pendingQuote,
    decision: 'APPROVE',
    reviewer: manager,
  })

  assert.deepEqual(result, {
    updates: {
      status: 'APPROVED',
      approved_by: 'manager@example.com',
      assigned_to: 'manager@example.com',
      reason: null,
    },
    nextReviewer: null,
  })
})

test('manager approval routes a HIGH-risk quotation to Finance', () => {
  const result = buildApprovalUpdate({
    quote: { ...pendingQuote, risk: 'HIGH' },
    decision: 'APPROVE',
    reviewer: manager,
    financeReviewer: { email: 'finance@example.com' },
  })

  assert.equal(result.updates.status, 'PENDING_APPROVAL')
  assert.equal(result.updates.approved_by, 'manager@example.com')
  assert.equal(result.updates.assigned_to, 'finance@example.com')
  assert.deepEqual(result.nextReviewer, {
    role: USER_ROLES.FINANCE,
    email: 'finance@example.com',
  })
})

test('Finance completes a HIGH-risk quotation after manager approval', () => {
  const result = buildApprovalUpdate({
    quote: {
      ...pendingQuote,
      risk: 'HIGH',
      approved_by: 'manager@example.com',
      assigned_to: 'finance@example.com',
    },
    decision: 'APPROVE',
    reviewer: {
      role: USER_ROLES.FINANCE,
      email: 'finance@example.com',
    },
  })

  assert.equal(result.updates.status, 'APPROVED')
  assert.equal(result.updates.approved_by, 'finance@example.com')
})

test('rejection is terminal and retains its reason', () => {
  const result = buildApprovalUpdate({
    quote: pendingQuote,
    decision: 'REJECT',
    reason: 'Discount exposure is too high.',
    reviewer: manager,
  })

  assert.equal(result.updates.status, 'REJECTED')
  assert.equal(result.updates.approved_by, null)
  assert.equal(result.updates.reason, 'Discount exposure is too high.')
  assert.equal(result.nextReviewer, null)
})

test('a manager can decide a quote from the shared manager queue', () => {
  const result = buildApprovalUpdate({
    quote: { ...pendingQuote, assigned_to: 'other-manager@example.com' },
    decision: 'APPROVE',
    reviewer: manager,
  })

  assert.equal(result.updates.status, 'APPROVED')
  assert.equal(result.updates.approved_by, manager.email)
  assert.equal(result.updates.assigned_to, manager.email)
})
