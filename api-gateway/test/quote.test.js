import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { USER_ROLES } from '@app/models/constants'

await import('../src/config.js')
const { appendQuery, buildCreateQuotationBody, default: quoteRoutes } = await import(
  '../src/routes/quote.js'
)
const { shutdownObservability } = await import('@app/observability')

after(() => shutdownObservability())

test('quotation read endpoints are registered on the gateway', () => {
  const paths = quoteRoutes.stack
    .filter((layer) => layer.route?.methods.get)
    .map((layer) => layer.route.path)

  assert.deepEqual(paths, [
    '/get_quotes',
    '/approved_quotes',
    '/:quote_id',
  ])
})

test('sales quotation creation is registered on the gateway', () => {
  const route = quoteRoutes.stack.find(
    (layer) => layer.route?.path === '/new_quotation',
  )?.route

  assert.equal(route?.methods.post, true)
})

test('quotation creation trusts session ownership and gateway reviewer assignment', () => {
  const body = buildCreateQuotationBody(
    {
      customer: '507f1f77bcf86cd799439011',
      products: [],
      created_by: 'forged@example.com',
      assigned_to: 'forged@example.com',
      approved_by: 'forged@example.com',
      status: 'APPROVED',
    },
    { email: 'sales@example.com' },
    { email: 'manager@example.com' },
  )

  assert.equal(body.created_by, 'sales@example.com')
  assert.equal(body.assigned_to, 'manager@example.com')
  assert.equal(body.approved_by, null)
  assert.equal(body.status, 'PENDING_APPROVAL')
})

test('sales representatives can only list quotations they created', () => {
  const url = new URL('http://morning_star:3002/quote/get_quotes')

  appendQuery(
    url,
    { status: 'DRAFT', created_by: 'another@example.com' },
    { role: USER_ROLES.SALES_REP, email: 'owner@example.com' },
  )

  assert.equal(url.searchParams.get('status'), 'DRAFT')
  assert.equal(url.searchParams.get('created_by'), 'owner@example.com')
})

test('managers retain supported quotation filters', () => {
  const url = new URL('http://morning_star:3002/quote/get_quotes')

  appendQuery(
    url,
    { status: ['DRAFT', 'PENDING_APPROVAL'], page: '2' },
    { role: USER_ROLES.MANAGER, email: 'manager@example.com' },
  )

  assert.deepEqual(url.searchParams.getAll('status'), [
    'DRAFT',
    'PENDING_APPROVAL',
  ])
  assert.equal(url.searchParams.get('page'), '2')
  assert.equal(url.searchParams.has('created_by'), false)
})
