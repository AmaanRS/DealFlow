import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { USER_ROLES, USER_STATUSES } from '@app/models/constants'

await import('../src/config.js')
const { createRegistrationRequest, default: authRoutes } = await import('../src/routes/auth.js')
const { shutdownObservability } = await import('@app/observability')

after(() => shutdownObservability())

test('password reset request and completion endpoints are registered', () => {
  const routePaths = authRoutes.stack
    .map((layer) => layer.route?.path)
    .flat()

  assert.ok(routePaths.includes('/forgot_password'))
  assert.ok(routePaths.includes('/reset_password'))
})

test('registration defaults to CUSTOMER when requestedRole is omitted', async () => {
  let createdUser
  const customerDetails = {
    delivery_address: '24 Marine Drive, Mumbai, Maharashtra 400020',
    lat: 18.943,
    long: 72.823,
  }
  const UserModel = {
    findOne: async () => null,
    create: async (user) => {
      createdUser = { _id: '507f1f77bcf86cd799439012', ...user }
      return createdUser
    },
  }

  const result = await createRegistrationRequest(
    {
      fullName: 'Customer User',
      email: 'customer@example.com',
      password: 'CustomerPassword1',
      _custom_json: customerDetails,
    },
    {
      UserModel,
      passwordHasher: async () => 'hashed-customer-password',
      submittedAt: new Date('2026-09-06T11:00:00.000Z'),
    },
  )

  assert.equal(result.resubmitted, false)
  assert.equal(createdUser.requestedRole, USER_ROLES.CUSTOMER)
  assert.equal(createdUser.status, USER_STATUSES.PENDING_APPROVAL)
  assert.equal(createdUser.role, null)
  assert.equal(createdUser.is_verified, false)
  assert.deepEqual(createdUser._custom_json, customerDetails)
})

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
