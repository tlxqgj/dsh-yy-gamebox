import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { readJsonBody, sendJson, sendText } from './http.js'
import { scanSteam, findExeInDir } from './scan.js'

const DEFAULT_FRAC = [0.16, 0.1, 0.68, 0.8]

function normFrac(value) {
  if (!Array.isArray(value) || value.length !== 4) return null
  const frac = value.map((n) => Number(n))
  if (frac.some((n) => !Number.isFinite(n))) return null
  const [x, y, w, h] = frac
  if (w <= 0.02 || h <= 0.02) return null
  return [
    Math.min(Math.max(x, 0), 0.98),
    Math.min(Math.max(y, 0), 0.98),
    Math.min(Math.max(w, 0.02), 1),
    Math.min(Math.max(h, 0.02), 1),
  ]
}

function spawnDetached(file, args = [], cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, {
      cwd: cwd || path.dirname(file),
      detached: true,
      stdio: 'ignore',
      windowsHide: false,
    })
    child.once('spawn', () => {
      child.unref()
      resolve(child.pid)
    })
    child.once('error', reject)
  })
}

function parseArgs(text) {
  const out = []
  const re = /"([^"]*)"|(\S+)/g
  let m
  while ((m = re.exec(String(text || '')))) out.push(m[1] !== undefined ? m[1] : m[2])
  return out
}

function isAlive(pid) {
  if (!pid) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    return err && err.code === 'EPERM'
  }
}

