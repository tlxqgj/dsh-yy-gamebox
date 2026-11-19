# 发布指南 · dsh-yy-gamebox（莫若知秋）

这个目录是一份**可直接推到 GitHub 的仓库快照**。发布分两步：先让仓库上线，再向插件市场提一条收录 PR。

---

## 0. 先确认一件事：GitHub 账号名

插件市场列表里的条目名是 `owner/repo`（必须与 GitHub 仓库地址完全一致），所以这里不能用中文。
建议：

- **作者/显示名**：莫若知秋（已经写进 `package.json` 的 `author` 字段与 README）
- **GitHub 账号名**：请提供一个 ASCII 用户名，例如 `moruo-zhiqiu`
- **仓库名**：`dsh-yy-gamebox`

把 `OWNER` 全部替换成你的 GitHub 账号名（本目录里涉及 `OWNER` 的文件只有 `package.json` 与 `market/OWNER__dsh-yy-gamebox.yml` 的文件名/内容）。

---

## 1. 创建仓库并推送

本机目前**没有登录任何 GitHub 账号**（没装 `gh`，`git config user.name` 为空，npm 未登录），所以下面两条命令需要你在自己电脑上执行，或者先在本机登录后让我来跑。

```sh
# 1) 在 GitHub 网页新建空仓库 dsh-yy-gamebox（Public，不要勾 README）
# 2) 在这个目录里：
git init
git add -A
git commit -m "feat: yy gamebox 1.0.0"
git branch -M main
git remote add origin https://github.com/OWNER/dsh-yy-gamebox.git
git push -u origin main
```

推送后在仓库页面：

1. 点 **About** 旁的齿轮，加 topic：`dsh-plugin`（收录硬性要求）
2. About 描述可填：`Run local games inside DeepSeek Harness`

> 收录要求仓库**创建满 1 天**才会通过 CI，所以推送后第二天再提 PR。

---

## 2. 向插件市场提收录 PR

市场列表来自 <https://github.com/awesome-dsh-plugin/awesome-dsh-plugin>，**上架 = 提一个只新增 1 个文件的 PR**。

1. Fork 该仓库，克隆到本地
2. 把 `market/OWNER__dsh-yy-gamebox.yml` 复制为 `data/plugins/<你的账号>__dsh-yy-gamebox.yml`（文件名必须与 owner/repo 对应）
3. 文件内容（已备好，替换 `OWNER`）：

```yaml
url: https://github.com/OWNER/dsh-yy-gamebox
name: OWNER/dsh-yy-gamebox
category: fun
description:
  en: 'Run local games natively inside the DeepSeek Harness panel: owned-window embedding with viewport sizing, no extra taskbar window, one UAC prompt for admin games.'
  zh: '把本机游戏收进 DeepSeek Harness 面板里原生运行：窗口按视口尺寸摆放、不占任务栏、管理员游戏只需确认一次。'
icon: https://raw.githubusercontent.com/OWNER/dsh-yy-gamebox/main/assets/icon-192.png
```

4. `git commit`、push 到自己的 fork，然后向 `awesome-dsh-plugin/awesome-dsh-plugin` 开 PR（标题随意，正文一句说明即可）

CI 会依次检查：条目数 ≤3 → `package.json` 是否有 `dsh.bundle`（本仓库已有 `"bundle": { "patch": "./cordis.patch.yml" }`）→ 仓库年龄 ≥1 天 → awesome-lint 与站点构建。
维护者合并后，市场与 <https://awesome-dsh-plugin.com> 会自动重建。

分类说明：`fun` 是「娱乐」类，与本插件最接近；若维护者认为 `tools` 更合适，他们会直接改，不会因此打回。

---

## 3. npm 发布（可选）

发不发都不影响收录，只是市场能显示下载量。若之后需要：

```sh
cmd /c npm login
cmd /c npm publish
```

注意：`package.json` 的 `repository` 字段必须指回被收录的那个 GitHub 仓库，否则市场不会把两者关联；`publishConfig.access` 已设为 `public`。

---

## 4. 仓库内容说明

| 文件 | 作用 |
| --- | --- |
| `index.js` | 宿主半边：注册 6 个 `yy_game_*` 工具与 `/yy-gamebox` HTTP 路由 |
| `client.js` | 面板半边：侧栏「收纳箱」入口 + 游戏库/舞台页面 |
| `lib/engine.js` | 引擎管理：按代码哈希重编译、UAC 提权启动、连接复用 |
| `native/yybox.cs` | C# 原生引擎（首次启动用系统 csc 编译成 `bin/yybox.exe`） |
| `assets/icon-192.png` | 市场卡片图标（位图，SVG 会被市场拒绝） |
| `market/OWNER__dsh-yy-gamebox.yml` | 收录条目模板 |
| `cordis.patch.yml` | bundle 自带的挂载补丁 |

安装方式（用户侧）：

```sh
dsh plugin add https://github.com/OWNER/dsh-yy-gamebox
```

首次启动游戏时 Windows 会弹一次 UAC——原生引擎需要管理员权限才能接管高权限游戏窗口，确认一次后一直复用。

---

## 5. 还需要补的东西（可选但建议）

- **截图**：市场支持在仓库根放 `screenshots.json`，列出 1–8 张仓库内图片路径（不能是 SVG，不能是第三方图床）。拍几张「收纳箱列表页 / 游戏在面板内运行 / 视口尺寸设置」的截图放进 `assets/`，然后写：

```json
["assets/shot-panel.png", "assets/shot-running.png", "assets/shot-settings.png"]
```

- **Release tarball**：如果希望用户免编译安装，可以把 `npm pack` 产物挂到 GitHub Release，并在市场条目里加一行 `tarball:`（文件名不要带版本号）。
