# Pawn — 代理指南

> **对象：** 安装、配置、调试或扩展 Pawn 的编码代理和维护者。
> **人：** [README.zh.md](../../README.zh.md)。
> **其他语言：** [English](./GUIDE.md) · [한국어](./GUIDE.ko.md) · [日本語](./GUIDE.ja.md)

拿到这个仓库并被要求修改时，先读本文件，然后只改被要求的范围。

---

## 1. 产品

桌面代理。Electron + React + TypeScript。BYOK：任何 OpenAI 或 Claude 兼容 API。数据在 `~/.pawn`。界面语言：en、ko、ja、zh。

- 技能、插件、MCP 和钩子由用户安装。产品自带的是内置工具。
- Claude Code 的布局在原处读取：`CLAUDE.md`、`AGENTS.md`、`.claude/skills`、`.claude/rules`、`~/.agents/`、Claude `settings.json` 的钩子、`.mcp.json`。
- 输入框占位符（`src/renderer/src/i18n/locales/*.json` 的 `chat.placeholder`）是一句邀请。不要写上 `/`、`@`、`$`。这些字符在键入时打开菜单：`/` 是命令和技能，`@` 是文件和文件夹，`$` 只在草稿开头是开局（`$ulw`）。界面上的控件是附件、录制（macOS）、Plan/Build、权限药丸、模型芯片和发送。

## 2. 安装

```bash
npx @parkjangwon/pawn
# 或
npm install -g @parkjangwon/pawn && pawn
```

发布：https://github.com/parkjangwon/pawn/releases/latest

| 系统 | 文件 |
|------|------|
| macOS | `pawn-<version>-universal.dmg`。未签名：第一次右键 → 打开。 |
| Windows | `pawn-<version>-x64-setup.exe`、`pawn-<version>-arm64-setup.exe` |
| Linux | `pawn-<version>-{x64,arm64}.AppImage` 和 `.deb` |

安装包缓存：`~/.pawn/installers/`。应用内检查：设置 → 系统。从源码构建的 Node：`^20.19.0 \|\| >=22.12.0`。

## 3. `~/.pawn`

| 路径 | 内容 |
|------|------|
| `pawn.db` | 项目、会话、消息、记录稿、用量、例程。WAL。记录稿与界面消息分开，以保住提示缓存前缀。 |
| `wiki/` | LLM 维基：智能体自行维护的互链 Markdown 页面（`global/`、`projects/<id>/`，各有 `pages/`、`index.md`、`log.md`）。纯文本文件，可作为 Obsidian 仓库打开。 |
| `hooks.json` / `hooks-settings.json` | 用户钩子，以及总开关。 |
| `config.toml` | 应用设置。 |
| `mcp.json` | Pawn 管理的 MCP 服务器。 |
| `decision.json` | 决策模型。密钥用 `safeStorage` 密封，文件模式 `0600`。 |
| `kiro.json` | Kiro 凭据，密封。 |
| `index/` | 本地代码索引（BM25 + dense）。 |
| `outputs/` | 卸下的工具输出，保留 7 天。用 `read_output` 读回。 |
| `profiles/` | 按仓库学到的命令和注意点。 |
| `reports/` | 自动化产物。 |
| `telegram.json` | Telegram 机器人令牌（已封存）、配对允许列表、聊天绑定。模式 `0600`。 |

## 4. 循环、模式、权限

主循环在 `src/renderer/src/stores/chatLoop.ts`。一条用户消息一直跑到最终回答、权限停下，或轮次上限。

