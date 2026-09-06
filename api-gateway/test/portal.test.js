import assert from 'node:assert/strict'
import { after, test } from 'node:test'

await import('../src/config.js')
const {
  buildPortalQuoteUpdate,
  default: portalRoutes,
  publicPortalQuoteSummary,
  publicPortalQuotation,
} = await import('../src/routes/portal.js')
const { shutdownObservability } = await import('@app/observability')

after(() => shutdownObservability())

const quote = {
  _id: '64b000000000000000000001',
  customer: {
    _id: '64b000000000000000000002',
    fullName: 'Asha Mehta',
    email: 'asha@example.com',
    _custom_json: { tier: 'GOLD' },
  },
  products: [
    {
      _id: '64b000000000000000000003',
      article_id: { _id: '64b000000000000000000004' },
      name: 'Ergonomic desk',
      hsn: '9403',
      category: 'HARDWARE',
      gst: 18,
      unit_price: 1000,
      product_discount: 15,
      inv: 2,
      applied_discount: 5,
      category_discount: 10,
    },
  ],
  tier_discount: 5,
  order_discount: 5,
  cost_price: 2000,
  discounted_price: 1543.28,
  selling_price: 1821.06,
  created_by: 'sales@example.com',
  approved_by: 'manager@example.com',
  assigned_to: 'manager@example.com',
  status: 'NEGOTIATION',
  reason: 'Internal approval notes',
  subscription_details: [],
  createdAt: '2026-09-06T10:00:00.000Z',
  updatedAt: '2026-09-06T11:00:00.000Z',
}

const revision = {
  quote_version: 2,
  negotiation_id: '12345678-1234-4123-8123-123456789abc',
}

const invitation = {
  _id: '64b000000000000000000006',
  quotationReference: 'Q-2026-0091',
  customerName: 'Asha Mehta',
  customerEmail: 'asha@example.com',
}

test('customer quotation routes are registered on the gateway', () => {
  const methodsByPath = new Map(
    portalRoutes.stack
      .filter((layer) => layer.route)
      .map((layer) => [layer.route.path, layer.route.methods]),
  )

  assert.equal(methodsByPath.get('/quotation')?.get, true)
  assert.equal(methodsByPath.get('/quotations')?.get, true)
  assert.equal(methodsByPath.get('/quotation-history')?.get, true)
  assert.equal(methodsByPath.get('/negotiations')?.post, true)
  assert.equal(methodsByPath.get('/confirm')?.post, true)
})

test('portal quote updates preserve trusted quote ownership and products', () => {
  const body = buildPortalQuoteUpdate(quote, revision, {
    status: 'NEGOTIATION',
    reason: 'Customer requested changes.',
  })

  assert.deepEqual(body, {
    quote_id: quote._id,
    expected_version: 2,
    updates: {
      customer: quote.customer._id,
      products: [{
        article_id: '64b000000000000000000004',
        category: 'HARDWARE',
        inv: 2,
        applied_discount: 5,
      }],
      order_discount: 5,
      created_by: 'sales@example.com',
      approved_by: 'manager@example.com',
      assigned_to: 'sales@example.com',
      status: 'NEGOTIATION',
      reason: 'Customer requested changes.',
      subscription_details: [],
    },
  })
})

test('customer quotation response exposes live commercial data without internal fields', () => {
  const result = publicPortalQuotation(quote, revision, invitation)

  assert.equal(result.reference, 'Q-12345678')
  assert.equal(result.customer.tier, 'GOLD')
  assert.equal(result.lines[0].subtotal, 2000)
  assert.equal(result.lines[0].discountedTotal, 1543.28)
  assert.equal(result.lines[0].total, 1821.06)
  assert.deepEqual(result.pricing, {
    subtotal: 2000,
    discountedSubtotal: 1543.28,
    discount: 456.72,
    tax: 277.78,
    total: 1821.06,
    tierDiscount: 5,
    orderDiscount: 5,
    taxIncluded: true,
  })
  assert.equal(result.capabilities.canNegotiate, true)
  assert.equal('reason' in result, false)
  assert.equal('assigned_to' in result, false)
  assert.equal('product_discount' in result.lines[0], false)
})

test('customer negotiation opens only after fulfillment starts negotiation', () => {
  const approved = publicPortalQuotation(
    { ...quote, status: 'APPROVED' },
    revision,
    invitation,
  )
  const completed = publicPortalQuotation(
    { ...quote, status: 'COMPLETED' },
    revision,
    invitation,
  )

  assert.deepEqual(approved.capabilities, {
    canNegotiate: false,
    canConfirm: false,
  })
  assert.deepEqual(completed.capabilities, {
    canNegotiate: false,
    canConfirm: false,
  })
})

test('customer quotation summary exposes the latest revision without internal pricing data', () => {
  const result = publicPortalQuoteSummary({ ...quote, revision })

  assert.deepEqual(result.revision, {
    version: 2,
    negotiationId: revision.negotiation_id,
  })
  assert.equal(result.reference, 'Q-12345678')
  assert.equal(result.total, quote.selling_price)
  assert.equal(result.lineCount, 1)
  assert.equal('cost_price' in result, false)
  assert.equal('products' in result, false)
})
