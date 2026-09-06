import assert from 'node:assert/strict'
import { after, test } from 'node:test'

await import('../src/config.js')
const {
  canReadCustomerInvoice,
  default: customerRoutes,
  publicCustomer,
} = await import('../src/routes/customer.js')
const { shutdownObservability } = await import('@app/observability')

after(() => shutdownObservability())

test('customer list and detail endpoints are registered', () => {
  const paths = customerRoutes.stack
    .filter((layer) => layer.route?.methods.get)
    .map((layer) => layer.route.path)

  assert.deepEqual(paths, ['/:quote_id/invoice', '/get_customers', '/:user_id'])
})

test('customer quotation confirmation endpoint is registered', () => {
  const route = customerRoutes.stack.find(
    (layer) => layer.route?.path === '/confirm_quote',
  )?.route

  assert.equal(route?.methods.post, true)
})

test('invoice access follows quote ownership and privileged reader roles', () => {
  const customerId = '507f1f77bcf86cd799439011'
  const quote = {
    customer: { _id: customerId },
    created_by: 'owner@example.com',
  }

  assert.equal(
    canReadCustomerInvoice(
      { _id: customerId, role: 'CUSTOMER', email: 'customer@example.com' },
      quote,
    ),
    true,
  )
  assert.equal(
    canReadCustomerInvoice(
      {
        _id: '507f1f77bcf86cd799439012',
        role: 'CUSTOMER',
        email: 'other@example.com',
      },
      quote,
    ),
    false,
  )
  assert.equal(
    canReadCustomerInvoice(
      { role: 'SALES_REP', email: 'owner@example.com' },
      quote,
    ),
    true,
  )
  assert.equal(
    canReadCustomerInvoice(
      { role: 'SALES_REP', email: 'another@example.com' },
      quote,
    ),
    false,
  )
  assert.equal(
    canReadCustomerInvoice(
      { role: 'FINANCE', email: 'finance@example.com' },
      quote,
    ),
    true,
  )
})

test('public customer data excludes authentication fields', () => {
  const result = publicCustomer({
    _id: '507f1f77bcf86cd799439011',
    fullName: 'Customer One',
    email: 'customer@example.com',
    passwordHash: 'must-not-leak',
    _custom_json: {
      tier: 'BRONZE',
      total_price: 2500,
      delivery_address: '1 Example Street',
      lat: 19.07,
      long: 72.87,
    },
  })

  assert.equal(result.id, '507f1f77bcf86cd799439011')
  assert.equal(result.tier, 'BRONZE')
  assert.equal(result.totalPrice, 2500)
  assert.equal('passwordHash' in result, false)
})
