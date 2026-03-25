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
  assert.equal(socket.sent[2].type, 'chat.send')
  assert.equal(outputs.some((text) => text.includes('entered: inkwell')), true)
  assert.equal(errors.length, 0)
})
