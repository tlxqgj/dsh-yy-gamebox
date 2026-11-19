/**
 * yy 收纳箱 —— Host 半部
 *
 * 职责：
 *   · /yy-gamebox 前缀路由：收纳库、扫描、启动/停止、视口同步
 *   · 原生引擎（native/yybox.cs → bin/yybox.exe）：高权限常驻，负责收养游戏窗口、
 *     摆位到面板视口、去标题栏、隐藏/还原、结束进程
 *   · 6 个工具让模型也能操作收纳箱
 *
 * 关键设计：真正的 HWND 嵌入在 Electron + DirectComposition 上不可行（会被
 * Intermediate D3D Window 盖住），所以采用「owned window + 精确摆位」：把游戏窗口
 * 设成 Harness 主窗口的 owned window，再按面板视口矩形（客户区比例）摆放并裁掉标题栏，
 * 视觉上完全落在面板内，延迟等于原生渲染。
 */

import path from 'node:path'
import fs from 'node:fs'
import { createApi } from './lib/api.js'
import { createStore } from './lib/store.js'
import { createEngine } from './lib/engine.js'
import { dataDir, ensureDir, dirOfModule } from './lib/paths.js'

export const name = 'yy-gamebox'
export const inject = ['tools']

const here = dirOfModule(import.meta.url)
const text = (value) => [{ type: 'text', text: String(value) }]

