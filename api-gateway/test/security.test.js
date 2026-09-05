import assert from 'node:assert/strict'
import test from 'node:test'
import { User } from '@app/models/auth'
import { USER_ROLES, USER_STATUSES } from '@app/models/constants'
import {
  createOpaqueToken,
  ensureUserVerifiedForLogin,
  hashPassword,
  hashToken,
  normalizeEmail,
  verifyPassword,
} from '../src/security.js'

test('email normalization is deterministic', () => {
  assert.equal(normalizeEmail('  Sales@Example.COM '), 'sales@example.com')
})

test('passwords are stored as bcrypt hashes', async () => {
  const password = 'A-secure-test-password'
  const passwordHash = await hashPassword(password)

  assert.notEqual(passwordHash, password)
  assert.equal(await verifyPassword(password, passwordHash), true)
  assert.equal(await verifyPassword('wrong-password', passwordHash), false)
})

test('opaque tokens are random and only deterministic after hashing', () => {
  const first = createOpaqueToken()
  const second = createOpaqueToken()

  assert.notEqual(first, second)
  assert.equal(hashToken(first), hashToken(first))
  assert.notEqual(hashToken(first), first)
})

test('verified users pass login verification without a migration write', async () => {
  const originalUpdateOne = User.updateOne
  User.updateOne = () => {
    throw new Error('verified users must not be migrated')
  }

  try {
    assert.equal(
      await ensureUserVerifiedForLogin({
        is_verified: true,
        status: USER_STATUSES.ACTIVE,
        role: USER_ROLES.SALES_REP,
      }),
      true,
    )
  } finally {
    User.updateOne = originalUpdateOne
  }
})

test('legacy active users with approval evidence are migrated once', async () => {
  const originalUpdateOne = User.updateOne
  const user = {
    _id: '507f1f77bcf86cd799439011',
    is_verified: false,
    status: USER_STATUSES.ACTIVE,
    role: USER_ROLES.MANAGER,
    approval: { reviewedAt: new Date('2026-09-05T12:00:00.000Z') },
  }
  let observedFilter
  let observedUpdate

  User.updateOne = async (filter, update) => {
    observedFilter = filter
    observedUpdate = update
    return { modifiedCount: 1 }
  }

  try {
    assert.equal(await ensureUserVerifiedForLogin(user), true)
    assert.equal(user.is_verified, true)
    assert.deepEqual(observedFilter.is_verified, { $exists: false })
    assert.deepEqual(observedUpdate, { $set: { is_verified: true } })
  } finally {
    User.updateOne = originalUpdateOne
  }
})

test('a predefined active admin without approval metadata is migrated', async () => {
  const originalUpdateOne = User.updateOne
  const admin = {
    _id: '507f1f77bcf86cd799439013',
    is_verified: false,
    status: USER_STATUSES.ACTIVE,
    role: USER_ROLES.ADMIN,
    approval: {},
  }
  let observedFilter

  User.updateOne = async (filter) => {
    observedFilter = filter
    return { modifiedCount: 1 }
  }

  try {
    assert.equal(await ensureUserVerifiedForLogin(admin), true)
    assert.equal(admin.is_verified, true)
    assert.deepEqual(observedFilter.$or, [
      { role: USER_ROLES.ADMIN },
      { 'approval.reviewedAt': { $ne: null } },
    ])
  } finally {
    User.updateOne = originalUpdateOne
  }
})

test('an unreviewed legacy non-admin is not auto-verified', async () => {
  const originalUpdateOne = User.updateOne
  User.updateOne = () => {
    throw new Error('unreviewed users must not be migrated')
  }

  try {
    assert.equal(
      await ensureUserVerifiedForLogin({
        _id: '507f1f77bcf86cd799439014',
        is_verified: false,
        status: USER_STATUSES.ACTIVE,
        role: USER_ROLES.SALES_REP,
        approval: {},
      }),
      false,
    )
  } finally {
    User.updateOne = originalUpdateOne
  }
})

test('an explicit unverified account is never auto-verified', async () => {
  const originalUpdateOne = User.updateOne
  User.updateOne = async () => ({ modifiedCount: 0 })

  try {
    assert.equal(
      await ensureUserVerifiedForLogin({
        _id: '507f1f77bcf86cd799439012',
        is_verified: false,
        status: USER_STATUSES.ACTIVE,
        role: USER_ROLES.ADMIN,
        approval: {},
      }),
      false,
    )
  } finally {
    User.updateOne = originalUpdateOne
  }
})
