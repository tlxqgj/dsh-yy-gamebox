window.__ModuleLoader__.load({
  id: '@local/yy-gamebox',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const { useState, useEffect, useCallback, useRef, useMemo } = React;

    const API = '/yy-gamebox';

    /* ------------------------------------------------------------ 文案 */

    const ZH = {
      'nav.label': '收纳箱',
      'page.title': '游戏收纳箱',
      'page.subtitle': '把本机游戏收进面板里跑 · 原生渲染，无额外窗口',
      'engine.off': '引擎未启动',
      'engine.starting': '引擎启动中…',
      'engine.ready': '引擎已就绪',
      'engine.denied': '授权被取消',
      'engine.error': '引擎异常',
      'engine.start': '启动引擎',
      'engine.stop': '停止引擎',
      'engine.hint': '首次启动会弹出一次管理员确认，之后不再询问。',
      'view.title': '视口',
      'view.size': '显示尺寸',
      'view.custom': '自定义',
      'view.chrome': '隐藏游戏标题栏',
      'view.fill': '铺满',
      'library.title': '游戏库',
      'library.count': '款游戏',
      'library.empty': '还没有收纳任何游戏',
      'library.emptyHint': '扫描本机 Steam 库，或直接添加游戏的可执行文件。',
      'library.scan': '扫描 Steam',
      'library.add': '添加游戏',
      'library.remove': '移除',
      'library.run': '开始',
      'library.admin': '需管理员',
      'library.lastRun': '上次运行',
      'library.never': '未运行',
      'library.search': '搜索游戏',
      'add.title': '添加游戏',
      'add.path': '可执行文件或游戏目录',
      'add.pathPh': 'D:\\Games\\SomeGame\\game.exe',
      'add.name': '显示名称（可选）',
      'add.ok': '添加',
      'add.cancel': '取消',
      'add.bad': '路径无效或找不到可执行文件',
      'scan.title': 'Steam 游戏库',
      'scan.loading': '正在扫描 Steam 库…',
      'scan.none': '没有扫描到可安装的游戏',
      'scan.addSelected': '添加所选',
      'scan.selectAll': '全选',
      'scan.noExe': '未找到主程序',
      'run.waiting': '正在等待管理员确认…',
      'run.launching': '正在启动游戏…',
      'run.needsAdmin': '这个游戏需要管理员权限。点「以管理员身份启动」会弹出一次系统确认。',
      'run.asAdmin': '以管理员身份启动',
      'run.stop': '停止游戏',
      'run.viewport': '拖动或调整窗口大小时，游戏画面会跟着面板视口走。',
      'run.error': '启动失败',
      'stage.label': '游戏视口',
      'stage.hint': '启动游戏后，画面会出现在这块区域',
      'toast.removed': '已移除',
      'toast.added': '已添加',
      'toast.stopped': '已停止',
      'common.close': '关闭',
      'common.retry': '重试',
    };

    const EN = {
      'nav.label': 'Game Box',
      'page.title': 'Game Box',
      'page.subtitle': 'Play desktop games inside the panel · native rendering, no extra windows',
      'engine.off': 'Engine off',
      'engine.starting': 'Starting engine…',
      'engine.ready': 'Engine ready',
      'engine.denied': 'Elevation cancelled',
      'engine.error': 'Engine error',
      'engine.start': 'Start engine',
      'engine.stop': 'Stop engine',
      'engine.hint': 'One administrator prompt on first start, never again.',
      'view.title': 'Viewport',
      'view.size': 'Size',
      'view.custom': 'Custom',
      'view.chrome': 'Hide game title bar',
      'view.fill': 'Fill',
      'library.title': 'Library',
      'library.count': 'games',
      'library.empty': 'No games yet',
      'library.emptyHint': 'Scan your Steam library or add an executable.',
      'library.scan': 'Scan Steam',
      'library.add': 'Add game',
      'library.remove': 'Remove',
      'library.run': 'Play',
      'library.admin': 'Needs admin',
      'library.lastRun': 'Last played',
      'library.never': 'never',
      'library.search': 'Search',
      'add.title': 'Add game',
      'add.path': 'Executable or game folder',
      'add.ok': 'Add',
      'add.cancel': 'Cancel',
      'add.bad': 'Invalid path or no executable found',
      'scan.title': 'Steam library',
      'scan.loading': 'Scanning Steam…',
      'scan.none': 'No games found',
      'scan.addSelected': 'Add selected',
      'scan.selectAll': 'Select all',
      'scan.noExe': 'no executable',
      'run.waiting': 'Waiting for administrator approval…',
      'run.launching': 'Launching…',
      'run.needsAdmin': 'This game needs administrator rights. One system prompt will appear.',
      'run.asAdmin': 'Launch as administrator',
      'run.stop': 'Stop',
      'run.viewport': 'Move or resize the window and the game follows the viewport.',
      'run.error': 'Launch failed',
      'stage.label': 'Game viewport',
      'stage.hint': 'The game will appear here',
      'common.close': 'Close',
      'common.retry': 'Retry',
    };

    const DICTS = { zh: ZH, en: EN };

    const makeT = (ctx) => {
      const locale = (() => {
        try {
          return ctx.get ? ctx.get('locale') : undefined;
        } catch {
          return undefined;
        }
      })();
      const lang = () => {
        try {
          const active = locale?.getLocale?.().active || 'zh';
          return /^zh/i.test(active) ? 'zh' : 'en';
        } catch {
          return 'zh';
        }
      };
      return (key) => DICTS[lang()][key] ?? ZH[key] ?? key;
    };

    /* ------------------------------------------------------------ 样式 */

    const CSS = `
.yyg-page { height: 100%; overflow: auto; padding: 24px 28px 48px; box-sizing: border-box;
  color: var(--dsw-alias-label-primary); font-size: 13.5px; line-height: 1.55;
  font-family: var(--dsw-font-family, -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif); }
.yyg-wrap { max-width: 1180px; margin: 0 auto; }
.yyg-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; flex-wrap: wrap; }
.yyg-title { font-size: 19px; font-weight: 650; letter-spacing: .2px; margin: 0; }
.yyg-sub { margin: 4px 0 0; font-size: 12.5px; color: var(--dsw-alias-label-secondary, #98a3b3); }
.yyg-head-right { display: flex; align-items: center; gap: 8px; padding-top: 2px; }
.yyg-pill { display: inline-flex; align-items: center; gap: 6px; height: 28px; padding: 0 10px;
  border-radius: 999px; font-size: 12px; border: 1px solid var(--dsw-alias-line, rgba(255,255,255,.1));
  background: var(--dsw-alias-bg-secondary, rgba(255,255,255,.04)); color: var(--dsw-alias-label-secondary, #9aa5b5); }
.yyg-pill.is-ready { color: #7ee0a8; border-color: rgba(126,224,168,.35); background: rgba(126,224,168,.1); }
.yyg-pill.is-warn { color: #ffc46b; border-color: rgba(255,196,107,.35); background: rgba(255,196,107,.1); }
.yyg-pill.is-bad { color: #ff8b8b; border-color: rgba(255,139,139,.35); background: rgba(255,139,139,.1); }
.yyg-dot { width: 6px; height: 6px; border-radius: 50%; background: currentColor; box-shadow: 0 0 8px currentColor; }
.yyg-btn { display: inline-flex; align-items: center; justify-content: center; gap: 6px;
  height: 30px; padding: 0 12px; border-radius: 9px; cursor: pointer; font-size: 12.5px;
  border: 1px solid var(--dsw-alias-line, rgba(255,255,255,.12));
  background: var(--dsw-alias-bg-secondary, rgba(255,255,255,.04));
  color: var(--dsw-alias-label-primary); transition: background .15s, border-color .15s, transform .1s; }
.yyg-btn:hover { background: var(--dsw-alias-bg-tertiary, rgba(255,255,255,.09)); }
.yyg-btn:active { transform: translateY(1px); }
.yyg-btn[disabled] { opacity: .5; cursor: default; }
.yyg-btn.is-primary { background: linear-gradient(135deg, #6b8cff, #8a63ff); border-color: transparent; color: #fff; }
.yyg-btn.is-primary:hover { filter: brightness(1.08); }
.yyg-btn.is-ghost { background: transparent; }
.yyg-btn.is-danger { color: #ff9b9b; border-color: rgba(255,120,120,.3); }

.yyg-panel { margin-top: 18px; border-radius: 14px; border: 1px solid var(--dsw-alias-line, rgba(255,255,255,.09));
  background: var(--dsw-alias-bg-secondary, rgba(255,255,255,.03)); overflow: hidden; }
.yyg-panel-head { display: flex; align-items: center; justify-content: space-between; gap: 12px;
  padding: 12px 14px; border-bottom: 1px solid var(--dsw-alias-line, rgba(255,255,255,.07)); flex-wrap: wrap; }
.yyg-panel-title { font-size: 13px; font-weight: 600; display: flex; align-items: center; gap: 8px; }
.yyg-count { font-size: 11.5px; color: var(--dsw-alias-label-secondary, #98a3b3); font-weight: 400; }
.yyg-tools { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.yyg-input { height: 28px; padding: 0 9px; border-radius: 8px; font-size: 12.5px; color: var(--dsw-alias-label-primary);
  border: 1px solid var(--dsw-alias-line, rgba(255,255,255,.12)); background: var(--dsw-alias-bg-primary, rgba(0,0,0,.2)); outline: none; }
.yyg-input:focus { border-color: rgba(120,150,255,.6); }
.yyg-input.is-num { width: 62px; text-align: center; }
.yyg-sep { width: 1px; height: 18px; background: var(--dsw-alias-line, rgba(255,255,255,.1)); }
.yyg-seg { display: inline-flex; padding: 2px; gap: 2px; border-radius: 9px; background: rgba(255,255,255,.05); }
.yyg-seg button { height: 24px; padding: 0 9px; border: none; border-radius: 7px; background: transparent; cursor: pointer;
  font-size: 12px; color: var(--dsw-alias-label-secondary, #9aa5b5); }
.yyg-seg button.is-on { background: rgba(255,255,255,.13); color: var(--dsw-alias-label-primary); }
.yyg-check { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; color: var(--dsw-alias-label-secondary, #9aa5b5); cursor: pointer; }
.yyg-check input { accent-color: #7b8cff; }

.yyg-stage-wrap { position: relative; display: flex; align-items: center; justify-content: center;
  padding: 18px; min-height: 320px; overflow: auto; background:
    radial-gradient(120% 90% at 50% 0%, rgba(110,130,255,.13), transparent 62%),
    repeating-linear-gradient(45deg, rgba(255,255,255,.022) 0 2px, transparent 2px 12px); }
.yyg-stage { position: relative; border-radius: 10px; overflow: hidden;
  border: 1px dashed rgba(140,160,255,.45); background: rgba(10,14,26,.55);
  box-shadow: 0 18px 60px rgba(0,0,0,.35), inset 0 0 0 1px rgba(255,255,255,.04); }
.yyg-stage.is-native { border: 0; border-radius: 0; background: transparent; box-shadow: none; }
.yyg-stage.is-live { border-style: solid; border-color: rgba(140,160,255,.75); }
.yyg-stage-label { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center;
  justify-content: center; gap: 8px; color: rgba(200,210,235,.55); font-size: 12.5px; pointer-events: none; }
.yyg-stage-ico { width: 46px; height: 46px; border-radius: 13px; display: grid; place-items: center;
  background: linear-gradient(135deg, rgba(107,140,255,.35), rgba(138,99,255,.28)); color: #cfd8ff; }

.yyg-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(228px, 1fr)); gap: 12px; padding: 14px; }
.yyg-card { position: relative; border-radius: 12px; overflow: hidden; cursor: pointer;
  border: 1px solid var(--dsw-alias-line, rgba(255,255,255,.08));
  background: var(--dsw-alias-bg-primary, rgba(255,255,255,.02)); transition: transform .14s, border-color .14s, box-shadow .14s; }
.yyg-card:hover { transform: translateY(-2px); border-color: rgba(140,160,255,.5); box-shadow: 0 10px 30px rgba(0,0,0,.3); }
.yyg-cover { position: relative; aspect-ratio: 460 / 215; background-size: cover; background-position: center;
  display: grid; place-items: center; color: #e8edff; }
.yyg-cover-fallback { font-size: 30px; font-weight: 700; letter-spacing: 2px; opacity: .9; }
.yyg-cover-shade { position: absolute; inset: 0; background: linear-gradient(180deg, transparent 35%, rgba(6,10,20,.82)); }
.yyg-card-body { position: absolute; left: 0; right: 0; bottom: 0; padding: 8px 10px 9px; }
.yyg-card-name { font-size: 13px; font-weight: 600; color: #f2f5ff; text-shadow: 0 1px 6px rgba(0,0,0,.6);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.yyg-card-meta { display: flex; align-items: center; gap: 6px; font-size: 11px; color: rgba(225,232,250,.72); margin-top: 2px; }
.yyg-badge { padding: 0 5px; border-radius: 4px; background: rgba(255,196,107,.18); color: #ffcf85; font-size: 10.5px; }
.yyg-card-actions { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; gap: 8px;
  opacity: 0; transition: opacity .14s; background: rgba(8,12,22,.45); backdrop-filter: blur(1px); }
.yyg-card:hover .yyg-card-actions { opacity: 1; }
.yyg-icon-btn { width: 30px; height: 30px; border-radius: 9px; display: grid; place-items: center; cursor: pointer;
  border: 1px solid rgba(255,255,255,.22); background: rgba(20,26,44,.72); color: #e6ecff; }
.yyg-icon-btn:hover { background: rgba(60,70,110,.85); }
.yyg-icon-btn.is-danger:hover { background: rgba(150,40,40,.85); }

.yyg-empty { padding: 42px 24px 46px; text-align: center; }
.yyg-empty-title { font-size: 14.5px; font-weight: 600; margin: 12px 0 4px; }
.yyg-empty-hint { font-size: 12.5px; color: var(--dsw-alias-label-secondary, #98a3b3); margin-bottom: 16px; }
.yyg-empty-actions { display: flex; gap: 10px; justify-content: center; }

.yyg-runbar { display: flex; align-items: center; justify-content: space-between; gap: 12px;
  padding: 10px 14px; border-top: 1px solid var(--dsw-alias-line, rgba(255,255,255,.07)); flex-wrap: wrap; }
.yyg-run-name { display: flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 600; }
.yyg-live { width: 7px; height: 7px; border-radius: 50%; background: #6ee7a0; box-shadow: 0 0 10px #6ee7a0; animation: yyg-pulse 1.6s infinite; }
@keyframes yyg-pulse { 0%,100% { opacity: 1 } 50% { opacity: .45 } }
.yyg-run-hint { font-size: 11.5px; color: var(--dsw-alias-label-secondary, #98a3b3); }

.yyg-modal-mask { position: fixed; inset: 0; z-index: 60; display: grid; place-items: center;
  background: rgba(4,7,14,.62); backdrop-filter: blur(3px); }
.yyg-modal { width: min(620px, 92vw); max-height: 82vh; display: flex; flex-direction: column;
  border-radius: 16px; border: 1px solid rgba(255,255,255,.12); background: #12161f;
  box-shadow: 0 30px 90px rgba(0,0,0,.6); overflow: hidden; }
.yyg-modal-head { display: flex; align-items: center; justify-content: space-between; padding: 14px 16px;
  border-bottom: 1px solid rgba(255,255,255,.08); font-size: 13.5px; font-weight: 600; }
.yyg-modal-body { padding: 14px 16px; overflow: auto; }
.yyg-modal-foot { display: flex; justify-content: flex-end; gap: 8px; padding: 12px 16px;
  border-top: 1px solid rgba(255,255,255,.08); }
.yyg-field { margin-bottom: 12px; }
.yyg-field label { display: block; font-size: 12px; color: var(--dsw-alias-label-secondary, #98a3b3); margin-bottom: 6px; }
.yyg-field .yyg-input { width: 100%; height: 32px; box-sizing: border-box; }
.yyg-scan-row { display: flex; align-items: center; gap: 10px; padding: 8px 6px; border-radius: 8px; cursor: pointer; }
.yyg-scan-row:hover { background: rgba(255,255,255,.045); }
.yyg-scan-name { font-size: 13px; }
.yyg-scan-path { font-size: 11px; color: var(--dsw-alias-label-secondary, #8b96a8); word-break: break-all; }
.yyg-toast { position: fixed; left: 50%; bottom: 28px; transform: translateX(-50%); z-index: 70;
  padding: 9px 16px; border-radius: 10px; font-size: 12.5px; color: #eaf0ff;
  background: rgba(30,38,58,.96); border: 1px solid rgba(255,255,255,.14); box-shadow: 0 12px 40px rgba(0,0,0,.45); }
.yyg-toast.is-bad { color: #ffd2d2; border-color: rgba(255,120,120,.4); }
.yyg-loading { display: flex; align-items: center; gap: 8px; font-size: 12.5px; color: var(--dsw-alias-label-secondary, #98a3b3); padding: 18px; }
.yyg-spin { width: 14px; height: 14px; border-radius: 50%; border: 2px solid rgba(255,255,255,.2);
  border-top-color: #8fa3ff; animation: yyg-rot .8s linear infinite; }
@keyframes yyg-rot { to { transform: rotate(360deg) } }
`;

    /* ------------------------------------------------------------ 视口预设 */

    const PRESETS = [
      { id: '16:9', label: '16:9', width: 960, height: 540 },
      { id: '16:10', label: '16:10', width: 960, height: 600 },
      { id: '4:3', label: '4:3', width: 800, height: 600 },
      { id: '21:9', label: '21:9', width: 1120, height: 480 },
      { id: 'fill', label: 'fill', width: 0, height: 0 },
    ];

    const api = {
      async get(path) {
        const res = await fetch(API + path, { headers: { accept: 'application/json' } });
        const body = await res.json().catch(() => ({}));
        if (!res.ok || body.ok === false) throw new Error(body.error || 'HTTP ' + res.status);
        return body;
      },
      async post(path, payload) {
        const res = await fetch(API + path, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload || {}),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok || body.ok === false) {
          const err = new Error(body.error || 'HTTP ' + res.status);
          err.needsAdmin = Boolean(body.needsAdmin);
          err.state = body.state;
          throw err;
        }
        return body;
      },
    };

    const fmtAgo = (ts, t) => {
      if (!ts) return t('library.never');
      const mins = Math.round((Date.now() - ts) / 60000);
      if (mins < 1) return '刚刚';
      if (mins < 60) return mins + ' 分钟前';
      const hours = Math.round(mins / 60);
      if (hours < 24) return hours + ' 小时前';
      return Math.round(hours / 24) + ' 天前';
    };

    const coverStyle = (game) => {
      if (game.appid) {
        return {
          backgroundImage:
            'url(https://cdn.cloudflare.steamstatic.com/steam/apps/' + game.appid + '/header.jpg), linear-gradient(135deg,#2a3550,#1b2236)',
        };
      }
      return { backgroundImage: 'linear-gradient(135deg,#2c3350,#20263a)' };
    };

    const initialOf = (name) => {
      const text = String(name || '?').replace(/[^\p{L}\p{N}]/gu, '');
      return (text.slice(0, 2) || '?').toUpperCase();
    };

    /* ------------------------------------------------------------ 图标 */

    const Icon = ({ d, size = 16, stroke = 1.8 }) =>
      h(
        'svg',
        { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: stroke, strokeLinecap: 'round', strokeLinejoin: 'round' },
        h('path', { d }),
      );

    const ICONS = {
      play: 'M8 5.5v13l10-6.5-10-6.5z',
      stop: 'M7 7h10v10H7z',
      plus: 'M12 5v14M5 12h14',
      scan: 'M4 7V5a1 1 0 011-1h2M20 7V5a1 1 0 00-1-1h-2M4 17v2a1 1 0 001 1h2M20 17v2a1 1 0 01-1 1h-2M4 12h16',
      trash: 'M4 7h16M9 7V5a1 1 0 011-1h4a1 1 0 011 1v2M6 7l1 12a2 2 0 002 2h6a2 2 0 002-2l1-12',
      close: 'M6 6l12 12M18 6L6 18',
      pad: 'M7 11h2M8 10v2M15 11h.01M17 12.5h.01M6 8h12a3 3 0 013 3v3a3 3 0 01-3 3h-1.5l-2-2h-5l-2 2H6a3 3 0 01-3-3v-3a3 3 0 013-3z',
      grid: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
      bolt: 'M13 2L4 14h6l-1 8 9-12h-6l1-8z',
      monitor: 'M4 5h16v10H4zM9 19h6M12 15v4',
    };

    /* ------------------------------------------------------------ 组件 */

    function EnginePill({ engine, t }) {
      const map = {
        off: ['is-bad', t('engine.off')],
        starting: ['is-warn', t('engine.starting')],
        ready: ['is-ready', t('engine.ready')],
        denied: ['is-bad', t('engine.denied')],
        error: ['is-bad', t('engine.error')],
      };
      const [cls, label] = map[engine.status] || map.off;
      return h(
        'span',
        { className: 'yyg-pill ' + cls, title: engine.error || engine.host ? engine.error || '' : '' },
        h('span', { className: 'yyg-dot' }),
        label,
        engine.status === 'ready' && engine.elevated ? h('span', { style: { opacity: 0.6 } }, '· 管理员') : null,
      );
    }

    function Stage({ viewport, running, stageRef, configured, native, fixed, t }) {
      const box = useMemo(() => {
        // 计算可用区域，按需等比缩小配置尺寸
        const availW = Math.max(280, window.innerWidth - 360);
        const availH = Math.max(220, window.innerHeight - 420);
        let w = configured.width;
        let h = configured.height;
        if (configured.preset === 'fill') {
          w = availW;
          h = availH;
        }
        // 只有真·固定尺寸的游戏（拒绝改大小，如 KOF'97）才按它自己的尺寸摆，1:1 不裁剪；
        // 能改大小的游戏一律按用户选的视口尺寸走，由引擎把窗口拉成这么大 —— 这就是「适配画板」
        const dpr = window.devicePixelRatio || 1;
        const isNative = Boolean(fixed && native && native.w > 40 && native.h > 40);
        if (isNative) {
          w = native.w / dpr;
          h = native.h / dpr;
        }
        const k = isNative ? 1 : Math.min(1, availW / Math.max(w, 1), availH / Math.max(h, 1));
        return { width: Math.round(w * k), height: Math.round(h * k), isNative };
      }, [configured.width, configured.height, configured.preset, viewport.epoch, fixed, native && native.w, native && native.h]);

      return h(
        'div',
        { className: 'yyg-stage-wrap' },
        h(
          'div',
          {
            ref: stageRef,
            className: 'yyg-stage' + (running ? ' is-live' : '') + (box.isNative ? ' is-native' : ''),
            style: { width: box.width + 'px', height: box.height + 'px' },
          },
          running
            ? null
            : h(
                'div',
                { className: 'yyg-stage-label' },
                h('div', { className: 'yyg-stage-ico' }, h(Icon, { d: ICONS.monitor, size: 22 })),
                h('div', null, t('stage.hint')),
              ),
        ),
      );
    }

    function GameCard({ game, onPlay, onRemove, t }) {
      return h(
        'div',
        { className: 'yyg-card', onClick: () => onPlay(game) },
        h(
          'div',
          { className: 'yyg-cover', style: coverStyle(game) },
          h('div', { className: 'yyg-cover-fallback' }, initialOf(game.name)),
          h('div', { className: 'yyg-cover-shade' }),
        ),
        h(
          'div',
          { className: 'yyg-card-body' },
          h('div', { className: 'yyg-card-name', title: game.path }, game.name),
          h(
            'div',
            { className: 'yyg-card-meta' },
            game.needsAdmin ? h('span', { className: 'yyg-badge' }, t('library.admin')) : null,
            h('span', null, t('library.lastRun') + ' ' + fmtAgo(game.lastRun, t)),
          ),
        ),
        h(
          'div',
          { className: 'yyg-card-actions' },
          h(
            'div',
            { className: 'yyg-icon-btn', title: t('library.run') },
            h(Icon, { d: ICONS.play, size: 15 }),
          ),
          h(
            'div',
            {
              className: 'yyg-icon-btn is-danger',
              title: t('library.remove'),
              onClick: (e) => {
                e.stopPropagation();
                onRemove(game);
              },
            },
            h(Icon, { d: ICONS.trash, size: 15 }),
          ),
        ),
      );
    }

    function Modal({ title, children, footer, onClose }) {
      return h(
        'div',
        { className: 'yyg-modal-mask', onClick: onClose },
        h(
          'div',
          { className: 'yyg-modal', onClick: (e) => e.stopPropagation() },
          h(
            'div',
            { className: 'yyg-modal-head' },
            h('span', null, title),
            h('div', { className: 'yyg-icon-btn', onClick: onClose }, h(Icon, { d: ICONS.close, size: 14 })),
          ),
          h('div', { className: 'yyg-modal-body' }, children),
          footer ? h('div', { className: 'yyg-modal-foot' }, footer) : null,
        ),
      );
    }

    function GameBoxPage(props) {
      const { t } = props;
      const [state, setState] = useState(null);
      const [busy, setBusy] = useState('');
      const [toast, setToast] = useState(null);
      const [showAdd, setShowAdd] = useState(false);
      const [addPath, setAddPath] = useState('');
      const [showScan, setShowScan] = useState(false);
      const [scanning, setScanning] = useState(false);
      const [scanList, setScanList] = useState([]);
      const [picked, setPicked] = useState({});
      const [query, setQuery] = useState('');
      const [askAdmin, setAskAdmin] = useState(null);
      const [error, setError] = useState('');
      const [epoch, setEpoch] = useState(0);
      const stageRef = useRef(null);
      const lastFrac = useRef('');
      const running = Boolean(state?.session && state.session.phase === 'running');

      const flash = useCallback((msg, bad) => {
        setToast({ msg, bad });
        setTimeout(() => setToast(null), 2600);
      }, []);

      const refresh = useCallback(async () => {
        try {
          const next = await api.get('/api/state');
          setState(next);
          return next;
        } catch (err) {
          setError(String(err.message || err));
          return null;
        }
      }, []);

      useEffect(() => {
        refresh();
        const timer = setInterval(refresh, 2500);
        return () => clearInterval(timer);
      }, [refresh]);

      /* —— 视口同步：把舞台在窗口中的比例告诉原生引擎 —— */
      const syncFrac = useCallback(async () => {
        const el = stageRef.current;
        if (!el) return;
        const rect = el.getBoundingClientRect();
        const w = window.innerWidth || 1;
        const h = window.innerHeight || 1;
        const frac = [rect.left / w, rect.top / h, rect.width / w, rect.height / h].map((n) => Math.round(n * 10000) / 10000);
        const key = frac.join(',');
        if (key === lastFrac.current) return;
        lastFrac.current = key;
        try {
          await api.post('/api/viewport', { frac });
        } catch {
          /* 面板不可见时忽略 */
        }
      }, []);

      useEffect(() => {
        if (running) syncFrac();
      }, [running, syncFrac, state?.session?.hwnd, state?.session?.native?.w, state?.session?.native?.h]);

      /* —— 面板可见性：舞台真正出现在屏幕上才让原生窗口显示 —— */
      useEffect(() => {
        let lastShown = null;
        const tick = async () => {
          const el = stageRef.current;
          if (!el) return;
          const rect = el.getBoundingClientRect();
          const vh = window.innerHeight || 1;
          let css = true;
          try {
            css = el.checkVisibility ? el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }) : true;
          } catch {
            css = true;
          }
          // 切到别的插件页面时，舞台往往只是被盖住（仍然是 visible、尺寸也不为 0），
          // 所以再确认一次舞台中心是不是真的露在最上面。
          let covered = false;
          let hitInfo = '';
          try {
            const cx = rect.left + rect.width / 2;
            const cy = rect.top + rect.height / 2;
            const hit = document.elementFromPoint(cx, cy);
            covered = !hit || !(hit === el || el.contains(hit));
            const any = document.elementsFromPoint ? document.elementsFromPoint(cx, cy).slice(0, 4) : [];
            hitInfo = (hit ? (hit.tagName || '?') + '.' + String(hit.className || '').slice(0, 40) : 'null') + ' | ' + any.map((n) => (n.tagName || '?') + '.' + String(n.className || '').slice(0, 28)).join(' > ');
          } catch {
            covered = false;
          }
          const vis = document.visibilityState === 'visible' && css && !covered && rect.width > 120 && rect.height > 80 && rect.top < vh && rect.bottom > 0;
          if (vis !== lastShown) {
            lastShown = vis;
            lastFrac.current = '';
            fetch(API + '/api/show', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ on: vis, dbg: { css, covered, w: Math.round(rect.width), h: Math.round(rect.height), top: Math.round(rect.top), hit: hitInfo } }),
            }).catch(() => {});
          }
          if (vis) syncFrac();
        };
        const timer = setInterval(tick, 900);
        tick();
        const onResize = () => {
          setEpoch((n) => n + 1);
          tick();
        };
        window.addEventListener('resize', onResize);
        document.addEventListener('visibilitychange', tick);
        return () => {
          clearInterval(timer);
          window.removeEventListener('resize', onResize);
          document.removeEventListener('visibilitychange', tick);
          fetch(API + '/api/show', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ on: false }),
          }).catch(() => {});
        };
      }, [syncFrac]);

      const startEngine = async () => {
        setBusy('engine');
        setError('');
        try {
          await api.post('/api/engine/start');
          await refresh();
        } catch (err) {
          setError(String(err.message || err));
          await refresh();
        } finally {
          setBusy('');
        }
      };

      const stopEngine = async () => {
        setBusy('engine');
        try {
          await api.post('/api/engine/stop');
          await refresh();
        } finally {
          setBusy('');
        }
      };

      const launch = async (game, admin) => {
        setAskAdmin(null);
        setBusy('game');
        setError('');
        const el = stageRef.current;
        let frac;
        if (el) {
          const rect = el.getBoundingClientRect();
          const w = window.innerWidth || 1;
          const h = window.innerHeight || 1;
          frac = [rect.left / w, rect.top / h, rect.width / w, rect.height / h];
        }
        try {
          const res = await api.post('/api/launch', { id: game.id, frac, admin: Boolean(admin) });
          setState(res);
          setBusy('');
          setTimeout(syncFrac, 300);
        } catch (err) {
          setBusy('');
          if (err.needsAdmin) {
            setAskAdmin(game);
            await refresh();
            return;
          }
          setError(String(err.message || err));
          flash(t('run.error') + '：' + String(err.message || err), true);
          await refresh();
        }
      };

      const stopGame = async () => {
        setBusy('game');
        try {
          const res = await api.post('/api/stop');
          setState(res);
          flash(t('toast.stopped'));
        } catch (err) {
          setError(String(err.message || err));
        } finally {
          setBusy('');
        }
      };

      const removeGame = async (game) => {
        try {
          await api.post('/api/games/remove', { id: game.id });
          flash(t('toast.removed'));
          refresh();
        } catch (err) {
          setError(String(err.message || err));
        }
      };

      const doAdd = async () => {
        if (!addPath.trim()) return;
        try {
          await api.post('/api/games/add', { path: addPath.trim() });
          setShowAdd(false);
          setAddPath('');
          flash(t('toast.added'));
          refresh();
        } catch (err) {
          setError(t('add.bad') + '：' + String(err.message || err));
        }
      };

      const doScan = async () => {
        setShowScan(true);
        setScanning(true);
        try {
          const res = await api.post('/api/scan');
          setScanList(res.games || []);
          const init = {};
          for (const g of res.games || []) if (g.exe) init[g.name] = false;
          setPicked(init);
        } catch (err) {
          setError(String(err.message || err));
          setScanList([]);
        } finally {
          setScanning(false);
        }
      };

      const addPicked = async () => {
        const list = scanList.filter((g) => picked[g.name] && g.exe);
        for (const g of list) {
          try {
            await api.post('/api/games/add', { path: g.exe, name: g.name, source: 'steam', appid: g.appid });
          } catch {
            /* 单个失败不影响其它 */
          }
        }
        setShowScan(false);
        flash(t('toast.added') + ' ×' + list.length);
        refresh();
      };

      const viewport = state?.viewport || { width: 960, height: 540, preset: '16:9', chrome: true };
      const games = (state?.games || []).filter((g) => {
        if (!query.trim()) return true;
        const q = query.trim().toLowerCase();
        return g.name.toLowerCase().includes(q) || g.path.toLowerCase().includes(q);
      });
      const session = state?.session;

      const setViewport = async (patch) => {
        try {
          const res = await api.post('/api/viewport', { viewport: patch, frac: undefined });
          setState((prev) => (prev ? { ...prev, viewport: res.viewport } : prev));
          setEpoch((n) => n + 1);
          setTimeout(syncFrac, 120);
        } catch (err) {
          setError(String(err.message || err));
        }
      };

      const engine = state?.engine || { status: 'off', elevated: false, pid: 0 };

      return h(
        'div',
        { className: 'yyg-page' },
        h('style', null, CSS),
        h(
          'div',
          { className: 'yyg-wrap' },
          h(
            'div',
            { className: 'yyg-head' },
            h(
              'div',
              null,
              h('h1', { className: 'yyg-title' }, t('page.title')),
              h('p', { className: 'yyg-sub' }, t('page.subtitle')),
            ),
            h(
              'div',
              { className: 'yyg-head-right' },
              running
                ? h(
                    'button',
                    { className: 'yyg-btn is-danger', onClick: stopGame, disabled: busy === 'game' },
                    h(Icon, { d: ICONS.stop, size: 13 }),
                    t('run.stop'),
                  )
                : null,
              h(EnginePill, { engine, t }),
              engine.status === 'ready'
                ? h('button', { className: 'yyg-btn is-ghost', onClick: stopEngine, disabled: busy === 'engine' }, t('engine.stop'))
                : h(
                    'button',
                    { className: 'yyg-btn is-primary', onClick: startEngine, disabled: busy === 'engine' || engine.status === 'starting' },
                    busy === 'engine' || engine.status === 'starting' ? h('span', { className: 'yyg-spin' }) : h(Icon, { d: ICONS.bolt, size: 14 }),
                    t('engine.start'),
                  ),
            ),
          ),

          /* —— 视口控制 —— */
          h(
            'div',
            { className: 'yyg-panel' },
            h(
              'div',
              { className: 'yyg-panel-head' },
              h('div', { className: 'yyg-panel-title' }, h(Icon, { d: ICONS.grid, size: 15 }), t('view.title')),
              h(
                'div',
                { className: 'yyg-tools' },
                h(
                  'div',
                  { className: 'yyg-seg' },
                  PRESETS.map((p) =>
                    h(
                      'button',
                      {
                        key: p.id,
                        className: viewport.preset === p.id ? 'is-on' : '',
                        onClick: () =>
                          setViewport({
                            preset: p.id,
                            width: p.width || viewport.width,
                            height: p.height || viewport.height,
                          }),
                      },
                      p.id === 'fill' ? t('view.fill') : p.label,
                    ),
                  ),
                ),
                h('span', { className: 'yyg-sep' }),
                h('input', {
                  className: 'yyg-input is-num',
                  value: viewport.width,
                  onChange: (e) => setViewport({ width: Number(e.target.value) || 0, preset: 'custom' }),
                  title: 'width',
                }),
                h('span', { style: { opacity: 0.5 } }, '×'),
                h('input', {
                  className: 'yyg-input is-num',
                  value: viewport.height,
                  onChange: (e) => setViewport({ height: Number(e.target.value) || 0, preset: 'custom' }),
                  title: 'height',
                }),
                h('span', { className: 'yyg-sep' }),
                h(
                  'label',
                  { className: 'yyg-check' },
                  h('input', {
                    type: 'checkbox',
                    checked: viewport.chrome !== false,
                    onChange: (e) => setViewport({ chrome: e.target.checked }),
                  }),
                  t('view.chrome'),
                ),
              ),
            ),
            h(Stage, { viewport: { ...viewport, epoch }, running, stageRef, configured: viewport, native: session && session.native, fixed: Boolean(session && session.fixed), t }),
            running
              ? h(
                  'div',
                  { className: 'yyg-runbar' },
                  h(
                    'div',
                    { className: 'yyg-run-name' },
                    h('span', { className: 'yyg-live' }),
                    session.name,
                    h('span', { className: 'yyg-run-hint' }, 'pid ' + session.pid),
                  ),
                  h(
                    'div',
                    { style: { display: 'flex', alignItems: 'center', gap: 10 } },
                    h('span', { className: 'yyg-run-hint' }, t('run.viewport')),
                    h(
                      'button',
                      { className: 'yyg-btn is-danger', onClick: stopGame, disabled: busy === 'game' },
                      h(Icon, { d: ICONS.stop, size: 13 }),
                      t('run.stop'),
                    ),
                  ),
                )
              : null,
          ),

          /* —— 游戏库 —— */
          h(
            'div',
            { className: 'yyg-panel' },
            h(
              'div',
              { className: 'yyg-panel-head' },
              h(
                'div',
                { className: 'yyg-panel-title' },
                t('library.title'),
                h('span', { className: 'yyg-count' }, (state?.games || []).length + ' ' + t('library.count')),
              ),
              h(
                'div',
                { className: 'yyg-tools' },
                h('input', {
                  className: 'yyg-input',
                  placeholder: t('library.search'),
                  value: query,
                  onChange: (e) => setQuery(e.target.value),
                  style: { width: 150 },
                }),
                h(
                  'button',
                  { className: 'yyg-btn', onClick: doScan },
                  h(Icon, { d: ICONS.scan, size: 14 }),
                  t('library.scan'),
                ),
                h(
                  'button',
                  { className: 'yyg-btn is-primary', onClick: () => setShowAdd(true) },
                  h(Icon, { d: ICONS.plus, size: 14 }),
                  t('library.add'),
                ),
              ),
            ),
            (state?.games || []).length === 0
              ? h(
                  'div',
                  { className: 'yyg-empty' },
                  h('div', { className: 'yyg-stage-ico', style: { margin: '0 auto' } }, h(Icon, { d: ICONS.pad, size: 22 })),
                  h('div', { className: 'yyg-empty-title' }, t('library.empty')),
                  h('div', { className: 'yyg-empty-hint' }, t('library.emptyHint')),
                  h(
                    'div',
                    { className: 'yyg-empty-actions' },
                    h('button', { className: 'yyg-btn', onClick: doScan }, t('library.scan')),
                    h('button', { className: 'yyg-btn is-primary', onClick: () => setShowAdd(true) }, t('library.add')),
                  ),
                )
              : h(
                  'div',
                  { className: 'yyg-grid' },
                  games.map((game) =>
                    h(GameCard, { key: game.id, game, onPlay: (g) => launch(g, false), onRemove: removeGame, t }),
                  ),
                ),
          ),

          error ? h('div', { className: 'yyg-run-hint', style: { marginTop: 10, color: '#ff9b9b' } }, error) : null,
        ),

        /* —— 添加弹窗 —— */
        showAdd
          ? h(
              Modal,
              {
                title: t('add.title'),
                onClose: () => setShowAdd(false),
                footer: [
                  h('button', { key: 'c', className: 'yyg-btn is-ghost', onClick: () => setShowAdd(false) }, t('add.cancel')),
                  h('button', { key: 'o', className: 'yyg-btn is-primary', onClick: doAdd }, t('add.ok')),
                ],
              },
              h(
                'div',
                { className: 'yyg-field' },
                h('label', null, t('add.path')),
                h('input', {
                  className: 'yyg-input',
                  value: addPath,
                  placeholder: t('add.pathPh'),
                  onChange: (e) => setAddPath(e.target.value),
                  onKeyDown: (e) => {
                    if (e.key === 'Enter') doAdd();
                  },
                  autoFocus: true,
                }),
              ),
            )
          : null,

        /* —— 扫描弹窗 —— */
        showScan
          ? h(
              Modal,
              {
                title: t('scan.title'),
                onClose: () => setShowScan(false),
                footer: [
                  h('button', { key: 'c', className: 'yyg-btn is-ghost', onClick: () => setShowScan(false) }, t('add.cancel')),
                  h('button', { key: 'o', className: 'yyg-btn is-primary', onClick: addPicked }, t('scan.addSelected')),
                ],
              },
              scanning
                ? h('div', { className: 'yyg-loading' }, h('span', { className: 'yyg-spin' }), t('scan.loading'))
                : scanList.length === 0
                  ? h('div', { className: 'yyg-loading' }, t('scan.none'))
                  : scanList.map((g) =>
                      h(
                        'label',
                        { key: g.appid + g.name, className: 'yyg-scan-row' },
                        h('input', {
                          type: 'checkbox',
                          disabled: !g.exe,
                          checked: Boolean(picked[g.name]),
                          onChange: (e) => setPicked((prev) => ({ ...prev, [g.name]: e.target.checked })),
                        }),
                        h(
                          'div',
                          { style: { minWidth: 0 } },
                          h('div', { className: 'yyg-scan-name' }, g.name),
                          h('div', { className: 'yyg-scan-path' }, g.exe || t('scan.noExe')),
                        ),
                      ),
                    ),
            )
          : null,

        /* —— 管理员确认 —— */
        askAdmin
          ? h(
              Modal,
              {
                title: t('library.admin'),
                onClose: () => setAskAdmin(null),
                footer: [
                  h('button', { key: 'c', className: 'yyg-btn is-ghost', onClick: () => setAskAdmin(null) }, t('add.cancel')),
                  h('button', { key: 'o', className: 'yyg-btn is-primary', onClick: () => launch(askAdmin, true) }, t('run.asAdmin')),
                ],
              },
              h('div', { style: { fontSize: 13, lineHeight: 1.7 } }, t('run.needsAdmin')),
            )
          : null,

        busy === 'game' && !running
          ? h(
              'div',
              { className: 'yyg-toast' },
              h('span', { className: 'yyg-spin', style: { display: 'inline-block', marginRight: 8, verticalAlign: '-2px' } }),
              engine.status === 'starting' ? t('run.waiting') : t('run.launching'),
            )
          : null,

        toast ? h('div', { className: 'yyg-toast' + (toast.bad ? ' is-bad' : '') }, toast.msg) : null,
      );
    }

    /* ------------------------------------------------------------ 错误边界 */

    class Boundary extends React.Component {
      constructor(props) {
        super(props);
        this.state = { error: null };
      }
      static getDerivedStateFromError(error) {
        return { error };
      }
      render() {
        if (this.state.error) {
          return h(
            'div',
            { className: 'yyg-page' },
            h(
              'div',
              { className: 'yyg-panel', style: { padding: 24, maxWidth: 640, margin: '32px auto' } },
              h('div', { style: { fontWeight: 600, marginBottom: 8 } }, '收纳箱页面加载失败'),
              h('div', { style: { fontSize: 12.5, color: '#ff9b9b' } }, String(this.state.error?.message || this.state.error)),
            ),
          );
        }
        return this.props.children;
      }
    }

    function PanelIcon(props) {
      const size = props?.size || 20;
      const active = Boolean(props?.active);
      return h(
        'svg',
        {
          width: size,
          height: size,
          viewBox: '0 0 64 64',
          'aria-hidden': true,
          style: { display: 'block', opacity: active ? 1 : 0.72 },
        },
        h(
          'g',
          { fill: 'none', stroke: 'currentColor', strokeWidth: 4.6, strokeLinecap: 'round', strokeLinejoin: 'round' },
          h('rect', { x: 8, y: 16, width: 48, height: 30, rx: 6 }),
          h('path', { d: 'M8 24h48M36 31v8M32 35h8' }),
          h('circle', { cx: 17, cy: 32, r: 2.4 }),
          h('circle', { cx: 23, cy: 38, r: 2.4 }),
          h('path', { d: 'M20 52h24' }),
        ),
      );
    }

    /* ------------------------------------------------------------ 注册 */

    return {
      inject: ['slots'],
      apply(ctx) {
        const t = makeT(ctx);
        const PageView = (props) => h(Boundary, null, h(GameBoxPage, { ...props, t }));
        ctx.slots.inject('sidebar.panellist', () =>
          ctx.slots.register({ name: 'sidebar.panellist', id: 'yy-gamebox', order: 34, label: () => t('nav.label') }, PanelIcon),
        );
        ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: 'yy-gamebox' }, PageView));
      },
    };
  },
});
