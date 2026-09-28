# Pawn

[English](./README.md) · [한국어](./README.ko.md) · [日本語](./README.ja.md)

**棋盘上属于你的棋子。** 桌面端 AI 编程代理：写代码、浏览网页、自动化、长期记忆 — API 密钥、数据与规则都在你这边。

Pawn 不是又一个云端锁定 IDE。接入任意 OpenAI / Claude 兼容 API，按需安装技能，长期记忆与令牌只保存在本机 `~/.pawn`。无强制 harness，无多余产品流水线。

### 为什么叫 “Pawn”？

国际象棋里，兵（pawn）是**真正干活的棋子**：推进、占线，并在需要时升变。Pawn 就是桌面上的那枚棋子 — 本地优先、由你掌控，而不是向厂商租用的王座。

---

## 能做什么

- **编程** — 文件、Shell、Git、符号搜索、检查，以及带权限的代理循环
- **代理硬实力** — 模型原生工具（Claude 文本编辑器与持久 bash、GPT `apply_patch`）、模型流式输出时即开始的工具执行、真正的调试器（Node、Python、Go、C/C++/Rust）、LSP 重命名/快速修复/调用层级、本地语义代码搜索、受影响测试筛选、开发服务器与浏览器运行时错误感知、长任务耐力（输出卸载、上下文清理、工作笔记、检查点）、含第二意见的卡住恢复机制，以及可学习的仓库档案与纠错学习
- **浏览器** — 内嵌 Chromium（`browser_*`）操作真实网页与登录会话。**多标签**：代理、UI 面板与每个子代理各占一个标签（按所有者隔离），并行浏览而不打扰你的画面
- **检索** — 无需额外 API 的公开网页搜索/阅读（`web_search` / `web_fetch` / `web_research`），另有 **`research_report`**：并行检索子代理（各占标签）收集并去重，综合为附引用的报告产物
- **电脑操作** — 像 Codex / Claude computer use 一样操作任何 Mac 应用：原生助手支持辅助功能树元素操作、应用/窗口/菜单控制、高清截图与放大、本地 OCR、输入法安全输入、多显示器、Claude 原生电脑工具；按两次 Esc 停止（`computer_*`；Windows/Linux 为基础鼠标键盘）
- **录制与回放** — 在 Pawn 浏览器或任意 Mac 应用里演示一次任务，Pawn 就会写出可复用的技能，代理可用新输入或定时再次执行（macOS）
- **决策模型** — 可选。用托管的 TypeSafe Jev 或本地 Ollaya 以校准概率快速判断是/否、单选和打分：`decide` 工具、shell 命令风险检查、辅助自动路由
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

### 最新 — v0.16.0

**贴近 Cursor 的界面**
- **暖色画布** — 浅色是奶油底，深色是偏暖的近黑。白卡片只靠发丝线区分，没有投影
- **克制的橙色** — `#f54e00` 只用于字标和主要操作（发送、主按钮）。选中状态仍是墨色
- **字体** — 界面用 Inter，韩文、假名和汉字用 Pretendard，代码用 JetBrains Mono
- **代理时间线** — 工具行按动作使用桃、薄荷、蓝、薰衣草胶囊，完成时为金色

### v0.15.1

**界面焕新 ＋ 更轻松的 Computer Use 设置**
- **更安静、更精致的界面** — 使用 Pretendard 字体，统一字号、间距和圆角尺度，采用对比度更好的中性 zinc 浅色主题；去掉全大写标签、强调色条、渐变和光晕，输入框聚焦时只加深边框
- **用量预算** — 会话和每日花费上限改为带 `$` 且数字对齐的输入框
- **一键设置 Computer Use** — 设置 → Computer Use 按钮会在缺少辅助程序时自动准备（开发版），请求辅助功能和屏幕录制权限，并直接打开仍需开启的系统设置面板

### v0.15.0

**录制与回放 ＋ 决策模型**
- **录制与回放（macOS）** — 演示一次工作流，就得到可复用的技能。点输入框旁的录制按钮（或 `/record`），在 Pawn 浏览器和/或 Mac 应用里完成任务后停止（也可按两次 Esc），Pawn 会写出 `SKILL.md`：每次会变的输入、按界面标签（而非坐标）描述的步骤、检查步骤，以及提交前确认规则。可保存到 `~/.agents/skills`，用新输入再次运行（`/技能名`），在对话中完善，或设为定时自动化
- **注重隐私** — 密码、验证码、卡号字段和 macOS 安全输入框从不记录，忽略 Pawn 自己的窗口和代理自己的输入，录制时屏幕上会显示红色提示。原始录制只保存在内存中，技能写好后即消失
- **决策模型（可选）** — 设置 → 决策模型可在聊天模型旁加一个快速判断模型（"System One"）：**TypeSafe Jev**（托管、官方 SDK）或 **Ollaya**（在你的 Mac 上运行 Laya、Winnow 等开源模型）。代理会获得用于分拣、排序和核查的 `decide` 工具；原本会自动运行的 shell 命令若看起来具有破坏性或会外发数据，会退回给你确认；自动路由可用它判断请求难度。模型响应慢或关闭时一切恢复默认行为
- **其他** — `save_skill` 工具、菜单栏“录制工作流…”、原生助手 1.1.0

更早的发布说明：[GitHub Releases](https://github.com/parkjangwon/pawn/releases)。

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

### 决策模型（可选）

| 提供商 | 说明 |
|--------|------|
| **TypeSafe**（Jev） | 托管、官方。使用 [TypeSafe 控制台](https://console.typesafe.ai)的 API 密钥，经官方 `@typesafe-ai/sdk` 调用，由 TypeSafe 按输入 token 计费 |
| **Ollaya** | 在你的 Mac 上以 `http://localhost:11435` 运行开源决策模型（Laya、Winnow、decider 等）— [下载](https://ollaya.dev/download)后执行 `ollaya pull laya`。无需密钥，数据不出本机 |
| 自定义 | 任何 TypeSafe 兼容服务器（`/v1/systemone`） |

密钥加密保存在 `~/.pawn/decision.json`，所有请求都会先隐去机密信息。

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
