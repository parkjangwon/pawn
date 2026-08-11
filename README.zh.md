# Pawn

[English](./README.md) · [한국어](./README.ko.md) · [日本語](./README.ja.md)

**棋盘上属于你的棋子。** 桌面端 AI 编程代理：写代码、浏览网页、自动化、长期记忆 — API 密钥、数据与规则都在你这边。

Pawn 不是又一个云端锁定 IDE。接入任意 OpenAI / Claude 兼容 API，按需安装技能，长期记忆与令牌只保存在本机 `~/.pawn`。无强制 harness，无多余产品流水线。

### 为什么叫 “Pawn”？

国际象棋里，兵（pawn）是**真正干活的棋子**：推进、占线，并在需要时升变。Pawn 就是桌面上的那枚棋子 — 本地优先、由你掌控，而不是向厂商租用的王座。

---

## 能做什么

- **编程** — 文件、Shell、Git、符号搜索、检查，以及带权限的代理循环
- **浏览器** — 内嵌 Chromium（`browser_*`）操作真实网页与登录会话。**多标签**：代理、UI 面板与每个子代理各占一个标签（按所有者隔离），并行浏览而不打扰你的画面
- **检索** — 无需额外 API 的公开网页搜索/阅读（`web_search` / `web_fetch` / `web_research`），另有 **`research_report`**：并行检索子代理（各占标签）收集并去重，综合为附引用的报告产物
- **计算机操控** — 桌面鼠标、键盘、截图、剪贴板（`computer_*`）
- **记忆** — 本地长期 Memory（`~/.pawn/memory.db`），随使用个性化
- **Hooks** — 兼容 Claude/Codex 的生命周期钩子（Claude + Pawn 配置合并去重）
- **连接** — 设置 → 连接 中可选 Google / GitHub（OAuth）与 GitLab / AWS CodeCommit（PAT）工具（令牌仅本地）
- **扩展** — MCP、Claude Code 技能/插件、`CLAUDE.md` / `AGENTS.md`、自动化、托盘
- **子代理** — 会话内子代理、工具策略与编排，可选 worktree 审阅后应用，以及用于并行浏览的独立标签
- **多根目录** — 额外项目根与有效 cwd；面板与代理工具感知根路径
- **会话** — 持久 plan/thinking、保留附件的编辑与再生成、恢复、排除密钥的备份导出
- **用量与预算** — 上下文计量、支出 soft-cap、用量面板
- **更新** — 设置/启动时对照 GitHub Releases；下载对应安装包并打开
- **路由** — 多模型自动路由、缓存稳定、DeepSeek/MiMo thinking + 视觉回退
- **提供商（BYOK）** — OpenAI、Anthropic、OpenRouter、DeepSeek、**OpenCode Go**、**Command Code**、**Xiaomi MiMo**、Gemini、xAI、Groq 等粘贴密钥，或任意 OpenAI/Claude 兼容 base URL。可用时通过 OS `safeStorage` 加密存钥
- **模型列表同步** — 设置 → 提供商 → **同步模型** 通过 `GET {baseUrl}/models` 拉取最新目录（预设仅为引导）

界面：ChatGPT 风格布局，终端 / 文件 / Git / Diff / 浏览器面板，明暗主题。语言：英 / 韩 / 日 / 中。

### 最新 — v0.11.1

**安全加固＋子代理 UX＋稳定性**
- **项目钩子加门（安全）** — 所打开仓库的 `.claude/settings.json` / `.pawn/hooks.json` 钩子默认不再运行：这些文件随不可信仓库而来，可能执行任意 shell 命令。可在 Settings → Hooks 中显式启用；用户级钩子（~/.claude、Pawn 目录）始终运行。`npm audit` 干净（已知漏洞 0）
- **子代理实时状态内联显示** — 在聊天中以可折叠条（“N 个代理工作中…”）显示，展开可查看每个运行。右侧 Agents 标签保留用于历史，任务开始时不再强制打开面板
- **子代理浏览器面板** — 所有子代理浏览结束后关闭侧边面板（仅当由子代理打开时——您打开或正在查看的面板绝不会被触碰）；带防抖以避免顺序流水线闪烁
- **稳定性** — 子代理运行即使在意外崩溃时也总会进入终止状态（不再有幽灵“running”条目）；数据库不可用时侧边栏会话搜索回退到内存列表
- **UI** — 计划/代理/审查组件对齐聊天列宽

### v0.11.0 — 队列/转向简化＋会话搜索＋覆盖层加固
- **队列/转向简化** — 移除输入框切换按钮；发送遵循设置中选择的模式，队列模式下运行时停止按钮旁会出现小的**转向**按钮，可立即发送当前草稿
- **会话搜索** — 侧边栏通过数据库搜索所有会话的标题与**消息内容**，即使从未打开过的会话也会出现在结果中
- **覆盖层加固** — 打开设置时隐藏内嵌浏览器（渲染层 z-index 无法覆盖的原生视图），关闭时恢复；浏览器页面与标签保持存活

---

### v0.10.0 — 多标签浏览器＋子代理并行浏览＋`research_report`

- **多标签浏览器** — 浏览器面板标签栏，`browser_tab_new / list / switch / close` 工具，弹窗在新标签页中打开
- **子代理并行浏览** — 按所有者分标签（`session:` / `subagent:` / UI），后台 parked 标签绝不打扰当前页面，运行结束时自动回收
- **`research_report`** — 规划者 → 并行检索工人（各占标签，混用 `web_search` / `web_research` / `web_fetch` 与 `browser_*`）→ 去重资料卷 → 附引用验证的报告（产物写入 `<project>/artifacts/`，未打开项目时写入 `~/Downloads/pawn-artifacts/`）
- **稳定性加固** — 所有 fire-and-forget IPC 调用均处理拒绝，修复可选链短路 bug，检索管道失败时返回清晰的工具错误
- 另：Agents 面板布局加固、README/CONTRIBUTING 更新

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