| 旋钮 | 值 |
|------|-----|
| 代理模式 | `plan`（改动工具隐藏并拒绝）· `build`（全部表面；权限仍然生效）。`app_set_agent_mode`。 |
| 权限 | `ask` · `auto` · `yolo`。按工具分级见 `src/renderer/src/agent/toolPermission.ts`。 |
| Harness | `default`（50 轮，每次 parallel 调用 6 个任务）· `eco`（25 轮，层级上限 `mid`，3 个任务，池 2）· `maxing`（80 轮，12 个任务，池 8，同层优先更强的模型）。不越过权限、Plan 或花费上限，也不碰技能、MCP、钩子。用户明确选的推理强度优先于模式。 |
| Ultra Work | 消息开头的 `$ulw` / `$ultrawork`，或 `pawn-headless --ulw`。循环到目标被验证。句子中间的 `$`（`$5`、`$HOME`）不是开局。 |
| 工具配给 | 约 130 个 schema。核心工具常开。可选组在记录稿里已经用过、用户文本命中该组关键词，或模型调用 `load_tools` 之后才挂上。账号组在该账号连接之前保持隐藏。设置：smart（默认）或 all。 |
| 卡住 | 重复的相同调用、编辑空转或错误走阶梯：反省 → 更强的模型 → 另一个模型的意见 → 建议回滚 → 停下并询问。 |
| 验证阶梯 | 文件修改后，设置 → 代理 的 done-gate（typecheck/test）会在没有模型回合的情况下运行一次：auto/yolo 静默运行，ask 通过问题卡询问一次。失败会返回给模型；**连续两轮失败会把修复回合提升一个模型层级。** |
| 计划提醒 | 当路由判定任务为 `complex` 且会话没有计划时，循环会在编辑前要求先写 `update_plan`（软性指示，Plan Strip 显示进度）。 |
| 视觉验证 | 当一个回合修改了 Web UI 文件（html/css/jsx/tsx/vue/svelte…）时，循环会追加一条一次性指令：对运行中的 dev 服务器截图并查看 `browser_console` 后再结束。使用模型自己的浏览器工具。 |
| git 检查点 | 在本地 git 仓库的回合中，第一个修改文件的工具之前记录 `git stash create` + `store`（工作树不变）。失败的尝试可以通过 `git stash list` 立即回滚。 |
| 流式 | 只读工具可以在模型还在流式输出时开始。大结果先卸下，完整压缩之前按最旧优先清掉。 |

子代理硬上限是 25 轮。`parallel_agents` 接受的任务数不超过 harness 上限（默认 6）。

## 5. 工具

名字就是契约。Schema 在 `src/renderer/src/agent/toolDefs/`。

**文件、git、shell**（核心）：`read_file` `write_file` `edit_file` `delete_file` `list_dir` `search_files` `grep_search` `read_spreadsheet` · `git_status` `git_diff` `git_log` `git_add` `git_commit` `git_push` `git_branch` `git_stash` `git_pr_ready` · `shell_exec` `shell_poll` `shell_kill` `shell_wait` `terminal_list` `terminal_read`。

**代码智能**（核心，重构组除外）：`codebase_search` `semantic_search` `affected_tests` `repo_map` `run_checks` `issue_to_pr` · `lsp_diagnostics` `lsp_definition` `lsp_references` `lsp_hover` · 重构组：`lsp_symbols` `lsp_call_hierarchy` `lsp_code_actions` `lsp_apply_code_action` · `lsp_rename` 仍用于语义重命名。

**耐力**（`workspace` 组）：`working_notes` `checkpoint_mark` `checkpoint_restore` `project_profile` · `read_output` 是核心。

**代理**（核心）：`update_plan` `ask_user` `request_plan_approval` `load_tools` `load_skill` `install_skill` `write_artifact` `list_artifacts` · `save_skill` 属于 `skills` 组。

