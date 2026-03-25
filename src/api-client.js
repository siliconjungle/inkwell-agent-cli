import { normalizeString } from './env.js'
import { fetchImpl } from './fetch.js'

function extractPayload(payload) {
  return payload?.data ?? payload?.value ?? payload ?? {}
}

function resolveApiErrorMessage(payload, status) {
  if (typeof payload?.error === 'string' && payload.error.trim()) return payload.error.trim()
  if (typeof payload?.message === 'string' && payload.message.trim()) return payload.message.trim()
  if (typeof payload?.error?.message === 'string' && payload.error.message.trim()) return payload.error.message.trim()
  return `HTTP ${status}`
}

export function resolveRequestUrl(apiBase, path = '/') {
  const normalizedPath = normalizeString(path, { max: 4096 })
  if (/^https?:\/\//iu.test(normalizedPath)) return normalizedPath
  const base = normalizeString(apiBase, { max: 2048 }).replace(/\/+$/u, '')
  const suffix = normalizedPath.startsWith('/') ? normalizedPath : `/${normalizedPath}`
  return `${base}${suffix}`
}

export function resolveAppUrl(appBase, path = '/') {
  const normalizedPath = normalizeString(path, { max: 4096 })
  if (/^https?:\/\//iu.test(normalizedPath)) return normalizedPath
  const base = normalizeString(appBase, { max: 2048 }).replace(/\/+$/u, '')
  const suffix = normalizedPath.startsWith('/') ? normalizedPath : `/${normalizedPath}`
  return `${base}${suffix}`
}

export function resolveRuntimeWsUrl(wsBase, roomId, token) {
  const normalizedBase = normalizeString(wsBase, { max: 2048 }).replace(/\/+$/u, '')
  const protocolBase = normalizedBase
    .replace(/^http:/iu, 'ws:')
    .replace(/^https:/iu, 'wss:')
  return `${protocolBase}/ws?roomId=${encodeURIComponent(roomId)}&token=${encodeURIComponent(token)}`
}

export async function apiRequest(config, {
  method = 'GET',
  path = '/',
  body = null,
  headers = {},
  bearerToken = '',
} = {}) {
  const normalizedMethod = normalizeString(method, { max: 16 }).toUpperCase() || 'GET'
  const normalizedBearer = normalizeString(bearerToken || config?.bearerToken, { max: 8192 })
  const url = resolveRequestUrl(config?.apiBase, path)
  const requestHeaders = {
    accept: 'application/json',
    ...headers,
  }
  if (normalizedBearer) {
    requestHeaders.authorization = `Bearer ${normalizedBearer}`
  }

  let requestBody = body
  if (body != null && typeof body === 'object' && !(body instanceof Uint8Array) && !(body instanceof ArrayBuffer)) {
    requestHeaders['content-type'] = requestHeaders['content-type'] || 'application/json'
    requestBody = JSON.stringify(body)
  }

  const response = await fetchImpl(url, {
    method: normalizedMethod,
    headers: requestHeaders,
    body: requestBody == null ? undefined : requestBody,
  })
  const text = await response.text()
  let payload = {}
  try {
    payload = text ? JSON.parse(text) : {}
  } catch {
    payload = {}
  }
  if (!response.ok) {
    throw new Error(resolveApiErrorMessage(payload, response.status))
  }
  return {
    url,
    status: response.status,
    text,
    payload,
    data: extractPayload(payload),
  }
}

export async function fetchRuntimeRoom(config, roomId) {
  const normalizedRoomId = normalizeString(roomId, { max: 160 })
  if (!normalizedRoomId) throw new Error('room id is required')
  const response = await apiRequest(config, {
    method: 'GET',
    path: `/inkwell/runtime/rooms/${encodeURIComponent(normalizedRoomId)}`,
  })
  return response.data?.item || response.data || null
}

export async function createRuntimeRoom(config, publishedWorldId) {
  const normalizedPublishedWorldId = normalizeString(publishedWorldId, { max: 64 })
  if (!normalizedPublishedWorldId) throw new Error('published world id is required')
  const response = await apiRequest(config, {
    method: 'POST',
    path: '/inkwell/runtime/rooms',
    body: {
      publishedWorldId: normalizedPublishedWorldId,
    },
  })
  return response.data?.item || response.data || null
}

export async function runtimeProxyRequest(config, {
  roomId = '',
  roomToken = '',
  path = '',
  method = 'GET',
  body = null,
  headers = {},
} = {}) {
  const normalizedRoomId = normalizeString(roomId, { max: 160 })
  if (!normalizedRoomId) throw new Error('room id is required')
  const normalizedRoomToken = normalizeString(roomToken, { max: 8192 })
  if (!normalizedRoomToken) throw new Error('runtime room token is required')
  const normalizedPath = normalizeString(path, { max: 4096 })
  if (!normalizedPath) throw new Error('runtime proxy path is required')

  const url = resolveAppUrl(
    config?.appBase,
    `/api/runtime/${encodeURIComponent(normalizedRoomId)}/${normalizedPath.replace(/^\/+/u, '')}`,
  )
  const requestHeaders = {
    accept: 'application/json',
    authorization: `Bearer ${normalizedRoomToken}`,
    ...headers,
  }

  let requestBody = body
  if (body != null && typeof body === 'object' && !(body instanceof Uint8Array) && !(body instanceof ArrayBuffer)) {
    requestHeaders['content-type'] = requestHeaders['content-type'] || 'application/json'
    requestBody = JSON.stringify(body)
  }

  const response = await fetchImpl(url, {
    method: normalizeString(method, { max: 16 }).toUpperCase() || 'GET',
    headers: requestHeaders,
    body: requestBody == null ? undefined : requestBody,
  })
  const text = await response.text()
  let payload = {}
  try {
    payload = text ? JSON.parse(text) : {}
  } catch {
    payload = {}
  }
  if (!response.ok) {
    throw new Error(resolveApiErrorMessage(payload, response.status))
  }
  return {
    url,
    status: response.status,
    text,
    payload,
    data: extractPayload(payload),
  }
}

export async function fetchRuntimePublishedWorld(config, {
  roomId = '',
  roomToken = '',
  publishedWorldId = '',
} = {}) {
  const normalizedPublishedWorldId = normalizeString(publishedWorldId, { max: 64 })
  if (!normalizedPublishedWorldId) throw new Error('published world id is required')
  const response = await runtimeProxyRequest(config, {
    roomId,
    roomToken,
    path: `inkwell/worlds/published/${encodeURIComponent(normalizedPublishedWorldId)}`,
  })
  return response.data?.item || response.data || null
}
