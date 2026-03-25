import { normalizeString } from './env.js'

function mergeDefined(target, source) {
  const next = { ...(target || {}) }
  for (const [key, value] of Object.entries(source || {})) {
    if (value !== undefined) {
      next[key] = value
    }
  }
  return next
}

function normalizeMember(member = null) {
  if (!member || typeof member !== 'object') return null
  const userId = normalizeString(member.userId, { max: 120 })
  if (!userId) return null
  return {
    userId,
    username: normalizeString(member.username, { max: 120 }) || 'Player',
    joinedAt: normalizeString(member.joinedAt, { max: 64 }) || null,
    hasEntered: member.hasEntered === true,
    enteredAt: normalizeString(member.enteredAt, { max: 64 }) || null,
    selectedCharacterId: normalizeString(member.selectedCharacterId, { max: 120 }) || null,
    selectedCharacterLabel: normalizeString(member.selectedCharacterLabel, { max: 120 }) || null,
    selectedCharacterCaption: normalizeString(member.selectedCharacterCaption, { max: 160 }) || null,
    selectedCharacterPortraitUrl: normalizeString(member.selectedCharacterPortraitUrl, { max: 4096 }) || null,
    selectedCharacterUpdatedAt: normalizeString(member.selectedCharacterUpdatedAt, { max: 64 }) || null,
  }
}

function normalizePlayState(state = null) {
  if (!state || typeof state !== 'object') return null
  const userId = normalizeString(state.userId, { max: 120 })
  if (!userId) return null
  return {
    ...state,
    userId,
    username: normalizeString(state.username, { max: 120 }) || 'Player',
  }
}

function normalizeMessage(message = null) {
  if (!message || typeof message !== 'object') return null
  const id = normalizeString(message.id, { max: 160 })
  const userId = normalizeString(message.userId, { max: 120 })
  if (!id || !userId) return null
  return {
    id,
    clientMessageId: normalizeString(message.clientMessageId, { max: 120 }) || null,
    roomId: normalizeString(message.roomId, { max: 160 }) || null,
    userId,
    username: normalizeString(message.username, { max: 120 }) || 'Player',
    text: normalizeString(message.text, { max: 1000 }),
    createdAt: normalizeString(message.createdAt, { max: 64 }) || null,
  }
}

function replaceMembers(state, members = []) {
  state.membersByUserId.clear()
  for (const entry of Array.isArray(members) ? members : []) {
    const normalized = normalizeMember(entry)
    if (!normalized) continue
    state.membersByUserId.set(normalized.userId, normalized)
  }
}

function replacePlayStates(state, playStates = []) {
  state.playStatesByUserId.clear()
  for (const entry of Array.isArray(playStates) ? playStates : []) {
    const normalized = normalizePlayState(entry)
    if (!normalized) continue
    state.playStatesByUserId.set(normalized.userId, normalized)
  }
}

function replaceChatHistory(state, chatHistory = []) {
  state.chatHistory = []
  for (const entry of Array.isArray(chatHistory) ? chatHistory : []) {
    const normalized = normalizeMessage(entry)
    if (!normalized) continue
    state.chatHistory.push(normalized)
  }
}

function mergeRoomEnvelope(state, room = null) {
  if (!room || typeof room !== 'object') return
  state.room = mergeDefined(state.room, room)
  if (Array.isArray(room.members)) replaceMembers(state, room.members)
  if (Array.isArray(room.playStates)) replacePlayStates(state, room.playStates)
  if (Array.isArray(room.chatHistory)) replaceChatHistory(state, room.chatHistory)
}

export function createRoomState() {
  return {
    room: null,
    self: null,
    membersByUserId: new Map(),
    playStatesByUserId: new Map(),
    chatHistory: [],
    lastRestart: null,
    closed: null,
    lastEventType: '',
  }
}

export function applyRoomMessage(state, message = null) {
  if (!message || typeof message !== 'object') return state
  state.lastEventType = normalizeString(message.type, { max: 64 })

  if (message.type === 'room.snapshot') {
    state.self = message.self && typeof message.self === 'object'
      ? {
        userId: normalizeString(message.self.userId, { max: 120 }) || '',
        username: normalizeString(message.self.username, { max: 120 }) || 'Player',
        role: normalizeString(message.self.role, { max: 32 }) || 'user',
        clientInstanceId: normalizeString(message.self.clientInstanceId, { max: 120 }) || '',
      }
      : null
    mergeRoomEnvelope(state, message.room || null)
    return state
  }

  if (
    message.type === 'presence.joined'
    || message.type === 'presence.entered'
    || message.type === 'presence.exited'
    || message.type === 'presence.selection'
  ) {
    mergeRoomEnvelope(state, message.room || null)
    const member = normalizeMember(message.user)
    if (member) {
      state.membersByUserId.set(member.userId, member)
    }
    return state
  }

  if (message.type === 'presence.left') {
    mergeRoomEnvelope(state, message.room || null)
    const member = normalizeMember(message.user)
    if (member) {
      state.membersByUserId.delete(member.userId)
      state.playStatesByUserId.delete(member.userId)
    }
    return state
  }

  if (message.type === 'presence.state') {
    mergeRoomEnvelope(state, message.room || null)
    const member = normalizeMember(message.user)
    if (member) {
      state.membersByUserId.set(member.userId, member)
    }
    const playState = normalizePlayState(message.state)
    if (playState) {
      state.playStatesByUserId.set(playState.userId, playState)
    }
    return state
  }

  if (message.type === 'chat.message') {
    mergeRoomEnvelope(state, message.room || null)
    const entry = normalizeMessage(message.message)
    if (entry) {
      state.chatHistory.push(entry)
    }
    return state
  }

  if (message.type === 'room.restart') {
    mergeRoomEnvelope(state, message.room || null)
    state.lastRestart = {
      restartId: normalizeString(message.restartId, { max: 160 }) || '',
      reason: normalizeString(message.reason, { max: 120 }) || 'host-restarted',
      requestedByUserId: normalizeString(message.requestedByUserId, { max: 120 }) || null,
      requestedAt: normalizeString(message.requestedAt, { max: 64 }) || null,
    }
    return state
  }

  if (message.type === 'room.closed') {
    mergeRoomEnvelope(state, message.room || null)
    state.closed = {
      reason: normalizeString(message.reason, { max: 120 }) || 'room-closed',
    }
    return state
  }

  return state
}

export function getPresenceList(state) {
  return Array.from(state.membersByUserId.values())
    .sort((left, right) => (
      String(left.joinedAt || '').localeCompare(String(right.joinedAt || ''))
      || left.username.localeCompare(right.username)
    ))
}

export function getChatHistory(state, { limit = 0 } = {}) {
  const history = state.chatHistory.slice()
  const normalizedLimit = Number(limit)
  if (!Number.isFinite(normalizedLimit) || normalizedLimit <= 0) return history
  return history.slice(-Math.max(1, Math.floor(normalizedLimit)))
}

export function roomStateToJson(state) {
  return {
    room: state.room,
    self: state.self,
    members: getPresenceList(state),
    playStates: Array.from(state.playStatesByUserId.values()),
    chatHistory: state.chatHistory.slice(),
    lastRestart: state.lastRestart,
    closed: state.closed,
  }
}
