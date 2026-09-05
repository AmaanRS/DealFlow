import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { USER_ROLES, USER_STATUSES } from '@app/models/constants'

// API config loads the service's OpenTelemetry environment before the route
// imports telemetry and the shared observability package.
await import('../src/config.js')
const { default: adminRoutes, reviewPendingRegistration } = await import(
  '../src/routes/admin.js'
)
const { shutdownObservability } = await import('@app/observability')

after(() => shutdownObservability())

const userId = '507f1f77bcf86cd799439011'
const reviewerUserId = '507f191e810c19729de860ea'

function reviewDependencies({ is_deleted, is_verified, role, status }) {
  const pendingUser = {
    _id: userId,
    requestedRole: USER_ROLES.SALES_REP,
  }
  const observed = {}

  return {
    observed,
    dependencies: {
      UserModel: {
        findOne: async () => pendingUser,
        findOneAndUpdate: async (filter, update, options) => {
          observed.filter = filter
          observed.update = update
          observed.options = options
          return {
            ...pendingUser,
            role,
            status,
            is_verified,
            is_deleted,
          }
        },
      },
      AuditEventModel: {
        create: async (event) => {
          observed.auditEvent = event
        },
      },
    },
  }
}

test('POST approve_user is registered as an admin route', () => {
  const route = adminRoutes.stack.find(
    (layer) => layer.route?.path === '/approve_user',
  )?.route

  assert.ok(route)
  assert.equal(route.methods.post, true)
})

test('approval activates the user and persists is_verified true', async () => {
  const { observed, dependencies } = reviewDependencies({
    is_deleted: false,
    is_verified: true,
    role: USER_ROLES.SALES_REP,
    status: USER_STATUSES.ACTIVE,
  })

  const result = await reviewPendingRegistration(
    {
      requestId: userId,
      decision: 'APPROVE',
      reviewerUserId,
    },
    dependencies,
  )

  assert.equal(result.ok, true)
  assert.equal(result.user.is_verified, true)
  assert.deepEqual(observed.update.$set, {
    role: USER_ROLES.SALES_REP,
    status: USER_STATUSES.ACTIVE,
    is_verified: true,
    is_deleted: false,
    'approval.reviewedAt': observed.update.$set['approval.reviewedAt'],
    'approval.reviewedByUserId': reviewerUserId,
    'approval.reason': null,
  })
  assert.ok(observed.update.$set['approval.reviewedAt'] instanceof Date)
  assert.equal(observed.options.runValidators, true)
  assert.equal(observed.auditEvent.metadata.is_verified, true)
  assert.equal(observed.auditEvent.metadata.is_deleted, false)
})

test('rejection soft deletes the user and persists the admin reason', async () => {
  const { observed, dependencies } = reviewDependencies({
    is_deleted: true,
    is_verified: false,
    role: null,
    status: USER_STATUSES.REJECTED,
  })

  const result = await reviewPendingRegistration(
    {
      requestId: userId,
      decision: 'REJECT',
      reason: 'Access could not be confirmed.',
      reviewerUserId,
    },
    dependencies,
  )

  assert.equal(result.ok, true)
  assert.equal(observed.update.$set.is_verified, false)
  assert.equal(observed.update.$set.is_deleted, true)
  assert.equal(observed.update.$set.status, USER_STATUSES.REJECTED)
  assert.equal(observed.update.$set['approval.reason'], 'Access could not be confirmed.')
  assert.equal(observed.auditEvent.metadata.is_verified, false)
  assert.equal(observed.auditEvent.metadata.is_deleted, true)
  assert.equal(observed.auditEvent.metadata.reason, 'Access could not be confirmed.')
})
