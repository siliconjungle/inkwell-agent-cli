import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import test from 'node:test'

import { RoomSession } from '../src/room-session.js'

class FakeSocket extends EventEmitter {
  constructor() {
    super()
    this.readyState = 0
    this.sent = []
  }

  open() {
    this.readyState = 1
    this.emit('open')
  }

  send(payload) {
    this.sent.push(JSON.parse(String(payload)))
  }

  close(code = 1000, reason = '') {
    this.readyState = 3
    this.emit('close', code, reason)
  }
}

function createConfig() {
  return {
    identity: {
      userId: 'user-1',
      username: 'inkwell',
      email: 'inkwell@example.test',
      role: 'admin',
    },
    jwtIssuer: 'inkwell.test',
    backendJwtSecret: 'test-secret',
    wsBase: 'http://localhost:4000',
    stateDir: '/tmp',
  }
}

test('room session blocks chat until the user has entered and supports auto-enter', async () => {
  const socket = new FakeSocket()
  const outputs = []
  const errors = []
  const session = new RoomSession({
    config: createConfig(),
    roomId: 'runtime-room-1',
    stdout: { write: (text) => outputs.push(String(text)) },
    stderr: { write: (text) => errors.push(String(text)) },
    fetchRoomWorld: async () => null,
    openSocket: () => {
      queueMicrotask(() => {
        socket.open()
        socket.emit('message', JSON.stringify({
          type: 'room.snapshot',
          room: {
            roomId: 'runtime-room-1',
            members: [
              {
                userId: 'user-1',
                username: 'inkwell',
                joinedAt: '2026-03-25T00:00:00.000Z',
                hasEntered: false,
              },
            ],
            playStates: [],
            chatHistory: [],
          },
          self: {
            userId: 'user-1',
            username: 'inkwell',
            role: 'admin',
            clientInstanceId: 'cli-1',
          },
        }))
      })
      return socket
    },
  })

  await session.connect({ selectionId: 'world-default', enter: false, clientInstanceId: 'cli-1' })
  assert.equal(socket.sent[0].type, 'play.selection')
  assert.throws(() => session.sendChat('hello'), /Enter the room before chatting/u)

  session.sendEnter()
  assert.equal(socket.sent[1].type, 'play.enter')
  assert.equal(socket.sent[2].type, 'play.state')
  assert.equal(socket.sent[2].state.x, 0)
  assert.equal(socket.sent[2].state.y, 0)

  socket.emit('message', JSON.stringify({
    type: 'presence.entered',
    room: {
      members: [
        {
          userId: 'user-1',
          username: 'inkwell',
          joinedAt: '2026-03-25T00:00:00.000Z',
          hasEntered: true,
          enteredAt: '2026-03-25T00:00:02.000Z',
        },
      ],
      playStates: [],
    },
    user: {
      userId: 'user-1',
      username: 'inkwell',
      hasEntered: true,
      enteredAt: '2026-03-25T00:00:02.000Z',
    },
  }))

  session.sendChat('hello after enter')
  assert.equal(socket.sent[3].type, 'chat.send')
  assert.equal(outputs.some((text) => text.includes('entered: inkwell')), true)
  assert.equal(errors.length, 0)
})

test('room session auto-publishes a nearby idle play state on auto-enter', async () => {
  const socket = new FakeSocket()
  const session = new RoomSession({
    config: createConfig(),
    roomId: 'runtime-room-2',
    stdout: { write: () => {} },
    stderr: { write: () => {} },
    fetchRoomWorld: async () => null,
    openSocket: () => {
      queueMicrotask(() => {
        socket.open()
        socket.emit('message', JSON.stringify({
          type: 'room.snapshot',
          room: {
            roomId: 'runtime-room-2',
            members: [
              {
                userId: 'user-2',
                username: 'jungle',
                joinedAt: '2026-03-25T00:00:00.000Z',
                hasEntered: true,
              },
              {
                userId: 'user-1',
                username: 'inkwell',
                joinedAt: '2026-03-25T00:00:01.000Z',
                hasEntered: false,
              },
            ],
            playStates: [
              {
                userId: 'user-2',
                username: 'jungle',
                x: 10,
                y: 12,
                z: 0,
                supportZ: 0,
                moveSpeed: 5,
                jumpStrength: 9,
                facing: 'left',
              },
            ],
            chatHistory: [],
          },
          self: {
            userId: 'user-1',
            username: 'inkwell',
            role: 'admin',
            clientInstanceId: 'cli-2',
          },
        }))
      })
      return socket
    },
  })

  await session.connect({ selectionId: 'profile-avatar', enter: true, clientInstanceId: 'cli-2' })
  assert.equal(socket.sent[0].type, 'play.selection')
  assert.equal(socket.sent[1].type, 'play.enter')
  assert.equal(socket.sent[2].type, 'play.state')
  assert.equal(socket.sent[2].state.x, 8.75)
  assert.equal(socket.sent[2].state.y, 12)
  assert.equal(socket.sent[2].state.facing, 'left')
  assert.equal(socket.sent[2].state.moveSpeed, 5)
  assert.equal(socket.sent[2].state.jumpStrength, 9)
})

