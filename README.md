# yy 收纳箱（@local/yy-gamebox）

把本机游戏收进 DeepSeek Harness 的面板里运行：原生窗口渲染（不是串流），延迟等于直接玩；窗口被 Harness 主窗口「拥有」，不占任务栏、不进 Alt+Tab，看起来就长在页面上。

## 它做了什么

- **游戏库**：扫描 Steam 库自动导入（也支持手动添加任意 exe 或游戏目录）。
- **面板内运行**：游戏窗口被原生引擎收养为 Harness 主窗口的 owned window，按面板视口矩形（客户区比例 `frac=[x,y,w,h]`）精确摆位，并去掉标题栏。
- **视口尺寸自定义**：16:9 / 16:10 / 4:3 / 21:9 / 铺满，或直接填宽×高；页面缩放或窗口拖动后，游戏画面跟着走。
- **游戏自己说了算的情况也照顾**：能改尺寸的游戏，引擎直接把它拉成视口大小（画面完整填满视口）；少数拒绝改尺寸的老游戏，才退回「按它自己的尺寸 1:1 摆 + 视口裁剪」。
- **不出现在 Windows 里**：加 `WS_EX_TOOLWINDOW`、去 `WS_EX_APPWINDOW`，任务栏与 Alt+Tab 都不会多出一个窗口；只有面板可见且 Harness 在前台时才显示，切到别的应用或别的插件页面会立刻隐藏。
- **页头就有「停止游戏」**：不用去点舞台下方的按钮（那个按钮会被游戏窗口盖住）。
- **提权只确认一次**：需要管理员权限的游戏由已提权的原生引擎直接启动，不会再弹第二次 UAC，也不会有「只通知不确认」的死循环。

## 架构

```
浏览器（client.js）
   │  React 页面：游戏库 / 舞台 / 视口设置
   │  POST /yy-gamebox/api/*      ── 视口 frac、启动、停止、扫描
   ▼
Host（index.js + lib/*.js，跑在 DSH 内）
   │  游戏库 games.json、路由、工具、会话状态
   │  TCP JSON 行协议（token 鉴权，仅 127.0.0.1）
   ▼
原生引擎（native/yybox.cs → <数据目录>/bin/yybox.exe，管理员常驻）
      SetWindowLongPtr(GWLP_HWNDPARENT) 收养 + SetWindowPos 摆位 + Watch 循环
```

- 普通游戏：Host 用 `spawn(detached)` 启动 → 引擎 `track` 找到窗口 → `attach` 收养摆位。
- 需要管理员的游戏：直接交给引擎 `launch`（引擎本身已是 High），Host 只管记账。

### 为什么不是真嵌入

Electron 的 `Chrome_WidgetWin_1` 只往子窗口 `Intermediate D3D Window` 上画（DirectComposition，`WS_EX_NOREDIRECTIONBITMAP`）。任何普通 `WS_CHILD` 都会被它盖住，实测截图全黑/看不到；强行 `SetParent` 到 D3D 子窗口也不行。所以采用「owned window + 精确摆位 + 裁剪」：视觉上落在面板内，帧延迟为零。

## 安装

插件包自带 `cordis.patch.yml`，用插件管理器启用即可：

```
plugin_manager install_bundle target=<本目录绝对路径>
```

或在 profile 的 `package.json` 里 `"@local/yy-gamebox": "link:<本目录>"` 后重启。

## 使用

- 侧边栏点「收纳箱」进入页面。
- 「扫描 Steam 库」→ 勾选要收的游戏 → 添加。
- 点卡片上的「启动」，游戏就出现在中间的舞台里；页头右侧的红色按钮可随时停止游戏。
- 舞台大小即游戏画面大小；右侧可切换比例/自定义宽高、勾选「隐藏游戏标题栏」。
- 「停止」结束游戏并还原窗口样式。

模型侧工具：`yy_game_list`、`yy_game_scan`（`add:true` 直接入库）、`yy_game_add`、`yy_game_launch`、`yy_game_stop`、`yy_game_status`。

## 数据与日志

都在 `<DSH_HOME>/yy-gamebox/`（本机即 `E:\dsh\yy-gamebox`）：

| 文件 | 内容 |
| --- | --- |
| `games.json` | 游戏库、视口设置 |
| `engine.json` | 引擎端口与 token |
| `engine.log` | 原生引擎日志 |
| `plugin.log` | 插件（Host）日志 |
| `bin/yybox.exe` | 首次启动时由 `native/yybox.cs` 编译 |

引擎源码改了内容后（比较 `native/yybox.cs` 的 sha1 与 `bin/build.sha1`），下次启动会自动用 `csc.exe` 重新编译。

## 实测记录与已知限制

- **三国志·战略版（S3Client，EJOY2DX 模拟器）**：会自己把窗口重新显示出来，所以隐藏靠「空窗口区域」按住（`SetWindowRgn` 到 0×0），而不是只调 `ShowWindow`；它接受改尺寸（实测 `SetWindowPos` 要 1442×812 就给 1442×812），因此走「按视口拉满」这条路，画面完整不裁剪。
- **KOF'97（固定尺寸老游戏）**：它拒绝改窗口样式（`WM_STYLECHANGING` 被自己的 WndProc 挡回，日志 `strip refused`），也不接受外部改尺寸。引擎连续 3 次改不动才判定 `FixedSize`，之后每 12 秒再试一次；判定为固定尺寸时用 `SetWindowRgn` 裁到视口矩形——标题栏因此被裁掉，画面仍留在面板里。
- 对拒绝改样式的窗口，引擎**只试一次**就记住（`StyleRefused`）：跨进程 `SetWindowLongPtr` 是同步消息，反复重试会卡住游戏的消息循环，甚至让它退出。
- 裁剪模式会把画面切掉一部分（不做缩放）；想要完整画面就换到能改尺寸的窗口，或把视口调成和游戏同一比例。
- 插件重载（`plugin_manager` 开关）**不会**再杀掉引擎，所以正常情况下重载不用重新点 UAC；重载后内存里的运行中会话会丢，需要重新启动游戏。要强制重编译引擎时用引擎卡片上的「停止引擎」再启动（会弹一次 UAC）。

## 注意

- 首次启动引擎会弹一次 UAC（`Start-Process -Verb RunAs`），确认后引擎常驻；之后启动游戏不再打扰。
- 引擎需要管理员权限的原因：Harness 主进程是 Medium 完整性，低权限进程无法改写它的窗口句柄（`SetParent`/`CreateWindowEx` 都会 `err=5`）。高权限可以操作低权限窗口，反之不行。
- 引擎只监听 `127.0.0.1`，且每条连接都要先 `auth` 通过 token。
- 卸载插件时不会自动关闭正在运行的游戏，先点「停止」。
