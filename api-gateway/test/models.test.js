import assert from 'node:assert/strict'
import test from 'node:test'
import { User } from '@app/models/auth'
import { USER_ROLES } from '@app/models/constants'
import { CategoryDiscount, TierDiscount } from '@app/models/discounts'

function customer(overrides = {}) {
  return new User({
    fullName: 'Test Customer',
    email: 'customer@example.com',
    emailLower: 'customer@example.com',
    passwordHash: 'already-hashed-for-model-test',
    role: USER_ROLES.CUSTOMER,
    requestedRole: USER_ROLES.CUSTOMER,
    status: 'ACTIVE',
    approval: {},
    _custom_json: {
      delivery_address: '1 Test Street',
      lat: 19.076,
      long: 72.8777,
    },
    ...overrides,
  })
}

test('users and discounts use separate collections on the same connection', () => {
  assert.equal(User.db, TierDiscount.db)
  assert.equal(User.db, CategoryDiscount.db)
  assert.equal(User.collection.collectionName, 'users')
  assert.equal(TierDiscount.collection.collectionName, 'tier_discounts')
  assert.equal(CategoryDiscount.collection.collectionName, 'category_discounts')
})

test('new users persist an explicit unverified boolean by default', async () => {
  const user = customer({
    _custom_json: {
      delivery_address: '1 Test Street',
      lat: 19.076,
      long: 72.8777,
      tier: 'BRONZE',
    },
  })

  await user.validate()

  assert.equal(user.is_verified, false)
  assert.equal(user.is_deleted, false)
  assert.equal(User.schema.path('is_verified').instance, 'Boolean')
  assert.equal(User.schema.path('is_verified').options.required, true)
  assert.equal(User.schema.path('is_deleted').instance, 'Boolean')
  assert.equal(User.schema.path('is_deleted').options.required, true)
})

test('tier discounts must be non-negative integers', async () => {
  await assert.rejects(
    new TierDiscount({ tier: 'INVALID', discount: 1.5 }).validate(),
    /discount must be an integer/,
  )
})

test('subscription category discounts remain zero', async () => {
  await assert.rejects(
    new CategoryDiscount({ subscription: 10 }).validate(),
    /subscription must be 0/,
  )
})

test('the lowest-discount tier is assigned when a customer has no tier', async () => {
  const originalFindOne = TierDiscount.findOne
  TierDiscount.findOne = () => ({
    sort() {
      return this
    },
    select() {
      return this
    },
    lean() {
      return Promise.resolve({ tier: 'BRONZE' })
    },
  })

  try {
    const user = customer()
    await user.validate()
    assert.equal(user._custom_json.tier, 'BRONZE')
  } finally {
    TierDiscount.findOne = originalFindOne
  }
})

test('customer data is rejected for a non-customer role', async () => {
  const user = customer({
    role: USER_ROLES.SALES_REP,
    requestedRole: USER_ROLES.SALES_REP,
  })

  await assert.rejects(user.validate(), /_custom_json is only supported for CUSTOMER/)
})
