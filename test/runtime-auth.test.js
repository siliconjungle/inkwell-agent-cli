import assert from 'node:assert/strict'
import test from 'node:test'

import { decodeJwt, signRuntimeRoomToken } from '../src/runtime-auth.js'

test('runtime room tokens carry the claims expected by the room websocket', async () => {
  process.env.BACKEND_JWT_SECRET = 'test-secret'
  process.env.JWT_ISSUER = 'inkwell.test'
  const { verifyRuntimeRoomToken } = await import('../../inkwell-api-backend/src/runtime-rooms/runtime-room-auth.js')

  const token = signRuntimeRoomToken({
    roomId: 'runtime-123',
    userId: 'user-123',
    username: 'inkwell',
    email: 'inkwell@example.test',
    role: 'admin',
    clientInstanceId: 'cli-123',
    issuer: 'inkwell.test',
    secret: 'test-secret',
    now: () => Date.UTC(2026, 2, 25, 0, 0, 0),
  })

  const decoded = decodeJwt(token)
  const verified = await verifyRuntimeRoomToken(token)

  assert.equal(decoded.payload.kind, 'inkwell-runtime-room')
  assert.equal(decoded.payload.roomId, 'runtime-123')
  assert.equal(verified.roomId, 'runtime-123')
  assert.equal(verified.userId, 'user-123')
  assert.equal(verified.username, 'inkwell')
  assert.equal(verified.clientInstanceId, 'cli-123')
})
