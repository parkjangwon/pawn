# Pawn

[English](./README.md) · [한국어](./README.ko.md) · [日本語](./README.ja.md)

**棋盘上属于你的棋子。** 桌面端 AI 编程代理：写代码、浏览网页、自动化、长期记忆 — API 密钥、数据与规则都在你这边。

Pawn 不是又一个云端锁定 IDE。接入任意 OpenAI / Claude 兼容 API，按需安装技能，长期记忆与令牌只保存在本机 `~/.pawn`。无强制 harness，无多余产品流水线。

### 为什么叫 “Pawn”？

国际象棋里，兵（pawn）是**真正干活的棋子**：推进、占线，并在需要时升变。Pawn 就是桌面上的那枚棋子 — 本地优先、由你掌控，而不是向厂商租用的王座。

---

## 能做什么

- **编程** — 文件、Shell、Git、符号搜索、检查，以及带权限的代理循环
- **浏览器** — 内嵌 Chromium（`browser_*`）操作真实网页与登录会话（会话 claim 隔离）
- **检索** — 无需额外 API 的公开网页搜索/阅读（`web_search` / `web_fetch` / `web_research`）
- **计算机操控** — 桌面鼠标、键盘、截图、剪贴板（`computer_*`）
- **记忆** — 本地长期 Memory（`~/.pawn/memory.db`），随使用个性化
- **Hooks** — 兼容 Claude/Codex 的生命周期钩子（Claude + Pawn 配置合并去重）
- **连接** — 设置 → 连接 中可选 Google / GitHub（OAuth）与 GitLab / AWS CodeCommit（PAT）工具（令牌仅本地）
- **扩展** — MCP、Claude Code 技能/插件、`CLAUDE.md` / `AGENTS.md`、自动化、托盘
- **子代理** — 会话内子代理、工具策略与编排，可选 worktree 审阅后应用
- **多根目录** — 额外项目根与有效 cwd；面板与代理工具感知根路径
- **会话** — 持久 plan/thinking、保留附件的编辑与再生成、恢复、排除密钥的备份导出
- **用量与预算** — 上下文计量、支出 soft-cap、用量面板
- **更新** — 设置/启动时对照 GitHub Releases；下载对应安装包并打开
- **路由** — 多模型自动路由、缓存稳定、DeepSeek/MiMo thinking + 视觉回退
- **提供商（BYOK）** — OpenAI、Anthropic、OpenRouter、DeepSeek、**OpenCode Go**、**Command Code**、**Xiaomi MiMo**、Gemini、xAI、Groq 等粘贴密钥，或任意 OpenAI/Claude 兼容 base URL。可用时通过 OS `safeStorage` 加密存钥
- **模型列表同步** — 设置 → 提供商 → **同步模型** 通过 `GET {baseUrl}/models` 拉取最新目录（预设仅为引导）

界面：ChatGPT 风格布局，终端 / 文件 / Git / Diff / 浏览器面板，明暗主题。语言：英 / 韩 / 日 / 中。

### 最新 — v0.9.0

BYOK 密钥加密、多根完善、应用内更新下载、排除密钥备份、浏览器 claim 隔离、transcript 安全编辑/再生成、plan 与 thinking UI、上下文计量与支出上限、worktree 审阅应用、子代理编排、issue→PR 辅助、自动化编辑、欢迎清单，以及更广的 en/ko/ja/zh 对齐。

---

## 提供商

Pawn 不内置厂商密钥，请自备 API Key（BYOK）。

| 预设 | 说明 |
|------|------|
| OpenAI、Anthropic、OpenRouter、Gemini、xAI、Groq 等 | 标准 OpenAI / Claude 兼容端点 |
| DeepSeek | V4 Flash/Pro · 磁盘缓存 + thinking（工具循环须回传 `reasoning_content`） |
| **OpenCode Go** | 开放编码模型订阅网关 — [文档](https://opencode.ai/docs/ko/go/) · `https://opencode.ai/zen/go/v1` |
| **Command Code** | 多模型 Provider API — [文档](https://commandcode.ai/docs/provider) · `https://api.commandcode.ai/provider/v1` |
| **Xiaomi MiMo** | OpenAI + Anthropic 路径 — [文档](https://mimo.mi.com/docs/en-US/quick-start/summary/first-api-call) · `https://api.xiaomimimo.com/v1` |

添加提供商后用 **同步模型**（预设添加时也会尝试）对齐 API 列表。**Test** 使用该提供商已挂载的模型探测（不再固定 `gpt-4o-mini`）。

---

## 安装

**推荐一键安装：**

```bash
npx @parkjangwon/pawn
```

或全局安装 CLI：

```bash
npm install -g @parkjangwon/pawn
pawn
```

**手动下载：** [Releases](https://github.com/parkjangwon/pawn/releases/latest)

| 平台 | 包 |
|------|-----|
| macOS | `pawn-<version>-universal.dmg`（Apple Silicon + Intel）。首次：右键 → **打开**（未签名）。 |
| Windows | `pawn-<version>-x64-setup.exe` 或 `pawn-<version>-arm64-setup.exe` |
| Linux | `pawn-<version>-x64.AppImage` / `.deb`（或 `npm run dist:linux`） |

**要求：** macOS 10.12+ / Windows 10+ / Linux · OpenAI 或 Claude 兼容 API 密钥（BYOK）

启动后：在设置中添加 API 密钥 → 打开项目文件夹 → 开始对话。

---

## 面向代理的文档（配置与维护）

人类用户读本页即可。负责安装、配置、维护的**编程代理**请阅读完整指南：

| 语言 | 指南 |
|------|------|
| English | [docs/agent/GUIDE.md](./docs/agent/GUIDE.md) |
| 한국어 | [docs/agent/GUIDE.ko.md](./docs/agent/GUIDE.ko.md) |
| 中文 | [docs/agent/GUIDE.zh.md](./docs/agent/GUIDE.zh.md) |
| 日本語 | [docs/agent/GUIDE.ja.md](./docs/agent/GUIDE.ja.md) |

内容包括全部内置工具、Memory / Hooks / MCP 路径、`~/.pawn` 布局、计算机操控系统依赖、OAuth 与源码构建。

**给用户的提示：** 把本仓库 URL 丢给代理，说明需求（如「安装技能」「接 MCP」「在 macOS 上启用 computer use」），并让它阅读 `docs/agent/GUIDE.md` 或 `GUIDE.zh.md`。

---

## 许可证

MIT — [LICENSE](./LICENSE)。OAuth 隐私：[PRIVACY.md](./PRIVACY.md)。

公开网页检索基于 [insane-search](https://github.com/fivetaku/insane-search)（MIT）。
