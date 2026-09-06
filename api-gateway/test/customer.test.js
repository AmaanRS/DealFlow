import assert from 'node:assert/strict'
import { after, test } from 'node:test'

await import('../src/config.js')
const { default: customerRoutes, publicCustomer } = await import(
  '../src/routes/customer.js'
)
const { shutdownObservability } = await import('@app/observability')

after(() => shutdownObservability())

test('customer list and detail endpoints are registered', () => {
  const paths = customerRoutes.stack
    .filter((layer) => layer.route?.methods.get)
    .map((layer) => layer.route.path)

  assert.deepEqual(paths, ['/get_customers', '/:user_id'])
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