export function createApi({ store, engine, log = () => {} }) {
  const session = {
    gameId: '',
    name: '',
    pid: 0,
    hwnd: 0,
    frac: DEFAULT_FRAC,
    startedAt: 0,
    phase: 'idle', // idle | launching | running | waiting-admin
    error: '',
    native: null, // 原生窗口真实尺寸（物理像素），给前端按游戏自身大小摆舞台
    fixed: false, // 该游戏是否拒绝改尺寸（真·固定尺寸时才按原生大小摆舞台）
  }
  let watcher = null
  let panelVisible = false

  function snapshot() {
    return {
      engine: engine.info(),
      viewport: store.viewport(),
      games: store.games(),
      session: session.phase === 'idle' ? null : { ...session },
      panel: { visible: panelVisible },
    }
  }

  function stopWatcher() {
    if (watcher) {
      clearInterval(watcher)
      watcher = null
    }
  }

  function startWatcher() {
    stopWatcher()
    watcher = setInterval(() => {
      if (session.phase !== 'running' && session.phase !== 'waiting-admin') return
      if (session.pid && isAlive(session.pid)) {
        refreshNative()
        return
      }
      endSession('游戏已退出')
    }, 2500)
    watcher.unref?.()
  }

  // 有些游戏（模拟器、老游戏）坚持自己的窗口尺寸，前端需要知道真实尺寸才能把舞台摆成一样大
  async function refreshNative() {
    if (!session.hwnd || engine.status !== 'ready') return
    try {
      const res = await engine.call('windows', {}, 4000)
      const hit = (res && res.windows ? res.windows : []).find((w) => w.hwnd === session.hwnd)
      if (!hit || !hit.client) return
      const native = { w: hit.client[2] - hit.client[0], h: hit.client[3] - hit.client[1] }
      const fixed = Boolean(hit.fixedSize)
      if (!session.native || session.native.w !== native.w || session.native.h !== native.h || session.fixed !== fixed) {
        session.native = native
        session.fixed = fixed
      }
    } catch {
      /* 引擎忙/断开时忽略 */
    }
  }

  function endSession(reason) {
    const pid = session.pid
    const hwnd = session.hwnd
    log('[api] endSession reason=' + (reason || 'manual') + ' pid=' + pid + ' hwnd=' + hwnd + ' alive=' + isAlive(pid))
    Object.assign(session, { gameId: '', name: '', pid: 0, hwnd: 0, startedAt: 0, phase: 'idle', error: reason || '', native: null, fixed: false })
    stopWatcher()
    if (hwnd || pid) {
      engine.call('detach', { hwnd }, 5000).catch(() => {})
    }
  }

  async function ensureEngine() {
    if (engine.status === 'ready') return engine.info()
    log('[api] engine not ready, requesting elevation')
    await engine.ensure()
    return engine.info()
  }

  async function attachTracked(pid, game, frac) {
    const tracked = await engine.call('track', {
      pid,
      path: game.path,
      title: game.name,
      sinceMs: Date.now(),
      timeoutMs: 25000,
    }, 40000)
    if (!tracked || !tracked.found) throw new Error('没有找到游戏窗口（可能仍在加载或已退出）')
    const hwnd = Number(tracked.hwnd) || 0
    const attach = await engine.call('attach', {
      pid: tracked.pid || pid,
      hwnd,
      frac,
      chrome: store.viewport().chrome,
    }, 20000)
    return { pid: Number(attach.pid) || pid, hwnd: Number(attach.hwnd) || hwnd }
  }

  async function launch({ id, frac, admin, waitMs = 90000 }) {
    const game = store.findById(id)
    if (!game) throw new Error('游戏不存在：' + id)
    if (session.phase === 'running') throw new Error('已有游戏在运行，请先停止')
    if (!fs.existsSync(game.path)) throw new Error('可执行文件不存在：' + game.path)

    session.gameId = game.id
    session.name = game.name
    session.pid = 0
    session.hwnd = 0
    session.frac = normFrac(frac) || DEFAULT_FRAC
    session.startedAt = Date.now()
    session.phase = 'launching'
    session.error = ''

    await ensureEngine()

    let started = false
    if (!admin && !game.needsAdmin) {
      try {
        const pid = await spawnDetached(game.path, parseArgs(game.args), game.workdir)
        const attached = await attachTracked(pid, game, session.frac)
        session.pid = attached.pid
        session.hwnd = attached.hwnd
        started = true
      } catch (err) {
        if (!(err && (err.code === 'EACCES' || err.code === 'EPERM'))) throw err
        // 普通身份启动被拒 → 记住并改由已提权的引擎启动，不再让用户点第二次
        store.update(game.id, { needsAdmin: true })
        log('[api] spawn denied, falling back to elevated launch')
      }
    }

    if (!started) {
      const startedInfo = await engine.call('launch', {
        path: game.path,
        args: game.args,
        workdir: game.workdir,
        title: game.name,
        timeoutMs: Math.max(20000, waitMs),
      }, waitMs + 20000)
      const pid = Number(startedInfo.pid) || 0
      let hwnd = Number(startedInfo.hwnd) || 0
      if (!hwnd) {
        const tracked = await engine.call('track', {
          pid,
          path: game.path,
          title: game.name,
          sinceMs: Date.now() - 60000,
          timeoutMs: 15000,
        }, 25000)
        hwnd = Number(tracked.hwnd) || 0
      }
      if (!hwnd) throw new Error('游戏已启动，但没有找到窗口')
      const attach = await engine.call('attach', { pid, hwnd, frac: session.frac, chrome: store.viewport().chrome }, 20000)
      session.pid = Number(attach.pid) || pid
      session.hwnd = Number(attach.hwnd) || hwnd
    }

    session.phase = 'running'
    store.update(game.id, { lastRun: Date.now() })
    if (!panelVisible && session.hwnd) {
      engine.call('show', { on: false, hwnd: session.hwnd }, 6000).catch(() => {})
    }
    startWatcher()
    log(`[api] running ${game.name} pid=${session.pid} hwnd=0x${session.hwnd.toString(16)}`)
    return snapshot()
  }

  async function stopGame() {
    if (!session.pid) {
      endSession('')
      return snapshot()
    }
    try {
      await engine.call('kill', { pid: session.pid, hwnd: session.hwnd }, 8000)
    } catch (err) {
      log('[api] kill failed: ' + err.message)
    }
    endSession('')
    return snapshot()
  }

  async function moveViewport(frac, viewportPatch) {
    if (viewportPatch) store.setViewport(viewportPatch)
    const next = normFrac(frac)
    if (next) session.frac = next
    if (session.phase === 'running' && session.hwnd) {
      try {
        await engine.call('move', { frac: session.frac }, 6000)
      } catch (err) {
        log('[api] move failed: ' + err.message)
      }
    }
    return { viewport: store.viewport(), frac: session.frac }
  }

  async function handle(req, res, url) {
    const route = url.pathname.replace(/^\/yy-gamebox/, '') || '/'
    const method = (req.method || 'GET').toUpperCase()

    if (method === 'GET' && (route === '/' || route === '/api/state')) return sendJson(res, 200, snapshot())

    if (method === 'POST' && route === '/api/scan') {
      const result = scanSteam()
      store.setSettings({ scanAt: Date.now() })
      return sendJson(res, 200, { ok: true, ...result })
    }

    if (method === 'POST' && route === '/api/games/add') {
      const body = await readJsonBody(req)
      let exe = String(body.path || '').trim().replace(/^"|"$/g, '')
      if (!exe) return sendJson(res, 400, { ok: false, error: '缺少路径' })
      if (fs.existsSync(exe) && fs.statSync(exe).isDirectory()) exe = findExeInDir(exe)
      if (!exe || !fs.existsSync(exe)) return sendJson(res, 400, { ok: false, error: '找不到可执行文件：' + exe })
      const result = store.add({
        name: body.name || path.basename(exe, '.exe'),
        path: exe,
        args: body.args || '',
        workdir: body.workdir || path.dirname(exe),
        source: body.source === 'steam' ? 'steam' : 'manual',
        appid: body.appid || 0,
      })
      return sendJson(res, 200, { ok: true, ...result })
    }

    if (method === 'POST' && route === '/api/games/remove') {
      const body = await readJsonBody(req)
      const ok = store.remove(String(body.id || ''))
      return sendJson(res, ok ? 200 : 404, { ok })
    }

    if (method === 'POST' && route === '/api/games/update') {
      const body = await readJsonBody(req)
      const game = store.update(String(body.id || ''), body.patch || {})
      return sendJson(res, game ? 200 : 404, { ok: Boolean(game), game })
    }

    if (method === 'POST' && route === '/api/launch') {
      const body = await readJsonBody(req)
      try {
        const state = await launch({ id: String(body.id || ''), frac: body.frac, admin: Boolean(body.admin) })
        return sendJson(res, 200, { ok: true, ...state })
      } catch (err) {
        session.phase = 'idle'
        session.error = err.message
        return sendJson(res, err.needsAdmin ? 409 : 500, { ok: false, error: err.message, needsAdmin: Boolean(err.needsAdmin), state: snapshot() })
      }
    }

    if (method === 'POST' && route === '/api/stop') {
      const state = await stopGame()
      return sendJson(res, 200, { ok: true, ...state })
    }

    if (method === 'POST' && route === '/api/viewport') {
      const body = await readJsonBody(req)
      const result = await moveViewport(body.frac, body.viewport)
      return sendJson(res, 200, { ok: true, ...result })
    }

    if (method === 'POST' && route === '/api/show') {
      const body = await readJsonBody(req)
      panelVisible = Boolean(body.on)
      if (body.dbg) log('[panel] show on=' + panelVisible + ' ' + JSON.stringify(body.dbg))
      if (session.phase === 'running' && session.hwnd && engine.status === 'ready') {
        engine.call('show', { on: panelVisible }, 6000).catch(() => {})
      }
      return sendJson(res, 200, { ok: true, visible: panelVisible })
    }

    if (method === 'POST' && route === '/api/engine/start') {
      try {
        await engine.ensure()
        return sendJson(res, 200, { ok: true, engine: engine.info() })
      } catch (err) {
        return sendJson(res, 500, { ok: false, error: err.message, engine: engine.info() })
      }
    }

    if (method === 'POST' && route === '/api/engine/stop') {
      await engine.stop()
      endSession('引擎已停止')
      return sendJson(res, 200, { ok: true, engine: engine.info() })
    }

    if (method === 'GET' && route === '/api/log') {
      try {
        const text = fs.readFileSync(engine.logFile, 'utf8').split('\n').slice(-120).join('\n')
        return sendText(res, 200, text)
      } catch {
        return sendText(res, 200, '(暂无日志)')
      }
    }

    return sendJson(res, 404, { ok: false, error: 'not found: ' + route })
  }

  return { handle, snapshot, launch, stopGame, session, endSession }
}