test('room session downloads runtime world data and uses the authored player spawn for auto-enter', async () => {
  const socket = new FakeSocket()
  const fetchCalls = []
  const session = new RoomSession({
    config: createConfig(),
    roomId: 'runtime-room-world',
    stdout: { write: () => {} },
    stderr: { write: () => {} },
    fetchRoomWorld: async (config, options) => {
      fetchCalls.push({
        apiBase: config.apiBase,
        appBase: config.appBase,
        ...options,
      })
      return {
        id: 'pub-world',
        world: {
          scene: {
            nodes: [
              {
                id: 'npc-1',
                type: 'characters',
                x: 1,
                y: 2,
                facing: 'left',
              },
              {
                id: 'player-1',
                type: 'characters',
                isPlayer: true,
                x: 48,
                y: 19,
                z: 3,
                facing: 'up',
              },
            ],
          },
        },
      }
    },
    openSocket: () => {
      queueMicrotask(() => {
        socket.open()
        socket.emit('message', JSON.stringify({
          type: 'room.snapshot',
          room: {
            roomId: 'runtime-room-world',
            publishedWorldId: 'pub-world',
            members: [
              {
                userId: 'user-1',
                username: 'inkwell',
                joinedAt: '2026-03-25T00:00:00.000Z',
                hasEntered: false,
              },
            ],
            playStates: [],
            chatHistory: [],
          },
          self: {
            userId: 'user-1',
            username: 'inkwell',
            role: 'admin',
            clientInstanceId: 'cli-world',
          },
        }))
      })
      return socket
    },
  })

  await session.connect({ selectionId: 'world-default', enter: true, clientInstanceId: 'cli-world' })
  assert.equal(fetchCalls.length, 1)
  assert.equal(fetchCalls[0].roomId, 'runtime-room-world')
  assert.equal(fetchCalls[0].publishedWorldId, 'pub-world')
  assert.match(fetchCalls[0].roomToken, /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/u)
  assert.equal(socket.sent[0].type, 'play.selection')
  assert.equal(socket.sent[1].type, 'play.enter')
  assert.equal(socket.sent[2].type, 'play.state')
  assert.equal(socket.sent[2].state.x, 48)
  assert.equal(socket.sent[2].state.y, 19)
  assert.equal(socket.sent[2].state.z, 3)
  assert.equal(socket.sent[2].state.supportZ, 3)
  assert.equal(socket.sent[2].state.facing, 'up')
  assert.equal(session.getWorldPayload()?.scene?.nodes?.length, 2)
})

test('room session republishes headless play state after room restart', async () => {
  const socket = new FakeSocket()
  const session = new RoomSession({
    config: createConfig(),
    roomId: 'runtime-room-3',
    stdout: { write: () => {} },
    stderr: { write: () => {} },
    fetchRoomWorld: async () => null,
    openSocket: () => {
      queueMicrotask(() => {
        socket.open()
        socket.emit('message', JSON.stringify({
          type: 'room.snapshot',
          room: {
            roomId: 'runtime-room-3',
            members: [
              {
                userId: 'user-1',
                username: 'inkwell',
                joinedAt: '2026-03-25T00:00:00.000Z',
                hasEntered: true,
                enteredAt: '2026-03-25T00:00:01.000Z',
              },
            ],
            playStates: [],
            chatHistory: [],
          },
          self: {
            userId: 'user-1',
            username: 'inkwell',
            role: 'admin',
            clientInstanceId: 'cli-3',
          },
        }))
      })
      return socket
    },
  })

  await session.connect({ selectionId: 'profile-avatar', enter: true, clientInstanceId: 'cli-3' })
  const initialState = socket.sent[2].state
  socket.sent.length = 0

  socket.emit('message', JSON.stringify({
    type: 'room.restart',
    requestedAt: '2026-03-25T00:00:02.000Z',
    room: {
      roomId: 'runtime-room-3',
      members: [
        {
          userId: 'user-1',
          username: 'inkwell',
          joinedAt: '2026-03-25T00:00:00.000Z',
          hasEntered: true,
          enteredAt: '2026-03-25T00:00:01.000Z',
        },
      ],
      playStates: [],
      chatHistory: [],
    },
  }))

  await new Promise((resolve) => setImmediate(resolve))

  assert.equal(socket.sent[0].type, 'play.state')
  assert.deepEqual(socket.sent[0].state, initialState)
})
