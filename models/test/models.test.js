import assert from 'node:assert/strict'
import test from 'node:test'
import mongoose from 'mongoose'

import {
  Article,
  AuditEvent,
  Billing,
  CategoryDiscount,
  Hsn,
  Item,
  PortalInvitation,
  Quote,
  QuoteRevisionHistory,
  RiskConfiguration,
  Session,
  Store,
  SubscriptionDetails,
  SubscriptionRevisionHistory,
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
    new TierDiscount({ tier: 'GOLD', discount: 101 }).validate(),
    (error) => error.errors.discount?.kind === 'max',
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
    new CategoryDiscount({ hardware: 101 }).validate(),
    (error) => error.errors.hardware?.kind === 'max',
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
    [Quote, 'quotes'],
    [QuoteRevisionHistory, 'quote_revision_history'],
    [RiskConfiguration, 'risk_configurations'],
    [SubscriptionDetails, 'subscription_details'],
    [SubscriptionRevisionHistory, 'subscription_revision_history'],
    [Billing, 'billing'],
  ])

  for (const [Model, collectionName] of expectedCollections) {
    assert.equal(Model.collection.collectionName, collectionName, Model.modelName)
  }
})

test('risk configuration defaults to 25/50 and requires ordered thresholds', async () => {
  const configuration = new RiskConfiguration()

  await configuration.validate()

  assert.equal(configuration._id, 'quote-risk')
  assert.equal(configuration.medium_risk_threshold, 25)
  assert.equal(configuration.high_risk_threshold, 50)

  await assert.rejects(
    new RiskConfiguration({
      medium_risk_threshold: 50,
      high_risk_threshold: 25,
    }).validate(),
    (error) =>
      error.errors.high_risk_threshold?.message ===
      'high_risk_threshold must be greater than medium_risk_threshold',
  )
})

test('quote models preserve references, workflow enums, and UUID defaults', () => {
  const customerPath = Quote.schema.path('customer')
  const statusPath = Quote.schema.path('status')
  const riskPath = Quote.schema.path('risk')
  const subscriptionsPath = Quote.schema.path('subscription_details')
  const subscriptionLatestPath = SubscriptionDetails.schema.path('is_latest')
  const productSchema = Quote.schema.path('products').schema
  const fulfillmentSchema = Quote.schema.path('fulfillment_details').schema
  const quoteRevision = new QuoteRevisionHistory({
    quote_id: new mongoose.Types.ObjectId(),
    quote_version: 1,
  })
  const billing = new Billing({ quote_id: new mongoose.Types.ObjectId() })

  assert.equal(customerPath.instance, 'String')
  assert.equal(customerPath.options.ref, 'User')
  assert.deepEqual(statusPath.options.enum, [
    'APPROVED',
    'REJECTED',
    'DRAFT',
    'PENDING_APPROVAL',
    'NEGOTIATION',
    'COMPLETED',
  ])
  assert.deepEqual(riskPath.options.enum, ['LOW', 'MEDIUM', 'HIGH'])
  assert.equal(
    subscriptionsPath.embeddedSchemaType.options.ref,
    'SubscriptionDetails',
  )
  assert.equal(subscriptionLatestPath.instance, 'Boolean')
  assert.equal(subscriptionLatestPath.options.default, true)
  assert.equal(productSchema.path('item_id').options.ref, 'Item')
  assert.equal(productSchema.path('article_id').options.ref, 'Article')
  assert.equal(productSchema.path('store_id').instance, 'ObjectId')
  assert.equal(productSchema.path('store_id').options.ref, 'Store')
  assert.deepEqual(productSchema.path('category').options.enum, [
    'HARDWARE',
    'SERVICES',
    'SUBSCRIPTION',
  ])
  assert.equal(productSchema.path('unit_price').instance, 'Number')
  assert.equal(productSchema.path('gst').options.max, 100)
  assert.equal(productSchema.path('product_discount').options.max, 100)
  assert.equal(productSchema.path('applied_discount').options.max, 100)
  assert.equal(productSchema.path('category_discount').options.max, 100)
  assert.equal(Quote.schema.path('order_discount').options.max, 100)
  assert.equal(Quote.schema.path('tier_discount').options.max, 100)
  assert.equal(Store.schema.path('_id').instance, 'ObjectId')
  assert.equal(Article.schema.path('store_id').instance, 'ObjectId')
  assert.equal(Article.schema.path('store_id').options.ref, 'Store')
  assert.equal(fulfillmentSchema.path('store').instance, 'ObjectId')
  assert.equal(fulfillmentSchema.path('store').options.ref, 'Store')
  assert.match(quoteRevision.negotiation_id, /^[0-9a-f-]{36}$/i)
  assert.match(billing.invoice_id, /^[0-9a-f-]{36}$/i)
})

test('quote revision history has one row per quote and unique versions per negotiation', () => {
  const indexes = QuoteRevisionHistory.schema.indexes()
  const quoteIndex = indexes.find(
    ([fields]) => JSON.stringify(fields) === JSON.stringify({ quote_id: 1 }),
  )
  const negotiationVersionIndex = indexes.find(
    ([fields]) =>
      JSON.stringify(fields) ===
      JSON.stringify({ negotiation_id: 1, quote_version: 1 }),
  )

  assert.equal(quoteIndex?.[1].unique, true)
  assert.equal(negotiationVersionIndex?.[1].unique, true)
  assert.equal(
    QuoteRevisionHistory.schema.path('quote_id').options.immutable,
    true,
  )
  assert.equal(
    QuoteRevisionHistory.schema.path('quote_version').options.immutable,
    true,
  )
  assert.equal(
    indexes.some(
      ([fields]) =>
        JSON.stringify(fields) ===
        JSON.stringify({ quote_id: 1, quote_version: 1 }),
    ),
    false,
  )
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
