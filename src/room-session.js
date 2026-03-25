import { randomUUID } from 'node:crypto'
import readline from 'node:readline'

import WebSocket from 'ws'

import { resolveRuntimeWsUrl } from './api-client.js'
import { normalizeString, resolveClientInstanceId } from './env.js'
import { createRoomState, applyRoomMessage, getChatHistory, getPresenceList, roomStateToJson } from './room-state.js'
import { signRuntimeRoomToken } from './runtime-auth.js'

function formatTimestamp(value) {
  const date = value ? new Date(value) : new Date()
  if (Number.isNaN(date.getTime())) return 'time?'
  return date.toISOString().slice(11, 19)
}

function parseIncomingMessage(raw) {
  try {
    return JSON.parse(String(raw))
  } catch {
    return null
  }
}

function buildSelectionPayload(selectionId, identity = {}) {
  const normalizedSelectionId = normalizeString(selectionId, { max: 120 })
  if (!normalizedSelectionId || normalizedSelectionId === 'none') return null
  if (normalizedSelectionId === 'profile-avatar') {
    return {
      selectedCharacterId: 'profile-avatar',
      selectedCharacterLabel: normalizeString(identity.username, { max: 120 }) || 'Your avatar',
      selectedCharacterCaption: 'From your profile',
      selectedCharacterPortraitUrl: '',
    }
  }
  return {
    selectedCharacterId: normalizedSelectionId,
    selectedCharacterLabel: normalizedSelectionId === 'world-default'
      ? 'World default'
      : normalizedSelectionId,
    selectedCharacterCaption: normalizedSelectionId === 'world-default' ? 'World default' : '',
    selectedCharacterPortraitUrl: '',
  }
}

export class RoomSession {
  constructor({
    config,
    roomId,
    stdout = process.stdout,
    stderr = process.stderr,
    logEvents = true,
    openSocket = (url) => new WebSocket(url),
  } = {}) {
    this.config = config
    this.roomId = normalizeString(roomId, { max: 160 })
    this.stdout = stdout
    this.stderr = stderr
    this.logEvents = logEvents
    this.openSocket = openSocket
    this.state = createRoomState()
    this.socket = null
    this.readline = null
    this.connected = false
    this.closed = false
    this.clientInstanceId = ''
  }

  write(line = '') {
    if (!this.logEvents) return
    this.stdout.write(`${line}\n`)
    this.readline?.prompt(true)
  }

  writeError(line = '') {
    this.stderr.write(`${line}\n`)
    this.readline?.prompt(true)
  }

  getSelfPresence() {
    const selfUserId = this.state.self?.userId || ''
    if (!selfUserId) return null
    return this.state.membersByUserId.get(selfUserId) || null
  }

  isEntered() {
    return this.getSelfPresence()?.hasEntered === true
  }

