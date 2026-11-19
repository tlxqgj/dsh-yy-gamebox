import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

const EXE_SKIP = /^(unins\d*|setup|install|vc_?redist|xna|dxsetup|dxwebsetup|dotnet|crash|report|uninstall|steamerrorreporter|touchup|cleanup)/i
const EXE_SKIP_DIR = /(redist|_commonredist|directx|vcredist|support|installer|tools?)/i

function regValue(rootKey, name) {
  try {
    const out = execFileSync('reg', ['query', rootKey, '/v', name], { encoding: 'utf8', windowsHide: true, timeout: 8000 })
    const line = out.split(/\r?\n/).find((l) => l.includes('REG_SZ') || l.includes('REG_EXPAND_SZ'))
    if (!line) return ''
    const idx = line.indexOf(name)
    const rest = line.slice(idx + name.length).trim()
    const parts = rest.split(/\s{2,}/)
    return (parts[1] || '').trim()
  } catch {
    return ''
  }
}

const SKIP_DIR = /^(windows|windows\.old|programdata|\$recycle\.bin|system volume information|recovery|perflogs|node_modules|appdata|\.git|temp|tmp|users)$/i
const SKIP_SUB = /^(windows|windows\.old|programdata|\$recycle\.bin|system volume information|recovery|perflogs|node_modules|appdata)$/i

function isSteamRoot(dir) {
  try {
    return fs.existsSync(path.join(dir, 'steamapps', 'libraryfolders.vdf'))
  } catch {
    return false
  }
}

/** 在磁盘上找 Steam 根目录：常见位置优先，其次在固定盘做浅层搜索。 */
function discoverSteamRoots() {
  const roots = new Set()
  const push = (dir) => {
    if (!dir) return
    const resolved = path.resolve(String(dir).replace(/[\\/]+$/, ''))
    if (isSteamRoot(resolved)) roots.add(resolved)
  }

  const candidates = [
    ['HKCU\\Software\\Valve\\Steam', 'SteamPath'],
    ['HKLM\\SOFTWARE\\WOW6432Node\\Valve\\Steam', 'InstallPath'],
    ['HKLM\\SOFTWARE\\Valve\\Steam', 'InstallPath'],
  ]
  for (const [key, name] of candidates) {
    const value = regValue(key, name)
    if (value) push(value.replace(/\//g, '\\'))
  }

  for (const base of [process.env['ProgramFiles(x86)'], process.env.ProgramFiles, process.env.SystemDrive]) {
    if (base) push(path.join(base, 'Steam'))
  }

  const drives = []
  for (let code = 65; code <= 90; code += 1) {
    const letter = String.fromCharCode(code) + ':\\'
    try {
      if (fs.existsSync(letter)) drives.push(letter)
    } catch {
      /* ignore */
    }
  }

  for (const drive of drives) {
    push(path.join(drive, 'Steam'))
    push(path.join(drive, 'steam'))
    push(path.join(drive, 'Games', 'Steam'))
    push(path.join(drive, 'Program Files (x86)', 'Steam'))
  }

  if (!roots.size) {
    let visited = 0
    const walk = (dir, depth) => {
      if (depth > 2 || visited > 3000) return
      let entries
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true })
      } catch {
        return
      }
      for (const entry of entries) {
        if (!entry.isDirectory()) continue
        if (SKIP_DIR.test(entry.name) || SKIP_SUB.test(entry.name)) continue
        visited += 1
        const full = path.join(dir, entry.name)
        if (isSteamRoot(full)) {
          roots.add(full)
          continue
        }
        walk(full, depth + 1)
      }
    }
    for (const drive of drives) walk(drive, 0)
  }

  return [...roots]
}

function readText(file) {
  try {
    return fs.readFileSync(file, 'utf8')
  } catch {
    return ''
  }
}

function parseVdfPaths(text) {
  const out = []
  const re = /"path"\s*"([^"]+)"/gi
  let m
  while ((m = re.exec(text))) out.push(path.resolve(m[1].replace(/\/\//g, '\\').replace(/\//g, '\\')))
  return out
}

function parseAcf(text) {
  const get = (key) => {
    const m = new RegExp(`"${key}"\\s*"([^"]*)"`, 'i').exec(text)
    return m ? m[1] : ''
  }
  return { appid: Number(get('appid')) || 0, name: get('name'), installdir: get('installdir') }
}

function walkExes(dir, depth, found, budget) {
  if (depth < 0 || found.length >= budget) return
  let entries
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    if (found.length >= budget) return
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (EXE_SKIP_DIR.test(entry.name)) continue
      walkExes(full, depth - 1, found, budget)
    } else if (entry.isFile() && /\.exe$/i.test(entry.name)) {
      if (EXE_SKIP.test(entry.name)) continue
      if (EXE_SKIP_DIR.test(path.basename(dir))) continue
      let size = 0
      try {
        size = fs.statSync(full).size
      } catch {
        /* ignore */
      }
      if (size < 60 * 1024) continue
      found.push({ path: full, size })
    }
  }
}

function rankExes(list, hint) {
  const words = String(hint || '')
    .toLowerCase()
    .split(/[^a-z0-9\u4e00-\u9fa5]+/)
    .filter((w) => w.length >= 3)
  return list
    .map((item) => {
      const base = path.basename(item.path, '.exe').toLowerCase()
      let score = Math.log10(Math.max(item.size, 1))
      if (words.some((w) => base.includes(w))) score += 6
      if (/^(launcher|start|game|play|main)$/.test(base)) score += 2
      if (/launcher/i.test(base)) score -= 1
      return { ...item, score }
    })
    .sort((a, b) => b.score - a.score)
}

/** 扫描 Steam 库，返回候选游戏（含可执行文件候选）。 */
export function scanSteam({ maxGames = 200, maxExe = 10 } = {}) {
  const roots = discoverSteamRoots()
  const libraries = new Set(roots)
  for (const root of roots) {
    for (const lib of parseVdfPaths(readText(path.join(root, 'steamapps', 'libraryfolders.vdf')))) libraries.add(lib)
  }

  const games = []
  const seen = new Set()
  for (const lib of libraries) {
    const appsDir = path.join(lib, 'steamapps')
    let files = []
    try {
      files = fs.readdirSync(appsDir).filter((f) => /^appmanifest_\d+\.acf$/i.test(f))
    } catch {
      continue
    }
    for (const file of files) {
      if (games.length >= maxGames) break
      const info = parseAcf(readText(path.join(appsDir, file)))
      if (!info.name || !info.installdir) continue
      const key = `${info.appid}:${info.name}`
      if (seen.has(key)) continue
      seen.add(key)
      const dir = path.join(appsDir, 'common', info.installdir)
      if (!fs.existsSync(dir)) continue
      const exes = []
      walkExes(dir, 2, exes, 64)
      const ranked = rankExes(exes, info.installdir || info.name).slice(0, maxExe)
      games.push({
        appid: info.appid,
        name: info.name,
        dir,
        exe: ranked.length ? ranked[0].path : '',
        exes: ranked.map((item) => item.path),
      })
    }
  }
  games.sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN'))
  return { libraries: [...libraries], games }
}

/** 从分组文本里挑选一个可执行文件（用于「添加游戏」时只给了目录）。 */
export function findExeInDir(dir) {
  const exes = []
  walkExes(dir, 3, exes, 64)
  const ranked = rankExes(exes, path.basename(dir))
  return ranked.length ? ranked[0].path : ''
}
