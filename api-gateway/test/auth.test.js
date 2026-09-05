import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { USER_ROLES, USER_STATUSES } from '@app/models/constants'

await import('../src/config.js')
const { createRegistrationRequest } = await import('../src/routes/auth.js')
const { shutdownObservability } = await import('@app/observability')

after(() => shutdownObservability())

test('a rejected user can resubmit registration with the same user id', async () => {
  const previousReviewedAt = new Date('2026-09-05T10:30:00.000Z')
  const existingUser = {
    _id: '507f1f77bcf86cd799439011',
    fullName: 'Old Name',
    email: 'retry@example.com',
    emailLower: 'retry@example.com',
    role: null,
    requestedRole: USER_ROLES.SALES_REP,
    status: USER_STATUSES.REJECTED,
    is_verified: false,
    is_deleted: true,
    approval: {
      requestedAt: new Date('2026-09-04T10:00:00.000Z'),
      reviewedAt: previousReviewedAt,
      reviewedByUserId: '507f191e810c19729de860ea',
      reason: 'Use your company identity.',
    },
    async save() {
      return this
    },
  }
  let auditEvent
  const UserModel = {
    findOne: async () => existingUser,
    create: async () => {
      throw new Error('resubmission must reuse the existing user document')
    },
  }
  const AuditEventModel = {
    create: async (event) => {
      auditEvent = event
      return event
    },
  }

  const result = await createRegistrationRequest(
    {
      fullName: 'Corrected Name',
      email: 'retry@example.com',
      password: 'UpdatedPassword1',
      requestedRole: USER_ROLES.MANAGER,
    },
    {
      UserModel,
      AuditEventModel,
      passwordHasher: async () => 'hashed-updated-password',
      submittedAt: new Date('2026-09-06T10:00:00.000Z'),
      requestId: 'req_registration_resubmit',
    },
  )

  assert.equal(result.user._id, existingUser._id)
  assert.equal(result.resubmitted, true)
  assert.equal(existingUser.fullName, 'Corrected Name')
  assert.equal(existingUser.requestedRole, USER_ROLES.MANAGER)
  assert.equal(existingUser.status, USER_STATUSES.PENDING_APPROVAL)
  assert.equal(existingUser.is_verified, false)
  assert.equal(existingUser.is_deleted, false)
  assert.equal(existingUser.passwordHash, 'hashed-updated-password')
  assert.equal(existingUser.approval.reason, null)
  assert.equal(auditEvent.eventType, 'USER_REGISTRATION_RESUBMITTED')
  assert.equal(
    auditEvent.metadata.previousRejection.reason,
    'Use your company identity.',
  )
  assert.equal(
    auditEvent.metadata.previousRejection.reviewedAt,
    previousReviewedAt,
  )
})
