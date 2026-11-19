import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { ensureDir } from './paths.js'

const DEFAULT_VIEWPORT = { width: 960, height: 540, preset: '16:9', chrome: true }

function blank() {
  return { version: 1, games: [], viewport: { ...DEFAULT_VIEWPORT }, settings: { scanAt: 0 } }
}

function normalize(raw) {
  const base = blank()
  if (!raw || typeof raw !== 'object') return base
  const games = Array.isArray(raw.games) ? raw.games : []
  base.games = games
    .filter((g) => g && typeof g.path === 'string' && g.path)
    .map((g) => ({
      id: String(g.id || newId()),
      name: String(g.name || path.basename(g.path, path.extname(g.path))),
      path: g.path,
      args: String(g.args || ''),
      workdir: String(g.workdir || path.dirname(g.path)),
      source: g.source === 'steam' ? 'steam' : 'manual',
      appid: g.appid ? Number(g.appid) : 0,
      needsAdmin: Boolean(g.needsAdmin),
      addedAt: Number(g.addedAt) || Date.now(),
      lastRun: Number(g.lastRun) || 0,
      playMs: Number(g.playMs) || 0,
    }))
  const vp = raw.viewport && typeof raw.viewport === 'object' ? raw.viewport : {}
  base.viewport = {
    width: clampDim(vp.width, DEFAULT_VIEWPORT.width),
    height: clampDim(vp.height, DEFAULT_VIEWPORT.height),
    preset: typeof vp.preset === 'string' && vp.preset ? vp.preset : DEFAULT_VIEWPORT.preset,
    chrome: vp.chrome === undefined ? true : Boolean(vp.chrome),
  }
  base.settings = raw.settings && typeof raw.settings === 'object' ? { ...base.settings, ...raw.settings } : base.settings
  return base
}

function clampDim(value, fallback) {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.max(240, Math.min(3840, Math.round(n)))
}

function newId() {
  return 'g' + crypto.randomBytes(5).toString('hex')
}

export function createStore(dataDir) {
  const file = path.join(dataDir, 'games.json')
  let state = blank()

  try {
    state = normalize(JSON.parse(fs.readFileSync(file, 'utf8')))
  } catch {
    state = blank()
  }

  function save() {
    try {
      ensureDir(dataDir)
      fs.writeFileSync(file, JSON.stringify(state, null, 2), 'utf8')
    } catch (err) {
      console.error('[yy-gamebox] save failed', err)
    }
  }

  function findById(id) {
    return state.games.find((g) => g.id === id) || null
  }

  function findByPath(exePath) {
    const key = String(exePath).toLowerCase()
    return state.games.find((g) => g.path.toLowerCase() === key) || null
  }

  return {
    state: () => state,
    games: () => state.games,
    viewport: () => state.viewport,
    findById,
    findByPath,
    add(entry) {
      const existing = findByPath(entry.path)
      if (existing) {
        Object.assign(existing, {
          name: entry.name || existing.name,
          args: entry.args ?? existing.args,
          source: entry.source || existing.source,
          appid: entry.appid || existing.appid,
        })
        save()
        return { game: existing, added: false }
      }
      const game = normalize({ games: [entry] }).games[0]
      state.games.push(game)
      save()
      return { game, added: true }
    },
    remove(id) {
      const idx = state.games.findIndex((g) => g.id === id)
      if (idx < 0) return false
      state.games.splice(idx, 1)
      save()
      return true
    },
    update(id, patch) {
      const game = findById(id)
      if (!game) return null
      if (typeof patch.name === 'string' && patch.name.trim()) game.name = patch.name.trim()
      if (typeof patch.args === 'string') game.args = patch.args
      if (typeof patch.needsAdmin === 'boolean') game.needsAdmin = patch.needsAdmin
      if (typeof patch.lastRun === 'number') game.lastRun = patch.lastRun
      if (typeof patch.playMs === 'number') game.playMs = patch.playMs
      save()
      return game
    },
    setViewport(patch) {
      const next = { ...state.viewport }
      if (patch.width !== undefined) next.width = clampDim(patch.width, next.width)
      if (patch.height !== undefined) next.height = clampDim(patch.height, next.height)
      if (typeof patch.preset === 'string' && patch.preset) next.preset = patch.preset
      if (typeof patch.chrome === 'boolean') next.chrome = patch.chrome
      state.viewport = next
      save()
      return next
    },
    setSettings(patch) {
      state.settings = { ...state.settings, ...patch }
      save()
      return state.settings
    },
  }
}