  async connect({
    selectionId = '',
    clientInstanceId = '',
    enter = false,
  } = {}) {
    if (!this.roomId) throw new Error('room id is required')
    this.clientInstanceId = normalizeString(clientInstanceId, { max: 120 })
      || resolveClientInstanceId(this.config, { userId: this.config.identity.userId })
    const token = signRuntimeRoomToken({
      roomId: this.roomId,
      userId: this.config.identity.userId,
      username: this.config.identity.username,
      email: this.config.identity.email,
      role: this.config.identity.role,
      clientInstanceId: this.clientInstanceId,
      issuer: this.config.jwtIssuer,
      secret: this.config.backendJwtSecret,
    })
    const websocketUrl = resolveRuntimeWsUrl(this.config.wsBase, this.roomId, token)
    const pendingSelection = buildSelectionPayload(selectionId, this.config.identity)
    const shouldEnter = enter === true

    await new Promise((resolve, reject) => {
      let settled = false
      const socket = this.openSocket(websocketUrl)
      this.socket = socket
      const settleResolve = () => {
        if (settled) return
        settled = true
        resolve()
      }
      const settleReject = (error) => {
        if (settled) return
        settled = true
        reject(error)
      }

      socket.once('open', () => {
        this.connected = true
        this.closed = false
        this.write(`[${formatTimestamp()}] connected to ${this.roomId} as ${this.config.identity.username}`)
      })

      socket.on('message', async (buffer) => {
        const message = parseIncomingMessage(buffer)
        if (!message) return
        applyRoomMessage(this.state, message)
        this.handleMessage(message)
        if (message.type === 'room.snapshot') {
          if (pendingSelection) {
            this.send({
              type: 'play.selection',
              selection: pendingSelection,
            })
          }
          if (shouldEnter) {
            this.send({
              type: 'play.enter',
            })
          }
          settleResolve()
        }
        if (message.type === 'connection.rejected') {
          settleReject(new Error(message.reason || 'connection rejected'))
        }
      })

      socket.once('error', (error) => {
        settleReject(error instanceof Error ? error : new Error(String(error)))
      })

      socket.once('close', (code, reasonBuffer) => {
        const reason = Buffer.isBuffer(reasonBuffer)
          ? reasonBuffer.toString('utf8')
          : String(reasonBuffer || '')
        this.connected = false
        this.closed = true
        if (!settled) {
          settleReject(new Error(`socket closed (${code}${reason ? `: ${reason}` : ''})`))
          return
        }
        if (!this.logEvents) return
        this.write(`[${formatTimestamp()}] connection closed (${code}${reason ? `: ${reason}` : ''})`)
      })
    })
  }

  handleMessage(message) {
    if (!this.logEvents || !message || typeof message !== 'object') return
    if (message.type === 'room.snapshot') {
      const roomName = normalizeString(this.state.room?.worldName, { max: 160 }) || 'Untitled world'
      const members = getPresenceList(this.state).length
      const chat = getChatHistory(this.state).length
      this.write(`[${formatTimestamp()}] room snapshot: ${roomName} | ${members} online | ${chat} chat messages`)
      return
    }
    if (message.type === 'presence.joined') {
      this.write(`[${formatTimestamp()}] joined: ${message.user?.username || 'Player'}`)
      return
    }
    if (message.type === 'presence.entered') {
      this.write(`[${formatTimestamp(message.user?.enteredAt)}] entered: ${message.user?.username || 'Player'}`)
      return
    }
    if (message.type === 'presence.exited') {
      this.write(`[${formatTimestamp()}] exited: ${message.user?.username || 'Player'}`)
      return
    }
    if (message.type === 'presence.left') {
      this.write(`[${formatTimestamp()}] left: ${message.user?.username || 'Player'}${message.reason ? ` (${message.reason})` : ''}`)
      return
    }
    if (message.type === 'presence.selection') {
      this.write(
        `[${formatTimestamp(message.user?.selectedCharacterUpdatedAt)}] selection: ${message.user?.username || 'Player'} -> ${message.user?.selectedCharacterLabel || message.user?.selectedCharacterId || 'character'}`,
      )
      return
    }
    if (message.type === 'chat.message') {
      this.write(`[${formatTimestamp(message.message?.createdAt)}] ${message.message?.username || 'Player'}: ${message.message?.text || ''}`)
      return
    }
    if (message.type === 'chat.pong') {
      this.write(`[${formatTimestamp(message.at)}] pong`)
      return
    }
    if (message.type === 'chat.rejected') {
      this.writeError(message.message || 'Chat rejected.')
      return
    }
    if (message.type === 'room.restart') {
      this.write(`[${formatTimestamp(message.requestedAt)}] room restart: ${message.reason || 'host-restarted'}`)
      return
    }
    if (message.type === 'room.closed') {
      this.write(`[${formatTimestamp()}] room closed: ${message.reason || 'room-closed'}`)
    }
  }

