import assert from 'node:assert/strict'
import test from 'node:test'

import { applyRoomMessage, createRoomState, getChatHistory, getPresenceList, roomStateToJson } from '../src/room-state.js'

test('room state hydrates from room snapshot and applies later chat/presence updates', () => {
  const state = createRoomState()
  applyRoomMessage(state, {
    type: 'room.snapshot',
    room: {
      roomId: 'runtime-1',
      worldName: 'Test World',
      members: [
        {
          userId: 'user-1',
          username: 'inkwell',
          joinedAt: '2026-03-25T00:00:00.000Z',
          hasEntered: true,
          enteredAt: '2026-03-25T00:00:00.500Z',
          selectedCharacterId: 'world-default',
          selectedCharacterLabel: 'World default',
        },
      ],
      playStates: [
        {
          userId: 'user-1',
          username: 'inkwell',
          x: 10,
          y: 20,
        },
      ],
      chatHistory: [
        {
          id: 'msg-1',
          userId: 'user-1',
          username: 'inkwell',
          text: 'hello',
          createdAt: '2026-03-25T00:00:01.000Z',
        },
      ],
    },
    self: {
      userId: 'user-1',
      username: 'inkwell',
      role: 'admin',
      clientInstanceId: 'cli-1',
    },
  })

  applyRoomMessage(state, {
    type: 'presence.joined',
    user: {
      userId: 'user-2',
      username: 'friend',
      joinedAt: '2026-03-25T00:00:02.000Z',
    },
  })
  applyRoomMessage(state, {
    type: 'chat.message',
    message: {
      id: 'msg-2',
      userId: 'user-2',
      username: 'friend',
      text: 'hi back',
      createdAt: '2026-03-25T00:00:03.000Z',
    },
  })

  const presence = getPresenceList(state)
  const history = getChatHistory(state)
  const json = roomStateToJson(state)

  assert.equal(presence.length, 2)
  assert.equal(history.length, 2)
  assert.equal(json.self.userId, 'user-1')
  assert.equal(json.room.worldName, 'Test World')
  assert.equal(json.members[0].hasEntered, true)
})

test('room state removes users on presence.left and records restarts', () => {
  const state = createRoomState()
  applyRoomMessage(state, {
    type: 'room.snapshot',
    room: {
      roomId: 'runtime-2',
      members: [
        { userId: 'user-1', username: 'inkwell', joinedAt: '2026-03-25T00:00:00.000Z' },
        { userId: 'user-2', username: 'friend', joinedAt: '2026-03-25T00:00:01.000Z' },
      ],
      playStates: [
        { userId: 'user-2', username: 'friend', x: 1, y: 2 },
      ],
    },
    self: { userId: 'user-1', username: 'inkwell' },
  })

  applyRoomMessage(state, {
    type: 'presence.left',
    user: {
      userId: 'user-2',
      username: 'friend',
    },
    reason: 'socket-close',
  })
  applyRoomMessage(state, {
    type: 'room.restart',
    restartId: 'restart-1',
    reason: 'host-restarted',
    requestedAt: '2026-03-25T00:00:04.000Z',
  })

  assert.equal(getPresenceList(state).length, 1)
  assert.equal(state.playStatesByUserId.size, 0)
  assert.equal(state.lastRestart.restartId, 'restart-1')
})

test('room state tracks entered and exited presence updates', () => {
  const state = createRoomState()
  applyRoomMessage(state, {
    type: 'room.snapshot',
    room: {
      roomId: 'runtime-3',
      members: [
        { userId: 'user-1', username: 'inkwell', joinedAt: '2026-03-25T00:00:00.000Z', hasEntered: false },
      ],
    },
    self: { userId: 'user-1', username: 'inkwell' },
  })

  applyRoomMessage(state, {
    type: 'presence.entered',
    user: {
      userId: 'user-1',
      username: 'inkwell',
      hasEntered: true,
      enteredAt: '2026-03-25T00:00:03.000Z',
    },
    room: {
      members: [
        { userId: 'user-1', username: 'inkwell', joinedAt: '2026-03-25T00:00:00.000Z', hasEntered: true, enteredAt: '2026-03-25T00:00:03.000Z' },
      ],
    },
  })
  assert.equal(getPresenceList(state)[0].hasEntered, true)

  applyRoomMessage(state, {
    type: 'presence.exited',
    user: {
      userId: 'user-1',
      username: 'inkwell',
      hasEntered: false,
      enteredAt: null,
    },
    room: {
      members: [
        { userId: 'user-1', username: 'inkwell', joinedAt: '2026-03-25T00:00:00.000Z', hasEntered: false, enteredAt: null },
      ],
      playStates: [],
    },
  })
  assert.equal(getPresenceList(state)[0].hasEntered, false)
})
