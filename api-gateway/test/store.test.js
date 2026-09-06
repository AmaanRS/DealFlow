import assert from 'node:assert/strict'
import { after, test } from 'node:test'

await import('../src/config.js')
const { callStoreService, default: storeRoutes } = await import(
  '../src/routes/store.js'
)
const { shutdownObservability } = await import('@app/observability')

after(() => shutdownObservability())

test('store list endpoint is registered', () => {
  const paths = storeRoutes.stack
    .filter((layer) => layer.route?.methods.get)
    .map((layer) => layer.route.path)

  assert.deepEqual(paths, ['/get_stores'])
})

test('admin store creation endpoint is registered', () => {
  const paths = storeRoutes.stack
    .filter((layer) => layer.route?.methods.post)
    .map((layer) => layer.route.path)

  assert.deepEqual(paths, ['/create_store'])
})

test('manual store split endpoint is registered as PATCH', () => {
  const paths = storeRoutes.stack
    .filter((layer) => layer.route?.methods.patch)
    .map((layer) => layer.route.path)

  assert.deepEqual(paths, ['/manual_store_split'])
})

test('manual store assignments are forwarded to Night Sky as PATCH JSON', async () => {
  let request
  const payload = {
    quote_id: '507f1f77bcf86cd799439011',
    stores: [
      {
        article_id: '507f191e810c19729de860ea',
        store_id: '507f191e810c19729de860eb',
      },
    ],
  }

  const result = await callStoreService(
    { query: {}, requestId: 'request-1' },
    '/store/manual_store_split',
    {
      method: 'PATCH',
      body: payload,
      fetchImpl: async (url, options) => {
        request = { url: String(url), options }
        return {
          status: 200,
          json: async () => ({ quote: { _id: payload.quote_id } }),
        }
      },
    },
  )

  assert.equal(
    request.url,
    'http://night_sky:3001/store/manual_store_split',
  )
  assert.equal(request.options.method, 'PATCH')
  assert.equal(request.options.headers['Content-Type'], 'application/json')
  assert.deepEqual(JSON.parse(request.options.body), payload)
  assert.equal(result.status, 200)
})
