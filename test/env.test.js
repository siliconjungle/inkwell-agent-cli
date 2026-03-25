import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve as resolvePath } from 'node:path'
import test from 'node:test'

import { loadCliConfig, parseDotenv } from '../src/env.js'

test('parseDotenv handles quotes and inline comments', () => {
  const parsed = parseDotenv([
    'FOO=bar',
    'BAR="baz qux"',
    'BAZ=value # comment',
    '',
  ].join('\n'))
  assert.equal(parsed.FOO, 'bar')
  assert.equal(parsed.BAR, 'baz qux')
  assert.equal(parsed.BAZ, 'value')
})

test('loadCliConfig merges sibling env files and keeps shell overrides last', () => {
  const root = mkdtempSync(resolvePath(tmpdir(), 'inkwell-api-cli-env-'))
  const projectDir = resolvePath(root, 'inkwell-api-cli')
  const backendDir = resolvePath(root, 'inkwell-api-backend')
  const frontendDir = resolvePath(root, 'inkwell-api-frontend')
  mkdirSync(projectDir, { recursive: true })
  mkdirSync(backendDir, { recursive: true })
  mkdirSync(frontendDir, { recursive: true })

  writeFileSync(resolvePath(backendDir, '.env'), 'BACKEND_JWT_SECRET=backend-secret\nINKWELL_AI_DEV_USERNAME=backend-user\n')
  writeFileSync(resolvePath(frontendDir, '.env.local'), 'NEXT_PUBLIC_API_BASE=http://frontend.test:4000\n')
  writeFileSync(resolvePath(projectDir, '.env.local'), 'INKWELL_AI_DEV_USERNAME=inkwell\n')

  const config = loadCliConfig({
    projectDir,
    env: {
      INKWELL_AI_DEV_EMAIL: 'shell@example.test',
    },
  })

  assert.equal(config.apiBase, 'http://frontend.test:4000')
  assert.equal(config.backendJwtSecret, 'backend-secret')
  assert.equal(config.identity.username, 'inkwell')
  assert.equal(config.identity.email, 'shell@example.test')
  assert.equal(config.loadedFiles.length, 3)
})
