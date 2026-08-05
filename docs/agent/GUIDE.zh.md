# Pawn — 代理维护指南

> **读者:** 负责安装、配置、调试或扩展 Pawn 的编程代理（及维护者）。  
> **人类用户:** 从根目录 [README.zh.md](../../README.zh.md) 开始。  
> **其他语言:** [English](./GUIDE.md) · [한국어](./GUIDE.ko.md) · [日本語](./GUIDE.ja.md)

用户把本仓库 URL 交给你并交代任务时，**先读本文**，再只改其请求范围内的内容。

---

## 1. Pawn 是什么

桌面端 **AI 编程代理**（Electron + React）。BYOK：任意 OpenAI / Claude 兼容 API。数据本地优先于 `~/.pawn`。无云端 harness。

原则：

- **No harness** — 薄内置工具 + 用户技能/插件
- **BYOK** — 自由注册兼容端点
- **Auto mode** — 按复杂度与缓存粘性路由模型
- **本地 Memory** — 仅 `~/.pawn/memory.db`
- **Hooks** — Claude/Codex 兼容；Claude+Pawn **合并** 并按 command/url **去重**；**deny 优先于 YOLO**
- **兼容 Claude Code** — `CLAUDE.md`、skills、rules、`~/.agents/`、Claude hooks
- **原生 MCP** — 发现 Claude Code / Cursor / Pawn 服务器

---

## 2. 安装与启动

```bash
npx @parkjangwon/pawn
# 或
npm install -g @parkjangwon/pawn && pawn
```

发布页: https://github.com/parkjangwon/pawn/releases/latest

| OS | 产物 | 说明 |
|----|------|------|
| macOS | `Pawn-*-universal.dmg` | 未签名：首次右键 → 打开 |
| Windows | `*-x64-setup.exe` / `*-arm64-setup.exe` | |
| Linux | `.AppImage` / `.deb` | 或 `npm run dist:linux` |

要求: macOS 10.12+ / Win 10+ / Linux；源码构建需 Node `^20.19.0 || >=22.12.0`；API 密钥。

安装缓存: `~/.pawn/installers/`。

---

## 3. 技能与插件

| 方式 | 做法 |
|------|------|
| 交给代理 | GitHub URL + 安装请求 → `install_skill` |
| 用户全局 | `~/.agents/skills/` 或 `~/.claude/skills/` |
| 项目 | `<project>/.claude/skills/`、`skills/`、`.agent/skills/` |
| 插件 | `.claude/plugins/` 等 |
| UI | **设置 → 插件** |

技能为目录项（摘要可见，全文 `load_skill`）。内置工具无需安装。

---

## 4. 本地数据（`~/.pawn`）

| 路径 | 用途 |
|------|------|
| `pawn.db` | 项目、会话、消息、transcript、用量、例程 |
| `memory.db` | 长期 Memory 卡片 |
| `hooks.json` | Pawn 用户 hooks |
| `hooks-settings.json` | hooks 总开关 / 源开关 |
| `config.toml` | 应用设置 |
| `mcp.json` | Pawn 管理的 MCP |
| `reports/` | 自动化产出 |
| `installers/` | 安装包缓存 |

---

## 5. 内置工具摘要

每轮最多 **50** 次工具回合。按工具类型授权。队列 / 转向模式。

### 文件 / Shell / Git

`read_file` `write_file` `edit_file` `list_dir` `delete_file` · `read_spreadsheet` · `search_files` `grep_search` · `codebase_search` · `shell_exec` `shell_poll` `shell_kill` · `git_status` `git_diff` `git_log` · `git_pr_ready` · `run_checks` · `write_artifact` `list_artifacts` · `terminal_list` `terminal_read` · `update_plan`

### 生命周期 Hooks

| 来源 | 路径 |
|------|------|
| Claude 用户 | `~/.claude/settings.json` → `hooks` |
| Claude 项目 | `<project>/.claude/settings.json` |
| Pawn 用户 | `~/.pawn/hooks.json` |
| Pawn 项目 | `<project>/.pawn/hooks.json` |

事件: `SessionStart` `UserPromptSubmit` `PreToolUse` `PermissionRequest` `PostToolUse` `Stop`。  
处理器: `command` | `http`。支持 Claude 别名（`Bash`→`shell_exec` 等）。UI: **设置 → 代理 → Hooks**。

### Memory

`memory_search` `memory_save` `memory_list` `memory_update` `memory_forget`  
自动捕获 + 轮次注入（untrusted）。UI: **设置 → 代理 → Memory**。作用域 user/project。拒绝密钥入库。

