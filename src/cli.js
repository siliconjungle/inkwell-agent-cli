#!/usr/bin/env node

import { readFileSync } from 'node:fs'

import { apiRequest, createRuntimeRoom, fetchRuntimeRoom } from './api-client.js'
import { loadCliConfig, normalizeString } from './env.js'
import { RoomSession } from './room-session.js'

function pushOption(options, key, value) {
  if (!(key in options)) {
    options[key] = value
    return
  }
  if (Array.isArray(options[key])) {
    options[key].push(value)
    return
  }
  options[key] = [options[key], value]
}

function parseArgs(argv = []) {
  const positionals = []
  const options = {}
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]
    if (token === '--') {
      positionals.push(...argv.slice(index + 1))
      break
    }
    if (!token.startsWith('--')) {
      positionals.push(token)
      continue
    }
    const raw = token.slice(2)
    if (!raw) continue
    if (raw.includes('=')) {
      const [key, ...rest] = raw.split('=')
      pushOption(options, key, rest.join('='))
      continue
    }
    const next = argv[index + 1]
    if (next && !next.startsWith('--')) {
      pushOption(options, raw, next)
      index += 1
      continue
    }
    pushOption(options, raw, true)
  }
  return { positionals, options }
}

function getOption(options, key, fallback = '') {
  const value = options[key]
  if (Array.isArray(value)) return value[value.length - 1] ?? fallback
  return value ?? fallback
}

function getOptionList(options, key) {
  const value = options[key]
  if (Array.isArray(value)) return value
  if (value == null || value === false) return []
  return [value]
}

function parseHeaderList(values = []) {
  const headers = {}
  for (const raw of values) {
    const value = String(raw || '')
    const separator = value.indexOf(':')
    if (separator <= 0) continue
    const key = value.slice(0, separator).trim()
    const headerValue = value.slice(separator + 1).trim()
    if (!key) continue
    headers[key] = headerValue
  }
  return headers
}

function parseJsonInput(raw, label = 'JSON') {
  try {
    return JSON.parse(String(raw))
  } catch (error) {
    throw new Error(`Invalid ${label}: ${error?.message || error}`)
  }
}

function printHelp() {
  process.stdout.write([
    'inkwell-api-cli',
    '',
    'Usage:',
    '  avatar get [--user-id <id>]',
    '  avatar set --entity-id <id>',
    '  avatar clear',
    '  request [METHOD] <path> [--body-json <json>] [--body-file <path>] [--header "Name: Value"]',
    '  room create --published-world-id <id>',
    '  room info --room-id <id>',
    '  room presence --room-id <id>',
    '  room history --room-id <id> [--limit <n>]',
    '  room connect --room-id <id> [--selection <world-default|profile-avatar|none>] [--enter]',
    '',
    'Identity overrides:',
    '  --user-id <id> --username <name> --email <email> --role <role>',
    '',
    'Connection overrides:',
    '  --api-base <url> --ws-base <url> --bearer <token> --jwt-secret <secret> --jwt-issuer <issuer>',
  ].join('\n') + '\n')
}

function buildConfig(options) {
  return loadCliConfig({
    projectDir: process.cwd(),
    overrides: {
      apiBase: getOption(options, 'api-base'),
      wsBase: getOption(options, 'ws-base'),
      bearerToken: getOption(options, 'bearer'),
      backendJwtSecret: getOption(options, 'jwt-secret'),
      jwtIssuer: getOption(options, 'jwt-issuer'),
      userId: getOption(options, 'user-id'),
      username: getOption(options, 'username'),
      email: getOption(options, 'email'),
      role: getOption(options, 'role'),
      stateDir: getOption(options, 'state-dir'),
      defaultSelection: getOption(options, 'selection-default'),
    },
  })
}

async function handleRequest(positionals, options) {
  const config = buildConfig(options)
  let method = 'GET'
  let path = positionals[1] || ''
  if (positionals[2]) {
    method = positionals[1]
    path = positionals[2]
  }
  if (!path) throw new Error('request path is required')

  let body = null
  const bodyFile = normalizeString(getOption(options, 'body-file'), { max: 4096 })
  if (bodyFile) {
    body = parseJsonInput(readFileSync(bodyFile, 'utf8'), 'body file JSON')
  }
  const bodyJson = getOption(options, 'body-json')
  if (bodyJson) {
    body = parseJsonInput(bodyJson, 'body JSON')
  }
  const bodyRaw = getOption(options, 'body')
  if (bodyRaw) {
    body = String(bodyRaw)
  }

  const response = await apiRequest(config, {
    method,
    path,
    body,
    headers: parseHeaderList(getOptionList(options, 'header')),
    bearerToken: getOption(options, 'bearer'),
  })

  if (response.text && response.payload && Object.keys(response.payload).length) {
    process.stdout.write(`${JSON.stringify(response.payload, null, 2)}\n`)
    return
  }
  process.stdout.write(`${response.text}\n`)
}

