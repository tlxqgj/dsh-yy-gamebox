import fs from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import crypto from 'node:crypto'
import { spawn, execFile } from 'node:child_process'
import { ensureDir } from './paths.js'

const CSC = 'C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe'
const FW = 'C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319'
const REFS = ['System.dll', 'System.Web.Extensions.dll', 'System.Drawing.dll', 'System.Windows.Forms.dll']

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function encodePowerShell(script) {
  return Buffer.from(script, 'utf16le').toString('base64')
}

export function createEngine({ dataDir, nativeDir, log = () => {} }) {
  const stateFile = path.join(dataDir, 'engine.json')
  const logFile = path.join(dataDir, 'engine.log')
  const exePath = path.join(dataDir, 'bin', 'yybox.exe')
  const csPath = path.join(nativeDir, 'yybox.cs')

  let port = 47311
  let token = ''
  let status = 'off' // off | starting | ready | denied | error
  let lastError = ''
  let hello = null
  let socket = null
  let buffer = ''
  let starting = null
  let queue = Promise.resolve()
  let pending = null
  let spawnedAt = 0
  let childExited = 0

  try {
    const saved = JSON.parse(fs.readFileSync(stateFile, 'utf8'))
    if (saved && Number.isInteger(saved.port)) port = saved.port
    if (saved && typeof saved.token === 'string') token = saved.token
  } catch {
    /* first run */
  }
  if (!token) {
    token = crypto.randomBytes(18).toString('hex')
    port = 47000 + crypto.randomInt(0, 1999)
  }

  function saveState() {
    try {
      ensureDir(dataDir)
      fs.writeFileSync(stateFile, JSON.stringify({ port, token }, null, 2), 'utf8')
    } catch {
      /* ignore */
    }
  }
  saveState()

  function setStatus(next, detail) {
    status = next
    // 成功连上就清掉上一次的失败原因，否则界面会一直挂着「未获得管理员授权」
    if (next === 'ready') lastError = detail || ''
    else if (detail) lastError = detail
    log(`[engine] ${next}${detail ? ' - ' + detail : ''}`)
  }

  // ───────────────────────── 编译 ─────────────────────────

  function needsBuild() {
    try {
      if (!fs.existsSync(exePath)) return true
      // 时间戳在不同写入路径下可能不可靠（曾出现源文件 mtime 比 exe 还早一小时），改用内容哈希
      const hash = crypto.createHash('sha1').update(fs.readFileSync(csPath)).digest('hex')
      const stamp = path.join(path.dirname(exePath), 'build.sha1')
      if (!fs.existsSync(stamp)) return true
      return fs.readFileSync(stamp, 'utf8').trim() !== hash
    } catch {
      return true
    }
  }

  function build() {
    return new Promise((resolve, reject) => {
      if (!fs.existsSync(CSC)) return reject(new Error('未找到 csc.exe，无法编译原生引擎'))
      ensureDir(path.dirname(exePath))
      const args = ['/nologo', '/target:winexe', '/optimize+', `/out:${exePath}`]
      for (const ref of REFS) args.push(`/r:${path.join(FW, ref)}`)
      args.push(csPath)
      log('[engine] build ' + exePath)
      execFile(CSC, args, { windowsHide: true, timeout: 120000 }, (err, stdout, stderr) => {
        if (err) return reject(new Error('csc 编译失败: ' + String(stderr || err.message).slice(0, 1200)))
        try {
          const hash = crypto.createHash('sha1').update(fs.readFileSync(csPath)).digest('hex')
          fs.writeFileSync(path.join(path.dirname(exePath), 'build.sha1'), hash + '\n', 'utf8')
        } catch {}
        resolve()
      })
    })
  }

  async function ensureBinary() {
    if (!needsBuild()) return
    await build()
  }

  // ───────────────────────── 进程与连接 ─────────────────────────

  function killStale() {
    return new Promise((resolve) => {
      execFile('taskkill', ['/F', '/IM', 'yybox.exe'], { windowsHide: true }, () => resolve())
    })
  }

  function spawnElevated() {
    const ps = [
      "Start-Process -FilePath '" + exePath + "'",
      "-ArgumentList '--port','" + port + "','--token','" + token + "','--log','" + logFile + "'",
      '-Verb RunAs -WindowStyle Hidden',
    ].join(' ')
    log('[engine] spawn elevated: ' + ps)
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-EncodedCommand', encodePowerShell(ps)], {
      windowsHide: true,
      detached: false,
      stdio: 'ignore',
    })
    childExited = 0
    child.on('exit', (code) => {
      childExited = code ?? 0
      log('[engine] elevation helper exit code=' + childExited)
    })
    child.on('error', (err) => {
      childExited = -1
      log('[engine] elevation helper error: ' + err.message)
    })
    spawnedAt = Date.now()
  }

  function connectOnce(timeoutMs = 1200) {
    return new Promise((resolve) => {
      let settled = false
      let sock = null
      const finish = (value) => {
        if (settled) return
        settled = true
        // 只有失败时才关掉这条探测连接；成功时要把它留下来当主连接
        if (!value || !value.ok) {
          try {
            if (sock) sock.destroy()
          } catch {
            /* ignore */
          }
        }
        resolve(value)
      }
      const timer = setTimeout(() => finish({ ok: false, reason: 'timeout' }), timeoutMs + 800)
      try {
        sock = net.createConnection({ host: '127.0.0.1', port })
      } catch (err) {
        clearTimeout(timer)
        finish({ ok: false, reason: 'connect-error: ' + err.message })
        return
      }
      sock.setEncoding('utf8')
      sock.setNoDelay(true)
      sock.once('error', (err) => {
        clearTimeout(timer)
        finish({ ok: false, reason: 'error: ' + (err && err.code) })
      })
      sock.once('connect', () => {
        try {
          sock.write(JSON.stringify({ cmd: 'auth', token }) + '\n')
        } catch (err) {
          clearTimeout(timer)
          finish({ ok: false, reason: 'write-error: ' + err.message })
          return
        }
        sock.once('data', (chunk) => {
          clearTimeout(timer)
          const line = String(chunk).split('\n')[0]
          try {
            const msg = JSON.parse(line)
            if (msg && msg.ok) {
              hello = msg.result
              finish({ ok: true, sock, hello: msg.result })
            } else finish({ ok: false, reason: 'rejected' })
          } catch {
            finish({ ok: false, reason: 'bad-reply' })
          }
        })
      })
    })
  }

  function attachSocket(sock) {
    socket = sock
    buffer = ''
    sock.on('data', (chunk) => {
      buffer += chunk
      let idx
      while ((idx = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, idx).trim()
        buffer = buffer.slice(idx + 1)
        if (!line) continue
        let msg = null
        try {
          msg = JSON.parse(line)
        } catch {
          continue
        }
        if (pending) {
          const settle = pending
          pending = null
          settle(msg)
        }
      }
    })
    const onGone = () => {
      if (socket !== sock) return
      socket = null
      status = 'off'
      hello = null
      if (pending) {
        pending({ ok: false, error: '引擎连接已断开' })
        pending = null
      }
    }
    sock.on('close', onGone)
    sock.on('error', onGone)
  }

  async function waitReady(deadline) {
    while (Date.now() < deadline) {
      const res = await connectOnce(1200)
      if (res.ok) {
        attachSocket(res.sock)
        setStatus('ready')
        return hello
      }
      if (childExited !== 0) {
        const detail = childExited === 1223
          ? '已取消管理员授权：请重试，并在 UAC 弹窗中点「是」'
          : '未获得管理员授权（退出码 ' + childExited + '）：请重试，并在 UAC 弹窗中点「是」'
        setStatus('denied', detail)
        throw new Error(detail)
      }
      await sleep(350)
    }
    setStatus('error', '引擎启动超时')
    throw new Error('引擎启动超时（若未看到 UAC 提示，请检查系统是否禁用了提权）')
  }

  function rotatePort() {
    port = 47000 + crypto.randomInt(0, 1999)
    saveState()
    log('[engine] 端口切换到 ' + port)
  }

  async function start({ timeoutMs = 90000 } = {}) {
    if (status === 'ready' && socket) return hello
    if (starting) {
      log('[engine] start ignored: 已有启动流程在进行')
      return starting
    }
    log('[engine] start enter')
    starting = (async () => {
      let lastErr = null
      for (let attempt = 0; attempt < 2; attempt++) {
        setStatus('starting')
        await killStale()
        log('[engine] stale killed')
        await ensureBinary()
        log('[engine] binary ready')
        spawnElevated()
        try {
          return await waitReady(Date.now() + timeoutMs)
        } catch (err) {
          lastErr = err
          if (attempt === 0) {
            log('[engine] 启动失败：' + err.message + '，换端口重试一次')
            rotatePort()
            continue
          }
        }
      }
      throw lastErr || new Error('引擎启动失败')
    })()
    const watchdog = new Promise((_resolve, reject) => {
      setTimeout(() => reject(new Error('引擎启动流程卡住（超过 ' + Math.round((timeoutMs * 2 + 30000) / 1000) + ' 秒）')), timeoutMs * 2 + 30000)
    })
    try {
      return await Promise.race([starting, watchdog])
    } finally {
      starting = null
    }
  }

  async function ensure() {
    if (status === 'ready' && socket) return hello
    log('[engine] ensure enter status=' + status)
    // 已经有一个在跑的引擎（例如插件宿主重启）时直接接管，避免重复提权。
    // 注意：连得上但不回应（僵尸引擎）也要当成过期，走 start() 里的 killStale。
    let found = { ok: false, reason: 'probe-failed' }
    try {
      found = await connectOnce(1500)
    } catch (err) {
      log('[engine] probe error: ' + err.message)
    }
    log('[engine] probe existing engine: ' + (found.ok ? 'found' : 'none(' + found.reason + ')'))
    if (found.ok) {
      attachSocket(found.sock)
      setStatus('ready')
      return hello
    }
    return start()
  }

  function call(cmd, params = {}, timeoutMs = 30000) {
    const run = () => {
      if (!socket || status !== 'ready') throw new Error('引擎未运行')
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending = null
          reject(new Error(`引擎命令超时: ${cmd}`))
        }, timeoutMs)
        pending = (msg) => {
          clearTimeout(timer)
          if (msg && msg.ok) resolve(msg.result)
          else reject(new Error((msg && msg.error) || '引擎命令失败'))
        }
        try {
          socket.write(JSON.stringify({ cmd, ...params }) + '\n')
        } catch (err) {
          clearTimeout(timer)
          pending = null
          reject(err)
        }
      })
    }
    const next = queue.then(run, run)
    queue = next.catch(() => {})
    return next
  }

  async function stop() {
    try {
      if (socket) await call('quit', {}, 3000)
    } catch {
      /* ignore */
    }
    try {
      socket?.destroy()
    } catch {
      /* ignore */
    }
    socket = null
    hello = null
    setStatus('off')
    await killStale()
  }

  return {
    ensure,
    start,
    stop,
    call,
    exePath,
    logFile,
    get status() {
      return status
    },
    get error() {
      return lastError
    },
    get hello() {
      return hello
    },
    info() {
      return {
        status,
        error: lastError,
        port,
        elevated: Boolean(hello && hello.elevated),
        integrity: hello?.integrity || '',
        pid: hello?.pid || 0,
        host: hello?.host || null,
        exe: exePath,
      }
    },
  }
}
