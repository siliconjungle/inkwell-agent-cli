import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve as resolvePath } from 'node:path'

const DEFAULT_API_BASE = 'http://localhost:4000'
const DEFAULT_JWT_ISSUER = 'inkwell.app'
const DEFAULT_RUNTIME_ROOM_AUDIENCE = 'inkwell-runtime-room'

export function normalizeString(value, { max = 512 } = {}) {
  if (typeof value !== 'string') return ''
  return value.trim().slice(0, max)
}

function normalizeRole(value) {
  const raw = normalizeString(value, { max: 32 }).toLowerCase()
  if (raw === 'admin' || raw === 'demigod') return raw
  return 'admin'
}

function stripInlineComment(value) {
  if (!value) return ''
  let quote = ''
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index]
    const previous = value[index - 1]
    if ((char === '"' || char === '\'') && previous !== '\\') {
      if (!quote) {
        quote = char
      } else if (quote === char) {
        quote = ''
      }
      continue
    }
    if (!quote && char === '#' && /\s/.test(value[index - 1] || '')) {
      return value.slice(0, index).trim()
    }
  }
  return value.trim()
}

export function parseDotenv(text = '') {
  const parsed = {}
  for (const rawLine of String(text || '').split(/\r?\n/u)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const equalsIndex = line.indexOf('=')
    if (equalsIndex <= 0) continue
    const key = line.slice(0, equalsIndex).trim()
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(key)) continue
    let value = line.slice(equalsIndex + 1).trim()
    if (!value) {
      parsed[key] = ''
      continue
    }
    if (
      (value.startsWith('"') && value.endsWith('"'))
      || (value.startsWith('\'') && value.endsWith('\''))
    ) {
      const quote = value[0]
      value = value.slice(1, -1)
      if (quote === '"') {
        value = value
          .replace(/\\n/gu, '\n')
          .replace(/\\r/gu, '\r')
          .replace(/\\t/gu, '\t')
          .replace(/\\"/gu, '"')
          .replace(/\\\\/gu, '\\')
      }
    } else {
      value = stripInlineComment(value)
    }
    parsed[key] = value
  }
  return parsed
}

function readDotenvFile(path) {
  if (!existsSync(path)) return null
  return parseDotenv(readFileSync(path, 'utf8'))
}

function normalizeBaseUrl(value, fallback = DEFAULT_API_BASE) {
  const normalized = normalizeString(value, { max: 2048 })
  return (normalized || fallback).replace(/\/+$/u, '')
}

function sanitizeToken(value, fallback = 'default') {
  const normalized = normalizeString(value, { max: 120 }).toLowerCase()
  const sanitized = normalized.replace(/[^a-z0-9._-]+/gu, '-').replace(/^-+|-+$/gu, '')
  return sanitized || fallback
}

export function loadCliConfig({
  projectDir = process.cwd(),
  env = process.env,
  overrides = {},
} = {}) {
  const resolvedProjectDir = resolvePath(projectDir)
  const frontendDir = resolvePath(resolvedProjectDir, '..', 'inkwell-api-frontend')
  const backendDir = resolvePath(resolvedProjectDir, '..', 'inkwell-api-backend')
  const envFileCandidates = [
    resolvePath(backendDir, '.env'),
    resolvePath(backendDir, '.env.local'),
    resolvePath(frontendDir, '.env'),
    resolvePath(frontendDir, '.env.local'),
    resolvePath(resolvedProjectDir, '.env'),
    resolvePath(resolvedProjectDir, '.env.local'),
  ]

  const mergedFromFiles = {}
  const loadedFiles = []
  for (const envPath of envFileCandidates) {
    const parsed = readDotenvFile(envPath)
    if (!parsed) continue
    Object.assign(mergedFromFiles, parsed)
    loadedFiles.push(envPath)
  }

  const merged = {
    ...mergedFromFiles,
    ...env,
  }

  const apiBase = normalizeBaseUrl(
    overrides.apiBase
    || merged.INKWELL_API_BASE
    || merged.NEXT_PUBLIC_INKWELL_RUNTIME_BASE_URL
    || merged.NEXT_PUBLIC_API_BASE,
    DEFAULT_API_BASE,
  )
  const wsBase = normalizeBaseUrl(
    overrides.wsBase
    || merged.INKWELL_RUNTIME_WS_BASE
    || apiBase,
    apiBase,
  )
  const stateDir = resolvePath(
    normalizeString(overrides.stateDir || merged.INKWELL_API_CLI_STATE_DIR, { max: 4096 })
      || resolvePath(resolvedProjectDir, '.local'),
  )

  return Object.freeze({
    projectDir: resolvedProjectDir,
    loadedFiles,
    rawEnv: merged,
    apiBase,
    wsBase,
    bearerToken: normalizeString(overrides.bearerToken || merged.INKWELL_API_BEARER_TOKEN, { max: 8192 }),
    backendJwtSecret: normalizeString(overrides.backendJwtSecret || merged.BACKEND_JWT_SECRET, { max: 2048 }),
    jwtIssuer: normalizeString(overrides.jwtIssuer || merged.JWT_ISSUER, { max: 120 }) || DEFAULT_JWT_ISSUER,
    runtimeRoomAudience: DEFAULT_RUNTIME_ROOM_AUDIENCE,
    identity: Object.freeze({
      userId: normalizeString(overrides.userId || merged.INKWELL_AI_DEV_USER_ID, { max: 120 }) || 'ai-dev-user',
      username: normalizeString(overrides.username || merged.INKWELL_AI_DEV_USERNAME, { max: 120 }) || 'inkwell',
      email: normalizeString(overrides.email || merged.INKWELL_AI_DEV_EMAIL, { max: 320 }) || 'ai-dev@localhost',
      role: normalizeRole(overrides.role || merged.INKWELL_AI_DEV_ROLE),
    }),
    defaultSelection: normalizeString(overrides.defaultSelection || merged.INKWELL_API_CLI_DEFAULT_SELECTION, { max: 120 }) || 'world-default',
    stateDir,
  })
}

export function ensureStateDir(config) {
  mkdirSync(config.stateDir, { recursive: true })
  return config.stateDir
}

export function resolveClientInstanceId(config, {
  userId = '',
} = {}) {
  ensureStateDir(config)
  const identityToken = sanitizeToken(userId || config?.identity?.userId, 'default')
  const path = resolvePath(config.stateDir, `client-instance-${identityToken}.txt`)
  if (existsSync(path)) {
    const existing = normalizeString(readFileSync(path, 'utf8'), { max: 120 })
    if (existing) return existing
  }
  const generated = `inkwell-cli-${randomUUID()}`
  writeFileSync(path, `${generated}\n`, 'utf8')
  return generated
}