async function withSnapshotSession(config, roomId, callback) {
  const session = new RoomSession({
    config,
    roomId,
    logEvents: false,
  })
  try {
    await session.connect({ selectionId: 'none' })
    await callback(session)
  } finally {
    await session.close().catch(() => {})
  }
}

async function handleRoomCommand(positionals, options) {
  const subcommand = positionals[1] || ''
  if (!subcommand || subcommand === 'help' || getOption(options, 'help', false) === true) {
    printHelp()
    return
  }
  const config = buildConfig(options)
  if (subcommand === 'create') {
    const publishedWorldId = getOption(options, 'published-world-id') || positionals[2]
    const item = await createRuntimeRoom(config, publishedWorldId)
    process.stdout.write(`${JSON.stringify(item, null, 2)}\n`)
    return
  }

  const roomId = getOption(options, 'room-id') || positionals[2]
  if (!roomId) throw new Error('room id is required')

  if (subcommand === 'info') {
    const item = await fetchRuntimeRoom(config, roomId)
    process.stdout.write(`${JSON.stringify(item, null, 2)}\n`)
    return
  }

  if (subcommand === 'presence') {
    await withSnapshotSession(config, roomId, async (session) => {
      session.printPresence()
    })
    return
  }

  if (subcommand === 'history') {
    const rawLimit = getOption(options, 'limit')
    const limit = Number(rawLimit)
    await withSnapshotSession(config, roomId, async (session) => {
      session.printHistory({ limit: Number.isFinite(limit) ? limit : 0 })
    })
    return
  }

  if (subcommand === 'connect') {
    const session = new RoomSession({
      config,
      roomId,
      logEvents: true,
    })
    const selection = getOption(options, 'selection') || config.defaultSelection
    const enter = options.enter === true || getOption(options, 'enter') === 'true'
    await session.connect({ selectionId: selection, enter })
    await session.runInteractive()
    return
  }

  throw new Error(`Unknown room subcommand: ${subcommand}`)
}

async function handleAvatarCommand(positionals, options) {
  const subcommand = positionals[1] || ''
  if (!subcommand || subcommand === 'help' || getOption(options, 'help', false) === true) {
    printHelp()
    return
  }

  const config = buildConfig(options)

  if (subcommand === 'get') {
    const userId = getOption(options, 'user-id') || config.identity.userId
    const response = await apiRequest(config, {
      method: 'GET',
      path: `/users/${encodeURIComponent(userId)}/avatar`,
    })
    process.stdout.write(`${JSON.stringify(response.payload, null, 2)}\n`)
    return
  }

  if (subcommand === 'set') {
    const entityId = getOption(options, 'entity-id') || positionals[2]
    if (!entityId) throw new Error('entity id is required')
    const response = await apiRequest(config, {
      method: 'POST',
      path: '/me/avatar',
      body: {
        characterId: entityId,
      },
    })
    process.stdout.write(`${JSON.stringify(response.payload, null, 2)}\n`)
    return
  }

  if (subcommand === 'clear') {
    const response = await apiRequest(config, {
      method: 'POST',
      path: '/me/avatar',
      body: {
        characterId: null,
      },
    })
    process.stdout.write(`${JSON.stringify(response.payload, null, 2)}\n`)
    return
  }

  throw new Error(`Unknown avatar subcommand: ${subcommand}`)
}

async function main(argv = process.argv.slice(2)) {
  const { positionals, options } = parseArgs(argv)
  const command = positionals[0] || 'help'
  if (command === 'help' || command === '--help' || command === '-h') {
    printHelp()
    return
  }
  if (command === 'request') {
    await handleRequest(positionals, options)
    return
  }
  if (command === 'avatar') {
    await handleAvatarCommand(positionals, options)
    return
  }
  if (command === 'room') {
    await handleRoomCommand(positionals, options)
    return
  }
  throw new Error(`Unknown command: ${command}`)
}

main().catch((error) => {
  process.stderr.write(`${error?.message || error}\n`)
  process.exitCode = 1
})