  send(payload) {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      throw new Error('room socket is not connected')
    }
    this.socket.send(JSON.stringify(payload))
  }

  sendChat(text) {
    if (!this.isEntered()) {
      throw new Error('Enter the room before chatting.')
    }
    const normalizedText = normalizeString(text, { max: 500 })
    if (!normalizedText) throw new Error('chat text is required')
    this.send({
      type: 'chat.send',
      text: normalizedText,
      clientMessageId: `cli-${randomUUID()}`,
    })
  }

  sendSelection(selectionId) {
    const payload = buildSelectionPayload(selectionId, this.config.identity)
    if (!payload) throw new Error('selection id is required')
    this.send({
      type: 'play.selection',
      selection: payload,
    })
  }

  sendEnter() {
    this.send({
      type: 'play.enter',
    })
  }

  sendExit() {
    this.send({
      type: 'play.exit',
    })
  }

  printPresence() {
    const members = getPresenceList(this.state)
    if (!members.length) {
      this.stdout.write('No members are currently in the room.\n')
      return
    }
    this.stdout.write('Presence:\n')
    for (const member of members) {
      const isSelf = member.userId === this.state.self?.userId
      const selection = member.selectedCharacterLabel || member.selectedCharacterId || 'no selection'
      const entryState = member.hasEntered ? 'entered' : 'not entered'
      this.stdout.write(
        `- ${member.username} (${member.userId})${isSelf ? ' [self]' : ''} | ${selection} | ${entryState}\n`,
      )
    }
  }

  printHistory({ limit = 0 } = {}) {
    const history = getChatHistory(this.state, { limit })
    if (!history.length) {
      this.stdout.write('No chat history is available for this room.\n')
      return
    }
    this.stdout.write('Chat history:\n')
    for (const entry of history) {
      this.stdout.write(`- [${formatTimestamp(entry.createdAt)}] ${entry.username}: ${entry.text}\n`)
    }
  }

  printSnapshot() {
    this.stdout.write(`${JSON.stringify(roomStateToJson(this.state), null, 2)}\n`)
  }

  async runInteractive() {
    if (!this.connected) throw new Error('room session is not connected')
    this.stdout.write('Interactive room session. Plain text sends chat. Use /help for commands.\n')
    await new Promise((resolve) => {
      const rl = readline.createInterface({
        input: process.stdin,
        output: this.stdout,
        prompt: 'room> ',
      })
      this.readline = rl
      rl.prompt()
      rl.on('line', async (input) => {
        try {
          const keepOpen = await this.handleInteractiveLine(input)
          if (!keepOpen) {
            resolve()
            return
          }
          rl.prompt()
        } catch (error) {
          this.writeError(error?.message || String(error))
          rl.prompt()
        }
      })
      rl.on('close', () => {
        resolve()
      })

      const closeHandler = () => {
        void this.close()
        rl.close()
      }
      process.once('SIGINT', closeHandler)
      process.once('SIGTERM', closeHandler)
    })
  }

  async handleInteractiveLine(input) {
    const line = String(input || '').trim()
    if (!line) return true
    if (line === '/help') {
      this.stdout.write([
        'Commands:',
        '- plain text: send chat',
        '- /enter',
        '- /exit',
        '- /presence',
        '- /history [limit]',
        '- /select <world-default|profile-avatar>',
        '- /snapshot',
        '- /ping',
        '- /quit',
      ].join('\n') + '\n')
      return true
    }
    if (line === '/presence') {
      this.printPresence()
      return true
    }
    if (line === '/enter') {
      this.sendEnter()
      return true
    }
    if (line === '/exit') {
      this.sendExit()
      return true
    }
    if (line.startsWith('/history')) {
      const rawLimit = line.split(/\s+/u)[1] || ''
      const limit = Number(rawLimit)
      this.printHistory({ limit: Number.isFinite(limit) ? limit : 0 })
      return true
    }
    if (line.startsWith('/select ')) {
      this.sendSelection(line.slice('/select '.length))
      return true
    }
    if (line === '/snapshot') {
      this.printSnapshot()
      return true
    }
    if (line === '/ping') {
      this.send({ type: 'chat.ping' })
      return true
    }
    if (line === '/quit' || line === '/exit') {
      await this.close()
      this.readline?.close()
      return false
    }
    this.sendChat(line)
    return true
  }

  async close() {
    if (!this.socket) return
    const socket = this.socket
    this.socket = null
    if (socket.readyState === WebSocket.CLOSED) return
    await new Promise((resolve) => {
      socket.once('close', () => resolve())
      socket.close(1000, 'cli-close')
    })
  }
}
