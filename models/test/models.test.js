import assert from 'node:assert/strict'
import test from 'node:test'

import {
  Article,
  AuditEvent,
  CategoryDiscount,
  Hsn,
  Item,
  PortalInvitation,
  Session,
  Store,
  TierDiscount,
  User,
} from '../index.js'
import {
  CategoryDiscount as GatewayCategoryDiscount,
  TierDiscount as GatewayTierDiscount,
} from '../../api-gateway/src/models.js'
import {
  CategoryDiscount as NightSkyCategoryDiscount,
  TierDiscount as NightSkyTierDiscount,
} from '../../night_sky/models.js'

test('TierDiscount validates and normalizes its persisted values', async () => {
  const validDiscount = new TierDiscount({ tier: '  GOLD  ', discount: 12 })

  await validDiscount.validate()

  assert.equal(validDiscount.tier, 'GOLD')
  assert.equal(validDiscount.discount, 12)
  assert.equal(TierDiscount.schema.path('tier').options.unique, true)

  await assert.rejects(
    new TierDiscount({ tier: '   ', discount: 0 }).validate(),
    (error) => error.errors.tier?.kind === 'required',
  )
  await assert.rejects(
    new TierDiscount({ tier: 'GOLD' }).validate(),
    (error) => error.errors.discount?.kind === 'required',
  )
  await assert.rejects(
    new TierDiscount({ tier: 'GOLD', discount: -1 }).validate(),
    (error) => error.errors.discount?.kind === 'min',
  )
  await assert.rejects(
    new TierDiscount({ tier: 'GOLD', discount: 1.5 }).validate(),
    (error) => error.errors.discount?.message === 'discount must be an integer',
  )
  await assert.rejects(
    new TierDiscount({ tier: 'x'.repeat(101), discount: 0 }).validate(),
    (error) => error.errors.tier?.kind === 'maxlength',
  )
})

test('CategoryDiscount applies zero defaults and rejects invalid discounts', async () => {
  const defaultDiscount = new CategoryDiscount()

  await defaultDiscount.validate()

  assert.equal(defaultDiscount.hardware, 0)
  assert.equal(defaultDiscount.service, 0)
  assert.equal(defaultDiscount.subscription, 0)
  assert.equal(CategoryDiscount.schema.path('subscription').options.immutable, true)

  await assert.rejects(
    new CategoryDiscount({ hardware: -1 }).validate(),
    (error) => error.errors.hardware?.kind === 'min',
  )
  await assert.rejects(
    new CategoryDiscount({ service: -1 }).validate(),
    (error) => error.errors.service?.kind === 'min',
  )
  await assert.rejects(
    new CategoryDiscount({ subscription: 1 }).validate(),
    (error) => error.errors.subscription?.message === 'subscription must be 0',
  )
})

test('every shared model keeps its established MongoDB collection name', () => {
  const expectedCollections = new Map([
    [CategoryDiscount, 'category_discounts'],
    [TierDiscount, 'tier_discounts'],
    [User, 'users'],
    [Session, 'sessions'],
    [PortalInvitation, 'portalinvitations'],
    [AuditEvent, 'auditevents'],
    [Hsn, 'hsn'],
    [Store, 'stores'],
    [Article, 'articles'],
    [Item, 'items'],
  ])

  for (const [Model, collectionName] of expectedCollections) {
    assert.equal(Model.collection.collectionName, collectionName, Model.modelName)
  }
})

test('the shared User schema persists verification and soft deletion flags', () => {
  const verificationPath = User.schema.path('is_verified')
  const deletionPath = User.schema.path('is_deleted')
  const user = new User()

  assert.equal(verificationPath.instance, 'Boolean')
  assert.equal(verificationPath.options.required, true)
  assert.equal(user.is_verified, false)
  assert.equal(deletionPath.instance, 'Boolean')
  assert.equal(deletionPath.options.required, true)
  assert.equal(user.is_deleted, false)
})

test('both services re-export the same shared discount model objects', () => {
  assert.strictEqual(GatewayTierDiscount, TierDiscount)
  assert.strictEqual(NightSkyTierDiscount, TierDiscount)
  assert.strictEqual(GatewayCategoryDiscount, CategoryDiscount)
  assert.strictEqual(NightSkyCategoryDiscount, CategoryDiscount)
})