### 公开 Web

`web_search` `web_fetch` `web_research` — 无需额外 API Key。非登录/付费墙绕过。  
只读用 `web_*`，交互/登录用 `browser_*`。默认 SSRF 防护。

### 浏览器与计算机操控

- `browser_*` — 内嵌 Chromium
- `computer_*` — `screenshot` `displays` `click` `move` `drag` `scroll` `type` `keypress` `clipboard` `wait`
  - 坐标默认来自**上一张截图的图像空间**
  - macOS: `brew install cliclick` + 辅助功能 + 屏幕录制
  - Windows: PowerShell / Linux: `xdotool`
  - 截图建议使用视觉模型或路由回退

### 服务连接（Google / GitHub / GitLab / CodeCommit）

**设置 → 连接**。令牌仅存 `~/.pawn`。  
- Google（OAuth）只读：Drive/Gmail/Calendar/Tasks/Docs/Sheets/Slides  
- GitHub（OAuth）：读取 + 可选写（Issue/PR 评论、创建 PR 等）  
- GitLab（PAT）：项目/Issue/MR/提交/文件/搜索 + 创建 Issue、评论、创建 MR  
- AWS CodeCommit（IAM）：仓库/分支/提交/文件  
Google/GitHub 的 OAuth 构建见 [.github/OAUTH_SECRETS.md](../../.github/OAUTH_SECRETS.md)；GitLab/CodeCommit 在设置中直接填 PAT/IAM，无需 OAuth 客户端。

### 应用控制

`app_open_tab` `app_close_tab` · `app_set_model` 等 · `load_skill` `install_skill` · 自动化相关 `app_*_automation`

---

## 6. MCP

发现顺序: `~/.claude.json` → 项目 `.mcp.json` → `~/.pawn/mcp.json`。  
同 id 时项目覆盖用户。UI: **设置 → MCP**。

---

## 7. 提供商与路由

- OpenAI / Claude 格式及自定义 OpenAI 兼容端点
- **DeepSeek:** `deepseek-v4-flash` / `pro`。thinking 时**每次工具循环必须回传 `reasoning_content`**（无则空串），否则 HTTP 400。截图需搭配视觉模型
- 路由: simple|medium|complex、缓存粘性、失败升级、冷却、视觉回退

---

## 8. UI 与自动化

右侧: 终端 / 文件 / Git / Diff / Artifacts / 浏览器。  
自动化产出: `~/.pawn/reports/`。托盘、`Cmd/Ctrl+K`、渐进关闭、退出确认。i18n: en/ko/ja/zh。

---

## 9. 安全（不可破坏）

- 渲染进程: `nodeIntegration: false`，`contextIsolation: true`；系统操作仅经 IPC + preload
- Memory / Web 注入 = untrusted
- Hooks 仅在 main；PreToolUse **deny** 在 YOLO 下仍生效

---

## 10. 开发与打包

```bash
npm install
npm run dev | dev:web | build | typecheck | test | check
npm run dist | dist:mac | dist:win | dist:linux | pack
```

```
src/main/          # IPC、DB、memory、hooks、computer、research、connections
src/preload/
src/renderer/src/  # agent、components、stores、i18n
```

贡献约定见根目录 `CLAUDE.md` / `Claude.md`。

---

## 11. 常见任务

| 用户请求 | 做法 |
|----------|------|
| 安装 | `npx @parkjangwon/pawn` 或 Releases；注意 macOS Gatekeeper |
| API / DeepSeek | 设置 → Providers；thinking + 视觉回退 |
| 技能 | `install_skill` 或 `~/.agents/skills/` |
| 计算机操控 (macOS) | cliclick + 辅助功能/屏幕录制 + 视觉模型 |
| MCP | `~/.pawn/mcp.json` 或设置 UI |
| Hooks | `~/.pawn/hooks.json` 或 Claude settings |
| Memory | 设置 → Agent → Memory；`memory.db` |
| 服务连接 | 设置 → Connections（Google/GitHub OAuth、GitLab/CodeCommit PAT） |
| 源码构建 | 正确 Node 版本 + `npm install` + `npm run check` |
| 工具被拒 | 权限模式、PreToolUse deny、MCP 状态 |

---

## 12. 许可证

MIT。OAuth 隐私: [PRIVACY.md](../../PRIVACY.md)。完整英文工具表见 [GUIDE.md](./GUIDE.md)。
