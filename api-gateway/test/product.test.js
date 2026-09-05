import assert from 'node:assert/strict'
import { after, test } from 'node:test'

await import('../src/config.js')
const { callProductService, default: productRoutes } = await import(
  '../src/routes/product.js'
)
const { shutdownObservability } = await import('@app/observability')

after(() => shutdownObservability())

test('product read endpoints are registered', () => {
  const paths = productRoutes.stack
    .filter((layer) => layer.route?.methods.get)
    .map((layer) => layer.route.path)

  assert.deepEqual(paths, ['/get_products', '/:item_id'])
})

test('admin product creation endpoints are registered', () => {
  const paths = productRoutes.stack
    .filter((layer) => layer.route?.methods.post)
    .map((layer) => layer.route.path)

  assert.deepEqual(paths, ['/create_hsn', '/create_product', '/add_inventory'])
})

test('product creation payload is forwarded to Night Sky as JSON', async () => {
  let request
  const payload = {
    name: 'Office chair',
    categories: ['HARDWARE'],
  }

  const result = await callProductService(
    { query: {}, requestId: 'request-1' },
    '/product/create_product',
    {
      method: 'POST',
      body: payload,
      fetchImpl: async (url, options) => {
        request = { url: String(url), options }
        return {
          status: 201,
          json: async () => ({ product: { _id: 'product-1' } }),
        }
      },
    },
  )

  assert.equal(request.url, 'http://night_sky:3001/product/create_product')
  assert.equal(request.options.method, 'POST')
  assert.equal(request.options.headers['Content-Type'], 'application/json')
  assert.deepEqual(JSON.parse(request.options.body), payload)
  assert.equal(result.status, 201)
})
