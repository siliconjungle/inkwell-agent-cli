import { createHmac } from 'node:crypto'

import { normalizeString } from './env.js'

const RUNTIME_ROOM_KIND = 'inkwell-runtime-room'
const RUNTIME_ROOM_AUDIENCE = 'inkwell-runtime-room'

function base64urlEncode(value) {
  const input = typeof value === 'string'
    ? Buffer.from(value, 'utf8')
    : Buffer.from(value)
  return input.toString('base64url')
}

export function decodeJwt(token) {
  const normalizedToken = normalizeString(token, { max: 4096 })
  const [headerPart = '', payloadPart = '', signaturePart = ''] = normalizedToken.split('.')
  if (!headerPart || !payloadPart || !signaturePart) {
    throw new Error('invalid jwt format')
  }
  return {
    header: JSON.parse(Buffer.from(headerPart, 'base64url').toString('utf8')),
    payload: JSON.parse(Buffer.from(payloadPart, 'base64url').toString('utf8')),
    signature: signaturePart,
  }
}

export function signRuntimeRoomToken({
  roomId,
  userId,
  username = '',
  email = null,
  role = 'user',
  clientInstanceId = '',
  issuer = 'inkwell.app',
  secret = '',
  expiresInSeconds = 15 * 60,
  now = () => Date.now(),
} = {}) {
  const normalizedSecret = normalizeString(secret, { max: 4096 })
  const normalizedRoomId = normalizeString(roomId, { max: 160 })
  const normalizedUserId = normalizeString(userId, { max: 120 })
  if (!normalizedSecret) throw new Error('BACKEND_JWT_SECRET is required')
  if (!normalizedRoomId || !normalizedUserId) {
    throw new Error('room id and user id are required')
  }

  const issuedAt = Math.floor(Number(now()) / 1000)
  const payload = {
    roomId: normalizedRoomId,
    userId: normalizedUserId,
    username: normalizeString(username, { max: 120 }) || null,
    email: normalizeString(email ?? '', { max: 320 }) || null,
    role: normalizeString(role, { max: 32 }) || 'user',
    clientInstanceId: normalizeString(clientInstanceId, { max: 120 }) || null,
    kind: RUNTIME_ROOM_KIND,
    iss: normalizeString(issuer, { max: 120 }) || 'inkwell.app',
    aud: RUNTIME_ROOM_AUDIENCE,
    sub: normalizedUserId,
    iat: issuedAt,
    exp: issuedAt + Math.max(1, Number(expiresInSeconds) || 900),
  }

  const header = {
    alg: 'HS256',
    typ: 'JWT',
  }

  const encodedHeader = base64urlEncode(JSON.stringify(header))
  const encodedPayload = base64urlEncode(JSON.stringify(payload))
  const signingInput = `${encodedHeader}.${encodedPayload}`
  const signature = createHmac('sha256', normalizedSecret)
    .update(signingInput)
    .digest('base64url')
  return `${signingInput}.${signature}`
}
