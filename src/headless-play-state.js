const PLAY_COORDINATE_LIMIT = 100_000
const DEFAULT_HEADLESS_X = 0
const DEFAULT_HEADLESS_Y = 0
const DEFAULT_HEADLESS_Z = 0
const DEFAULT_HEADLESS_SUPPORT_Z = 0
const DEFAULT_HEADLESS_MOVE_SPEED = 4.90625
const DEFAULT_HEADLESS_JUMP_STRENGTH = 8.75
const DEFAULT_HEADLESS_FACING = 'right'
const HEADLESS_NEARBY_OFFSET = 1.25

function clampFiniteNumber(value, {
  min = -PLAY_COORDINATE_LIMIT,
  max = PLAY_COORDINATE_LIMIT,
  fallback = null,
} = {}) {
  const normalized = Number(value)
  if (!Number.isFinite(normalized)) return fallback
  return Math.max(min, Math.min(max, normalized))
}

function normalizeFacing(value) {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : ''
  if (normalized === 'up' || normalized === 'down' || normalized === 'left' || normalized === 'right') {
    return normalized
  }
  return DEFAULT_HEADLESS_FACING
}

function toWorldNodeList(worldPayload = null) {
  if (Array.isArray(worldPayload)) return worldPayload
  if (Array.isArray(worldPayload?.scene?.nodes)) return worldPayload.scene.nodes
  return []
}

function findWorldPlayerCharacter(worldPayload = null) {
  const characters = toWorldNodeList(worldPayload).filter((entity) => (
    entity
    && entity.type === 'characters'
    && entity.visible !== false
  ))
  if (!characters.length) return null
  return characters.find((entity) => entity.isPlayer === true) || characters[0] || null
}

function buildHeadlessStateFromWorldPayload(worldPayload = null) {
  const playerCharacter = findWorldPlayerCharacter(worldPayload)
  if (!playerCharacter) return null
  return normalizeHeadlessPlayState({
    x: clampFiniteNumber(playerCharacter.x, { fallback: DEFAULT_HEADLESS_X }),
    y: clampFiniteNumber(playerCharacter.y, { fallback: DEFAULT_HEADLESS_Y }),
    z: clampFiniteNumber(playerCharacter.z, { min: -1_000, max: 1_000, fallback: DEFAULT_HEADLESS_Z }),
    supportZ: clampFiniteNumber(playerCharacter.z, { min: -1_000, max: 1_000, fallback: DEFAULT_HEADLESS_SUPPORT_Z }),
    moveSpeed: DEFAULT_HEADLESS_MOVE_SPEED,
    jumpStrength: DEFAULT_HEADLESS_JUMP_STRENGTH,
    facing: normalizeFacing(playerCharacter.facing),
  })
}

export function normalizeHeadlessPlayState(value = null) {
  if (!value || typeof value !== 'object') return null
  const x = clampFiniteNumber(value.x)
  const y = clampFiniteNumber(value.y)
  if (x == null || y == null) return null
  return {
    x,
    y,
    z: clampFiniteNumber(value.z, { min: -1_000, max: 1_000, fallback: DEFAULT_HEADLESS_Z }),
    altitude: clampFiniteNumber(value.altitude, { min: -1_000, max: 1_000, fallback: 0 }),
    verticalVel: clampFiniteNumber(value.verticalVel, { min: -10_000, max: 10_000, fallback: 0 }),
    vx: clampFiniteNumber(value.vx, { min: -10_000, max: 10_000, fallback: 0 }),
    vy: clampFiniteNumber(value.vy, { min: -10_000, max: 10_000, fallback: 0 }),
    moveSpeed: clampFiniteNumber(value.moveSpeed, { min: 0, max: 1_000, fallback: DEFAULT_HEADLESS_MOVE_SPEED }),
    jumpStrength: clampFiniteNumber(value.jumpStrength, { min: 0, max: 1_000, fallback: DEFAULT_HEADLESS_JUMP_STRENGTH }),
    supportZ: clampFiniteNumber(value.supportZ, { min: -1_000, max: 1_000, fallback: DEFAULT_HEADLESS_SUPPORT_Z }),
    facing: normalizeFacing(value.facing),
    isJumping: value.isJumping === true,
  }
}

function resolveAnchorState(playStates = [], currentUserId = '') {
  const normalizedUserId = typeof currentUserId === 'string' ? currentUserId.trim() : ''
  const normalizedStates = Array.isArray(playStates)
    ? playStates.map((entry) => normalizeHeadlessPlayState(entry)).filter(Boolean)
    : []
  if (!normalizedStates.length) return null
  if (normalizedUserId) {
    const selfState = Array.isArray(playStates)
      ? playStates.find((entry) => {
        const userId = typeof entry?.userId === 'string' ? entry.userId.trim() : ''
        return userId && userId === normalizedUserId
      })
      : null
    const normalizedSelf = normalizeHeadlessPlayState(selfState)
    if (normalizedSelf) return normalizedSelf
  }
  return normalizedStates[0] || null
}

export function buildInitialHeadlessPlayState({
  currentUserId = '',
  playStates = [],
  worldPayload = null,
} = {}) {
  const worldState = buildHeadlessStateFromWorldPayload(worldPayload)
  if (worldState) {
    return worldState
  }
  const anchor = resolveAnchorState(playStates, currentUserId)
  if (!anchor) {
    return normalizeHeadlessPlayState({
      x: DEFAULT_HEADLESS_X,
      y: DEFAULT_HEADLESS_Y,
      z: DEFAULT_HEADLESS_Z,
      supportZ: DEFAULT_HEADLESS_SUPPORT_Z,
      moveSpeed: DEFAULT_HEADLESS_MOVE_SPEED,
      jumpStrength: DEFAULT_HEADLESS_JUMP_STRENGTH,
      facing: DEFAULT_HEADLESS_FACING,
    })
  }

  const horizontalOffset = anchor.facing === 'left' ? -HEADLESS_NEARBY_OFFSET : HEADLESS_NEARBY_OFFSET
  return normalizeHeadlessPlayState({
    x: anchor.x + horizontalOffset,
    y: anchor.y,
    z: anchor.z,
    altitude: 0,
    verticalVel: 0,
    vx: 0,
    vy: 0,
    moveSpeed: anchor.moveSpeed,
    jumpStrength: anchor.jumpStrength,
    supportZ: anchor.supportZ,
    facing: anchor.facing,
    isJumping: false,
  })
}

export function mergeHeadlessPlayState(baseState = null, patch = null) {
  const normalizedPatch = normalizeHeadlessPlayState(patch)
  if (normalizedPatch) return normalizedPatch
  if (!patch || typeof patch !== 'object') return normalizeHeadlessPlayState(baseState)

  const base = normalizeHeadlessPlayState(baseState) || buildInitialHeadlessPlayState()
  return normalizeHeadlessPlayState({
    ...base,
    ...patch,
  })
}