**网页**（核心，公开页面，不需要另一把密钥）：`web_search`（DDG HTML + HN + Wikipedia）`web_fetch`（平台 API → 头网格 → Jina）`web_research`。取回的文本是不可信数据。SSRF 拦截私网和回环主机。`must_invoke_browser` 表示改用 `browser_*`。改编自 [insane-search](https://github.com/fivetaku/insane-search)（MIT）。

**浏览器**（组 `browser`）：内置 Chromium，自己的 Cookie。`browser_navigate` `browser_snapshot` `browser_click` `browser_fill` `browser_select` `browser_read_text` `browser_eval` `browser_scroll` `browser_back` `browser_wait` `browser_screenshot` `browser_open_external` · 标签：`browser_tab_new` `browser_tab_list` `browser_tab_switch` `browser_tab_close` · `browser_console` `browser_network`。代理、界面面板和每个子代理各有自己的标签。

**电脑**（组 `computer`）：`computer_screenshot` `computer_zoom` `computer_ui_snapshot` `computer_ui_action` `computer_find` `computer_ocr` `computer_apps` `computer_windows` `computer_menu` `computer_open` `computer_click` `computer_mouse` `computer_drag` `computer_scroll` `computer_type` `computer_key` `computer_hold_key` `computer_clipboard` `computer_wait` `computer_displays` `computer_status`。

**调试**（组 `debug`）：`debug_start` `debug_breakpoints` `debug_control` `debug_eval` `debug_stop`。Node inspector、debugpy、delve、lldb-dap。

**维基**（核心）：`wiki_search` `wiki_read` `wiki_list` `wiki_write` `wiki_rename` `wiki_delete` `wiki_lint`。智能体用 `[[页面标题]]` 链接组织知识页面，回合前导语包含维基索引与最近活动 — 不可信数据。范围：`~/.pawn/wiki` 下的 project / global。秘密在写入时被拒绝。界面：设置 → 维基 — 图谱视图（滚轮/捏合缩放、拖拽平移、节点拖动、邻接高亮），支持排序、全选与批量删除的页面表格（删除会记录日志），活动日志。自动添加链接会在正文中的标题提及处插入[[链接]]，并为孤立页面添加 See also。

**决策**（核心，没有提供商时隐藏）：`decide`。每次调用最多 32 个带类型的问题。

**应用**（组 `app`；`app_set_agent_mode` 保持核心）：`app_open_tab` `app_close_tab` `app_set_model` `app_set_permission_mode` `app_set_reasoning` `app_toggle_theme` `app_list_automations` `app_create_automation`。

**子代理**（核心）：`spawn_agent` `parallel_agents` `list_agents` `await_agent` `cancel_agent` `research_report`。

**模型原生工具**（设置 → 代理，默认开启）：Anthropic API 上的 Claude 4+ 用 `str_replace_based_edit_tool` 和持久 `bash` 代替 `read_file` / `write_file` / `edit_file`。GPT-4.1 / GPT-5 / o3 / o4 / Codex 用 `apply_patch` 代替 `edit_file` / `write_file`。撤销账本、过期写入检查、权限和 Plan 门相同。Anthropic API 上的 Claude 也可以拿到它的原生电脑工具（`computer_20251124` 等，同一设置页）。

`load_tools` 的组：`browser` `computer` `debug` `refactor` `workspace` `github` `gitlab` `google` `codecommit` `app` `skills`。

## 6. 子代理与研究

`spawn_agent` 配置：`explore` 和 `plan`（只读），`worker`（实现；默认隔离 `worktree`，应用 `auto`），`code-reviewer`（只读）。自定义配置：`.pawn/agents/` 或 `.claude/agents/`。`background: true` 返回 run id；`await_agent` / `cancel_agent` 接受 id、名字或 `*`。

`parallel_agents` 并发跑独立任务，其余用 `depends_on` 排序。失败依赖的后续任务默认跳过，除非 `on_dependency_fail` 另有说法。

`research_report` 规划题目，跑并行工人（各自一个标签，混合 `web_*` 和 `browser_*`），去重来源，然后一个只有读取工具加 `write_artifact` 的合成器写报告。即使项目代理文件想放宽工具，这个合成器配置也保持窄。

## 7. 技能、钩子、mods、MCP

| 技能 | 位置 |
|------|------|
| 在聊天里要求 | Git URL → `install_skill`（默认 `user`，或 `project`） |
| 用户 | `~/.agents/skills/<name>/SKILL.md`、`~/.claude/skills/` |
| 项目 | `<project>/.claude/skills/`、`skills/`、`.agent/skills/` |
| 插件 | `.claude/plugins/` 加 `installed_plugins.json` |
| 代理来写 | `save_skill` → `~/.agents/skills`。Plan 中拒绝。 |

技能在 `load_skill` 之前只是目录里的一行。同时加载：`CLAUDE.md`、`CLAUDE.local.md`、`.claude/rules/*.md`、Codex `.agent/`、`~/.agents/AGENTS.md`。界面：设置 → 插件。

钩子按来源合并。相同命令或 URL 去重。`PreToolUse` 的拒绝在 `yolo` 里仍然拒绝。

| 来源 | 路径 |
|------|------|
| Claude 用户 | `~/.claude/settings.json` → `hooks` |
| Claude 项目 | `<project>/.claude/settings.json` → `hooks` |
| Pawn 用户 | `~/.pawn/hooks.json` |
| Pawn 项目 | `<project>/.pawn/hooks.json` |

事件：`SessionStart`、`UserPromptSubmit`（可以阻断）、`PreToolUse`（可以拒绝）、`PermissionRequest`、`PostToolUse`（参考）、`Stop`。处理程序 `type` 为 `command`（stdin JSON）或 `http`（POST JSON）。匹配器接受 Claude 别名（`Bash` → `shell_exec`，`Write` / `Edit` → write/edit）。界面：设置 → 代理 → 钩子。钩子只在主进程运行。

### mods（兼容 Claude Code）

`hooks/hooks.json` 含 `modules` 的插件才是 mod。它导出 `register(on)`，在代理进程内运行。这不是设置钩子。写法、同意、事件、界面和 `$` API 见 **[MODS.zh.md](./MODS.zh.md)**。

界面是设置 → 插件 → mods。聊天里有芯片和干预记录。多个 mod 监听同一事件时，芯片菜单会列出冲突并可以调整顺序。干预记录只在 `tool.call` 或 `prompt.submit` 这样运行时留下冲突行。每个 `AbovePrompt` 的 mod 各有一条。事件、同意和 `$` API 见 [MODS.zh.md](./MODS.zh.md)。`tool.call` 早于设置里的 `PreToolUse`。关掉 mods 不会卸下技能或 MCP。示例在 `examples/mods/first-mod/`。

MCP 发现走 stdio。id 冲突时项目覆盖用户：

1. `~/.claude.json`
2. `<project>/.mcp.json`
3. `~/.pawn/mcp.json`

界面：设置 → MCP。`user-claude` 条目只读；Pawn 不写 Claude Code 的文件。

## 8. 录制与回放（macOS）

一次演示变成一份 `SKILL.md`。回放使用 `browser_*`、`computer_*` 和 MCP。步骤是意图和可见标签，不是坐标。

- 开始：输入框录制按钮、`/record`、命令面板，或菜单栏。设置询问目标、每次运行会变的输入，以及来源：Pawn 浏览器（隔离世界脚本，元素名/角色/标签，`isTrusted` 事件）和/或 Mac 应用（`pawn-cua` ≥ 1.1.0）。
- 停止：录制条、菜单栏，或按两次 Esc。上限：30 分钟 / 3000 个事件。屏幕上留着红色药丸。
- 隐私：密码、一次性验证码、卡号和 macOS 安全输入框记为 "secret value, not recorded"。Pawn 自己的窗口和代理的合成输入被忽略。原始录制（事件 + 最多 8 张截图）只在内存里，为起草技能发给聊天模型一次，然后丢弃。
- 卡片动作：保存（`~/.agents/skills`，覆盖前询问）、运行（填入 `/<name>` 和输入）、自动化、润色（`save_skill`）。起草失败时留在内存里，可以重试，直到丢弃或退出。

代码：`src/main/recorder/*`、`src/main/ipc/recorder.ts`、`native/macos/pawn-cua/Recorder.swift`、`src/renderer/src/stores/recording.ts`、`src/renderer/src/agent/recordReplay.ts`、`src/renderer/src/agent/skillDrafting.ts`。

## 9. 提供商、路由、决策

预设包括 Kiro、OpenAI、Anthropic、OpenRouter、DeepSeek、OpenCode Go（`https://opencode.ai/zen/go/v1`）、Command Code（`https://api.commandcode.ai/provider/v1`）、Xiaomi MiMo（`https://api.xiaomimimo.com/v1`，OpenAI + Anthropic 路径）、Gemini、xAI、Groq、Moonshot、Ollama、LM Studio，以及任何自定义的 OpenAI 或 Claude 兼容 base URL。

- **订阅登录**（设置 → 提供商）：ChatGPT（Plus、Pro、Team、Enterprise；设备码；用量计在该订阅；API 密钥留在 OpenAI 预设）、Claude（Pro、Max、Team、Enterprise，或控制台 API 密钥；登录会话在退出前用于 `api.anthropic.com`）、xAI（SuperGrok 或 X Premium+ 设备码；退出登录时使用控制台 API 密钥）、Antigravity（用于 Antigravity 的 Google 账号；API 密钥留在 Gemini 预设）。刷新令牌加密保存在 `~/.pawn`。
- **同步模型**调用 `GET {baseUrl}/models`。种子模型只是引导。测试使用已经挂在该提供商上的模型。
- 密钥在 OS `safeStorage` 可用时使用它。
- 路由器：复杂度 `simple|medium|complex`，缓存粘性，工具失败后升级，提供商冷却 5 秒–120 秒，回合含图片时的视觉回退。DeepSeek 和 MiMo 的 thinking 工具循环必须回传 `reasoning_content`（没有则为空字符串）。
- **Kiro**（`apiFormat: kiro`，`src/main/kiro/*`）：AWS Builder ID / IAM Identity Center 设备流、Kiro API 密钥（`ksk_`），或只读导入 Kiro CLI / IDE 登录（Pawn 不刷新该登录）。聊天是 `GenerateAssistantResponse`。非官方协议。无界面：`KIRO_API_KEY` 或 CLI 登录。实机测试：`PAWN_KIRO_E2E=1`。

决策模型（设置 → 决策模型，`src/main/decision/*`）。同时只有一个活动提供商。没配置时什么都不改变。传输只在主进程，官方 `@typesafe-ai/sdk`，秘密会被涂掉。

| 提供商 | 说明 |
|--------|------|
| TypeSafe（Jev） | `https://api.typesafe.ai`，需要密钥，默认模型 `jev-latest`。 |
| Ollaya | `http://localhost:11435` 上的开放模型（Laya、Winnow 等）。除非有 `OLLAYA_API_KEY`，否则不需要密钥。 |
| 自定义 | 任何兼容 TypeSafe 的 `/v1/systemone`。 |

开关失败时都退回原行为：`decide`（默认开）；shell 风险检查（默认开）在自动批准的 `shell_exec` 看起来有破坏性（`≥ 0.5`）或外泄（`≥ 0.8`）时交回用户；路由辅助（默认关，键 `routerAssist`）可在 p ≥ 0.5 时给回合复杂度起名。无界面读取 `~/.pawn/decision.json`。密钥：`TYPESAFE_API_KEY` / `OLLAYA_API_KEY` / `PAWN_DECISION_API_KEY`。

## 10. 连接

设置 → 连接。令牌只留在 `~/.pawn`。

| 提供商 | 认证 | 工具 |
|--------|------|------|
| GitHub | OAuth | `github_whoami` `list_repos` `get_repo` `list_issues` `get_issue` `list_pulls` `get_pull` `review_pull` `list_commits` `get_file` `search_code` `search_issues` `create_issue` `draft_issue` `comment` `create_pull` |
| GitLab | PAT + base URL | `gitlab_whoami` `list_projects` `get_project` `list_issues` `get_issue` `list_merge_requests` `get_merge_request` `list_commits` `get_file` `search` `create_issue` `comment` `create_merge_request` |
| Google | OAuth，默认只读 | `google_whoami` `drive_search` `drive_read` `gmail_search` `gmail_read` `calendar_list` `tasks_list` `sheets_read` `docs_read` `slides_read`。重新连接并授予写范围之后：`google_gmail_send` `google_sheets_write` `google_calendar_create`。发送或创建前向用户确认。 |
| CodeCommit | IAM 密钥 | `codecommit_whoami` `list_repos` `get_repo` `list_branches` `get_branch` `list_commits` `get_file` |

桌面 OAuth 客户端 ID（Google、GitHub）在发布时注入。见 [.github/OAUTH_SECRETS.md](../../.github/OAUTH_SECRETS.md) 和 [PRIVACY.md](../../PRIVACY.md)。

## 11. Telegram

设置 → Telegram。用一个私密机器人通过 DM 驱动这个桌面代理。长轮询（无公共 webhook），与 OpenClaw、Hermes 相同。令牌只留在 main 进程。

- 陌生发信人只会收到配对码，不会触发代理回合。在设置中批准，或直接添加数字用户 id 以跳过配对码。群聊会被忽略。机器人文案跟随每个用户的 Telegram 语言（未知时用应用语言）。
- 已配对的消息会在所选项目中以不抢焦点的侧边栏聊天运行。命令遵循代理惯例：`/plan [请求]` 把会话切到计划模式并只读执行请求（或刷新任务计划），`/build` 切回构建模式，`/tasks` 显示当前聊天的任务列表。另有 `/new` 新聊天、`/stop` 取消、`/sessions` + `/chat <编号>` 切换聊天、`/changes` 查看文件更改、`/undo <编号>` 还原一批更改（绝不覆盖之后又被修改的文件）、`/model` 模型与上下文、`/compact` 压缩上下文、`/project` 文件夹、`/usage` 最近一天用量，`/help` `/status` `/whoami` 由机器人直接回答。
- `ask` 权限请求会以 Allow / Deny 按钮转发到该聊天。桌面对话框仍然可用。
- 第二个轮询器（HTTP 409）重试后网关停止。退出 Pawn 机器人随之停止。每次成功启动都会把命令列表和聊天菜单按钮注册到 Telegram，输入 `/` 时客户端会给出自动补全。

代码：`src/main/telegram/*`、`src/main/ipc/telegram.ts`、`src/renderer/src/stores/telegramBridge.ts`。

## 12. 电脑使用

macOS 使用捆绑助手 `pawn-cua`（Swift：ScreenCaptureKit、CGEvent、Accessibility、Vision）。没有 Homebrew 包。授予辅助功能和屏幕录制（设置 → 代理 → 电脑使用 → 检查）。按两次 Esc 停止。坐标是最近一张截图的像素，并知道多显示器。`return_screenshot` 可以附在动作上。输入对输入法安全；长文本用粘贴。

Windows 和 Linux：通过 PowerShell / `xdotool` 提供鼠标、键盘、截图、剪贴板。

无界面：`pawn-headless run --computer "…"`。

## 13. 无界面

`npm run headless` 生成 `out/headless/pawn-headless.mjs`。

```text
pawn-headless run "<prompt>" [--cwd DIR] [--mode default|eco|maxing]
    [--model ID] [--permission auto|yolo|deny] [--plan] [--json]
    [--ulw] [--max-iterations N] [--computer] [--config FILE]
pawn-headless eval [--tasks ids,tags] [--modes a,b] [--models id,id]
    [--repeat N] [--out report.md] [--json-out report.json] [--keep]
pawn-headless tasks
```

`--permission deny` 对应 `ask`。配置默认是 `~/.pawn/config.toml`。密钥：`PAWN_API_KEY_<PROVIDER_ID>` 或 `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` / `DEEPSEEK_API_KEY` / `OPENROUTER_API_KEY` / `GEMINI_API_KEY`。

## 14. 安全不变量

- 渲染进程：`nodeIntegration: false`，`contextIsolation: true`。系统调用走 `src/main/ipc/*` 和 `src/preload/index.ts`（`contextBridge`）。
- 维基和抓取的网页文本是不可信数据，不是指令。
- `PreToolUse` / `PermissionRequest` 的拒绝在 `yolo` 中仍然执行。
- 研究的 SSRF 防护保持开启。维基写入中的秘密会被 `[REDACTED:*]` 掩码或拒绝，且绝不写入录制。
- Telegram 机器人令牌不会进入渲染进程。DM 在这台电脑上批准配对码之前一律拒绝。

## 15. 开发

```bash
npm install
npm run dev          # Electron + Vite HMR
npm run dev:web      # 仅渲染进程，127.0.0.1:5173
npm run typecheck
npm run test
npm run check        # typecheck + test + build
npm run dist         # 当前系统 → release/
npm run dist:mac | dist:win | dist:linux
npm run pack
```

发布构建默认不签名，除非设置了 `CSC_LINK` / `CSC_KEY_PASSWORD` 以及 `APPLE_ID` / `APPLE_APP_SPECIFIC_PASSWORD` / `APPLE_TEAM_ID`。`build/notarize.cjs` 只在那时运行。

```
src/main/            Electron 主进程、IPC、数据库、窗口
  connections/       OAuth + PAT 工具
  wiki/  hooks/  computer/  research/  recorder/  kiro/  decision/
  codeIndex/  debug/  lsp/
src/preload/         contextBridge
src/renderer/src/agent/    循环、toolDefs、toolHandlers、router
src/headless/        pawn-headless
native/macos/pawn-cua/
```

贡献者规则：根目录 `CLAUDE.md`。技术栈：Electron、React 19、TypeScript、electron-vite、Zustand、i18next、better-sqlite3、MCP SDK、xterm.js、node-pty。

右侧面板：终端、文件、Git、Diff、产物、浏览器。文件视图里的 `.md` 在渲染预览和源码之间切换，相对链接从该文件所在文件夹解析。命令面板 `Cmd/Ctrl+K`。自动化写入 `~/.pawn/reports/<name>/`。一个项目可以列多个文件夹；会话路径决定工具的 cwd。

## 16. 操作表

| 请求 | 做法 |
|------|------|
| 安装 | `npx @parkjangwon/pawn`，或发布包。macOS Gatekeeper：右键 → 打开。 |
| 添加提供商 | 设置 → 提供商 → 预设或 base URL → 同步模型。DeepSeek/MiMo thinking 必须回传 `reasoning_content`。电脑使用配视觉模型。 |
| 安装技能 | 用 git URL 调 `install_skill`，或复制到 `~/.agents/skills/<name>/SKILL.md`。 |
| 在 Mac 上使用电脑 | 捆绑的 `pawn-cua`。授予辅助功能 + 屏幕录制。不要安装 cliclick。 |
| MCP | 设置 → MCP，或 `~/.pawn/mcp.json`，或项目的 `.mcp.json`。 |
| 钩子 | `~/.pawn/hooks.json` 或 Claude `settings.json`。合并 + 去重。拒绝优先。 |
| 维基 | 设置 → 维基。文件：`~/.pawn/wiki/`（可用 Obsidian 打开）。 |
| 连接 | 设置 → 连接。Google 写入工具需要一次授予写范围的重新连接。 |
| 录制工作流 | macOS。录制按钮或 `/record` → 做一遍 → 停止 → 保存。之后 `/<skill-name>`。 |
| 决策模型 | 设置 → 决策模型。TypeSafe 密钥，或 `ollaya serve` + `ollaya pull laya`。 |
| 无界面 | `npm run headless`，然后 `node out/headless/pawn-headless.mjs run "…"`。 |
| 构建 | 上面的 Node 版本，`npm install`，`npm run check`。 |
| 工具被拒绝 | 权限模式、Plan 模式、`PreToolUse` 拒绝、账号未连接、工具组未加载。 |

## 17. 许可证

MIT。OAuth 隐私：[PRIVACY.md](../../PRIVACY.md)。
