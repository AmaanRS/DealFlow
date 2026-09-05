import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createOpaqueToken,
  hashPassword,
  hashToken,
  normalizeEmail,
  verifyPassword,
} from '../src/security.js'

test('email normalization is deterministic', () => {
  assert.equal(normalizeEmail('  Sales@Example.COM '), 'sales@example.com')
})

test('passwords are stored as bcrypt hashes', async () => {
  const password = 'A-secure-test-password'
  const passwordHash = await hashPassword(password)

  assert.notEqual(passwordHash, password)
  assert.equal(await verifyPassword(password, passwordHash), true)
  assert.equal(await verifyPassword('wrong-password', passwordHash), false)
})

test('opaque tokens are random and only deterministic after hashing', () => {
  const first = createOpaqueToken()
  const second = createOpaqueToken()

  assert.notEqual(first, second)
  assert.equal(hashToken(first), hashToken(first))
  assert.notEqual(hashToken(first), first)
})