export function apply(ctx, rawConfig = {}) {
  const dir = ensureDir(dataDir())
  const store = createStore(dir)
  const logLine = (line) => {
    const msg = '[' + new Date().toISOString() + ']' + line
    try {
      fs.appendFileSync(path.join(dir, 'plugin.log'), msg + '\n', 'utf8')
    } catch {
      /* 日志失败不影响主流程 */
    }
    console.log('[yy-gamebox]' + line)
  }
  const engine = createEngine({
    dataDir: dir,
    nativeDir: path.join(here, 'native'),
    log: logLine,
  })
  const api = createApi({ store, engine, log: logLine })

  // ── HTTP 路由 ──────────────────────────────────────────────
  // webServer 可能在插件 apply 时还没就绪（DSH 重启后尤其明显），
  // 所以这里轮询等待，而不是只尝试一次就放弃。
  ctx.effect(() => {
    let dispose = null
    let timer = null
    let tries = 0

    const attach = () => {
      timer = null
      const web = ctx.get ? ctx.get('webServer') : ctx.webServer
      if (!web) {
        tries += 1
        if (tries === 1 || tries % 20 === 0) logLine('[web] webServer 未就绪，继续等待（第 ' + tries + ' 次）')
        if (tries < 200) timer = setTimeout(attach, 300)
        return
      }
      logLine('[web] webServer 就绪，注册 /yy-gamebox')
      dispose = web.register({
        kind: 'prefix',
        path: '/yy-gamebox',
        handler: (req, res) => {
          const url = new URL(req.url || '/', 'http://127.0.0.1')
          api.handle(req, res, url).catch((err) => {
            console.error('[yy-gamebox] handler error', err)
            try {
              res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' })
              res.end(JSON.stringify({ ok: false, error: String(err && err.message ? err.message : err) }))
            } catch {
              /* ignore */
            }
          })
        },
      })
      logLine('[web] 路由已注册 path=/yy-gamebox')
    }

    attach()
    return () => {
      if (timer) clearTimeout(timer)
      if (typeof dispose === 'function') dispose()
    }
  })

  // ── 工具 ──────────────────────────────────────────────────
  const tools = [
    {
      name: 'yy_game_list',
      description: '列出 yy 收纳箱里已纳管的游戏（id、名称、可执行文件、是否需要管理员、上次运行时间）。',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
      output: { schema: { type: 'string' }, render: (_a, v) => text(v) },
      async execute() {
        const games = store.games()
        if (!games.length) return '收纳箱还是空的。用 yy_game_scan 扫描 Steam 库，或用 yy_game_add 添加可执行文件。'
        const lines = ['| id | 名称 | 可执行文件 | 需管理员 |', '| --- | --- | --- | --- |']
        for (const g of games) {
          lines.push(`| ${g.id} | ${g.name} | ${g.path} | ${g.needsAdmin ? '是' : '否'} |`)
        }
        return lines.join('\n')
      },
    },
    {
      name: 'yy_game_scan',
      description: '扫描本机 Steam 库，返回可添加的游戏（名称、appid、可执行文件）。只扫描不添加。',
      parameters: {
        type: 'object',
        properties: { add: { type: 'boolean', description: '为 true 时把扫描到的游戏直接加入收纳箱' } },
        additionalProperties: false,
      },
      output: { schema: { type: 'string' }, render: (_a, v) => text(v) },
      async execute(args) {
        const { scanSteam } = await import('./lib/scan.js')
        const result = scanSteam()
        if (!result.games.length) return '没有扫描到 Steam 游戏。'
        if (args && args.add) {
          let added = 0
          for (const g of result.games) {
            if (!g.exe) continue
            const res = store.add({ name: g.name, path: g.exe, source: 'steam', appid: g.appid })
            if (res.added) added++
          }
          return `扫描到 ${result.games.length} 个 Steam 游戏，已加入 ${added} 个。`
        }
        const lines = ['| 名称 | appid | 可执行文件 |', '| --- | --- | --- |']
        for (const g of result.games.slice(0, 60)) {
          lines.push(`| ${g.name} | ${g.appid} | ${g.exe || '（未找到 exe）'} |`)
        }
        lines.push('', `共 ${result.games.length} 个。用 yy_game_add 添加指定游戏。`)
        return lines.join('\n')
      },
    },
    {
      name: 'yy_game_add',
      description: '把一个游戏加入收纳箱。path 可以是 exe 文件，也可以是游戏目录（会自动查找主程序）。',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '可执行文件或游戏目录的绝对路径' },
          name: { type: 'string', description: '显示名称（可选）' },
          args: { type: 'string', description: '启动参数（可选）' },
        },
        required: ['path'],
        additionalProperties: false,
      },
      output: { schema: { type: 'string' }, render: (_a, v) => text(v) },
      async execute(args) {
        const { findExeInDir } = await import('./lib/scan.js')
        const fs = await import('node:fs')
        let target = String(args.path || '').trim().replace(/^"|"$/g, '')
        if (!target) return '缺少 path。'
        if (fs.existsSync(target) && fs.statSync(target).isDirectory()) target = findExeInDir(target)
        if (!target || !fs.existsSync(target)) return `找不到可执行文件：${target}`
        const result = store.add({
          name: args.name || path.basename(target, path.extname(target)),
          path: target,
          args: args.args || '',
          workdir: path.dirname(target),
        })
        return `${result.added ? '已加入' : '已更新'}：${result.game.name}（${result.game.id}）\n${result.game.path}`
      },
    },
    {
      name: 'yy_game_launch',
      description:
        '在收纳箱面板里启动一个游戏：首次需要授权时会弹出一次 UAC 确认；游戏窗口会被收进面板视口。frac 为视口占 Harness 客户区的比例 [x,y,w,h]，默认取面板当前值。',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: '游戏 id（yy_game_list 可得）' },
          frac: { type: 'array', items: { type: 'number' }, minItems: 4, maxItems: 4, description: '视口比例 [x,y,w,h]' },
          admin: { type: 'boolean', description: '强制以管理员权限启动（默认按游戏记录或自动判断）' },
        },
        required: ['id'],
        additionalProperties: false,
      },
      output: { schema: { type: 'string' }, render: (_a, v) => text(v) },
      async execute(args) {
        const state = await api.launch({ id: String(args.id || ''), frac: args.frac, admin: Boolean(args.admin) })
        const s = state.session
        return `已在面板中启动：${s.name}\npid=${s.pid} hwnd=0x${Number(s.hwnd).toString(16)}\n引擎：${state.engine.status}（elevated=${state.engine.elevated}）`
      },
    },
    {
      name: 'yy_game_stop',
      description: '停止当前在面板里运行的游戏（结束进程并还原窗口样式）。',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
      output: { schema: { type: 'string' }, render: (_a, v) => text(v) },
      async execute() {
        const state = await api.stopGame()
        return state.session ? '已停止。' : '当前没有运行中的游戏。'
      },
    },
    {
      name: 'yy_game_status',
      description: '查看收纳箱状态：原生引擎是否在运行、是否拥有管理员权限、当前运行的游戏与视口比例。',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
      output: { schema: { type: 'string' }, render: (_a, v) => text(v) },
      async execute() {
        const state = api.snapshot()
        const lines = [
          `引擎：${state.engine.status}${state.engine.elevated ? '（管理员）' : ''}${state.engine.error ? ' · ' + state.engine.error : ''}`,
          `引擎 pid：${state.engine.pid || '—'}`,
          `视口：${state.viewport.width}×${state.viewport.height}（${state.viewport.preset}）`,
          `游戏数量：${state.games.length}`,
        ]
        if (state.session) {
          lines.push(`运行中：${state.session.name} · pid=${state.session.pid} · frac=[${state.session.frac.join(', ')}]`)
        } else {
          lines.push('运行中：—')
        }
        return lines.join('\n')
      },
    },
  ]

  ctx.effect(() => {
    const offs = tools.map((tool) => ctx.tools.register(tool))
    return () => {
      for (const off of offs) {
        try {
          off?.()
        } catch {
          /* ignore */
        }
      }
    }
  })

  // 卸载清理：结束当前游戏会话，但**保留常驻引擎进程**。
  // 重载插件时若把引擎一起杀掉，下次启动又要用户点一次 UAC；
  // 引擎自身会在 Harness 主窗口消失后自动退出（Watch 循环）。
  ctx.effect(() => () => {
    try {
      api.endSession('插件已卸载')
    } catch {
      /* ignore */
    }
  })
}
