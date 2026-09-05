import assert from 'node:assert/strict'
import { after, test } from 'node:test'

// Loading the API gateway configuration first populates the OpenTelemetry
// environment variables from api-gateway/.env before telemetry starts.
await import('../src/config.js')

const {
  errorLogAttributes,
  requestLogContext,
  safeLogAttributes,
} = await import('../src/telemetry.js')
const { shutdownObservability } = await import('@app/observability')

after(() => shutdownObservability())

test('safeLogAttributes drops sensitive and non-primitive context', () => {
  const attributes = safeLogAttributes({
    'event.name': 'auth.login.completed',
    'gateway.name': 'apache-apisix',
    password: 'plain-text-password',
    passwordHash: 'bcrypt-password-hash',
    'session.token': 'raw-session-token',
    'customer.email': 'customer@example.com',
    'customer.delivery_address': '1 Private Street',
    'request.body': { password: 'nested-secret' },
    'result.count': 2,
  })

  assert.deepEqual(attributes, {
    'event.name': 'auth.login.completed',
    'gateway.name': 'apache-apisix',
    'result.count': 2,
  })
})

test('errorLogAttributes redacts credentials and tokens from error text', () => {
  const sensitiveText =
    'MongoDB mongodb://dealflow:database-password@mongodb:27017/dealflow failed with Authorization: Bearer header.payload.signature token=portal-token-value'
  const error = new Error(sensitiveText)
  error.code = 'MONGO_CONNECTION_FAILED'

  const attributes = errorLogAttributes(error)

  assert.equal(attributes['error.type'], 'Error')
  assert.equal(attributes['error.code'], 'MONGO_CONNECTION_FAILED')

  for (const value of [
    attributes['exception.message'],
    attributes['exception.stacktrace'],
  ]) {
    assert.doesNotMatch(value, /database-password/)
    assert.doesNotMatch(value, /Bearer/i)
    assert.doesNotMatch(value, /header\.payload\.signature/)
    assert.doesNotMatch(value, /portal-token-value/)
    assert.match(value, /mongodb:\/\/dealflow:\[REDACTED\]@mongodb/)
    assert.match(value, /Authorization:\s*\[REDACTED\]/i)
    assert.match(value, /token=\[REDACTED\]/i)
  }
})

test('requestLogContext combines transport, route, actor, and outcome context', () => {
  const req = {
    requestId: 'gateway-request-123',
    requestIdSource: 'upstream',
    method: 'PATCH',
    originalUrl:
      '/v1/api/admin/registration-requests/507f1f77bcf86cd799439011?include=applicant',
    path: '/registration-requests/507f1f77bcf86cd799439011',
    httpVersion: '1.1',
    auth: {
      user: {
        _id: '507f191e810c19729de860ea',
        role: 'ADMIN',
      },
    },
    telemetry: {
      route: '/v1/api/admin/registration-requests/:requestId',
      attributes: {},
      spanContext: {},
    },
    get(header) {
      return header.toLowerCase() === 'user-agent' ? 'telemetry-test-agent' : undefined
    },
  }

  const attributes = requestLogContext(req, {
    'event.name': 'admin.registration.reviewed',
    'event.outcome': 'success',
  })

  assert.equal(attributes['request.id'], 'gateway-request-123')
  assert.equal(attributes['request.id_source'], 'upstream')
  assert.equal(attributes['http.request.method'], 'PATCH')
  assert.equal(
    attributes['http.route'],
    '/v1/api/admin/registration-requests/:requestId',
  )
  assert.equal(
    attributes['url.path'],
    '/v1/api/admin/registration-requests/507f1f77bcf86cd799439011',
  )
  assert.doesNotMatch(attributes['url.path'], /\?/)
  assert.equal(attributes['network.protocol.version'], '1.1')
  assert.equal(attributes['enduser.id'], '507f191e810c19729de860ea')
  assert.equal(attributes['enduser.role'], 'ADMIN')
  assert.equal(attributes['event.name'], 'admin.registration.reviewed')
  assert.equal(attributes['event.outcome'], 'success')
  assert.equal(attributes['gateway.name'], 'apache-apisix')
})
