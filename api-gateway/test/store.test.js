import assert from 'node:assert/strict'
import { after, test } from 'node:test'

await import('../src/config.js')
const { default: storeRoutes } = await import('../src/routes/store.js')
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
