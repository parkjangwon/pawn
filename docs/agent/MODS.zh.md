# mods

Pawn 的 Claude Code 兼容 mods。`hooks/hooks.json` 里有 `modules` 的本地插件才是 mod。模块导出 `register(on)`，在**代理进程内部**运行。它可以观察一轮、改写、代为作答，或绘制聊天界面。

这不是设置钩子。设置钩子（`~/.pawn/hooks.json`、Claude 的 `settings.json`）是主进程里的 shell 或 HTTP。mods 是带 `$` API 的 JavaScript / TypeScript 中间件。

关掉 mods 时，技能和 MCP 仍然可用。

运维摘要见 [GUIDE.zh.md](./GUIDE.zh.md) §7。其他语言：[English](./MODS.md) · [한국어](./MODS.ko.md) · [日本語](./MODS.ja.md)。

## 1. 目录

```text
my-mod/
├── .claude-plugin/plugin.json    # 或 .pawn-plugin/plugin.json
└── hooks/
    ├── hooks.json                # { "modules": ["./register.js"] }
    └── register.js               # export function register(on) { … }
```

`plugin.json` 需要 `name`。`version` 和 `description` 会显示在设置里。同意绑定的是这个版本。

入口可以是 `.js`、`.mjs` 或 `.ts`。TypeScript 会在 import 之前用编译器去掉类型。列表里的每个模块都会按顺序加载，且都必须导出 `register`。没有 `modules` 的插件不会成为 mod。

示例：`examples/mods/first-mod/`。

## 2. 从哪里找

| 来源 | 路径 | 说明 |
|------|------|------|
| 用户 | `~/.pawn/mods/<name>/` | 设置里安装示例会把 `first-mod` 复制到这里 |
| 额外文件夹 | 设置中的绝对路径 | 设置 → 插件 → mods → 选择文件夹 |
| 项目 | `<project>/.claude/plugins/` | 随当前打开的项目加载 |
| Claude 安装项 | `installed_plugins.json` | 打开「也扫描 Claude 插件」之前不会看 |

设置文件：`~/.pawn/mods-settings.json`。

| 字段 | 含义 |
|------|------|
| `enabled` | 总开关。 |
| `disableAllHooks` | 为 true 时不加载已安装的 mods。也就是关掉「运行 mods」。技能和 MCP 不受影响。 |
| `disabledPlugins` | 同意之后又关掉的名字。 |
| `consentedPlugins` | `{ "name", "version" }[]`。只有从未出现过该键的旧文件才是 `null`（那些 mods 视为已允许）。 |
| `pluginDirs` | 额外的绝对路径。 |
| `readClaudePlugins` | 扫描 Claude 安装项。默认 `false`。 |
| `pluginOrder` | 同一层级里，排在前面的名字先运行。没列出的名字保持发现顺序，排在后面。聊天冲突菜单里的提前/延后会写入这个字段。 |

旧列表里的字符串读作版本 `*`（任意版本）。写明版本的同意必须和 `plugin.json` 一致。同名的新构建在重新审核之前保持关闭。

## 3. 同意与风险

没有沙箱。文件、shell、网络和聊天都使用你的账户权限。

加载前，设置会打开审核对话框：

- 由注册的钩子和源码里的 `$.…` 调用得出的能力标签
- 风险：进程或网络为高，文件或工具为中，其余为低
- 你允许的版本

允许后，该版本写入 `consentedPlugins`，名字会从 `disabledPlugins` 去掉。撤回同意会删掉条目并关闭该名字。

静态检查是对目录调用 `mods.validate`（钩子列表、`$` 调用、未知事件名）。不在 `src/main/mods/validate.ts` 的 `KNOWN_EVENTS` 里的名字是错误。这份名单比应用实际发出的事件更宽。被接受但实际不会发出的事件会在检查结果里给出警告。实际发出的是第 5 节。

## 4. `register(on)`

```js
export function register(on) {
  on('tool.call', async ($, event, next) => next(event))

  on('tool.call', { tool: 'shell_exec' }, async () => {
    return { deny: '不要用 shell' }
  })
}
```

- `on(event, handler)` 或 `on(event, matcher, handler)`。
- 匹配器是扁平对象。每个字段必须等于事件上的同名字段。字符串不区分大小写。
- 调用 `next(event)` 才会继续。可以传入改写后的对象。
- 不调用 `next` 就返回，表示**代答**。包括 Pawn 在内的后续链不会运行。
- `next.to(event, tier)` 跳到 `append`、`builtin` 或 `core`。
- `on(…).catch(handler)` 在抛出或超出时间预算时运行。
- 每个钩子大约 **10 秒**。超时后跳过该钩子，链继续。
- 同一事件内的顺序是层级：`prepend`、`user`、`append`、`builtin`、`core`。同一层级先看 `pluginOrder`，其余保持发现顺序。聊天菜单的提前/延后会写入 `pluginOrder` 并重新加载。两个以上已加载的 mod 监听同一事件时，菜单会列出冲突。干预记录只在 `tool.call` 或 `prompt.submit` 真的这样运行时追加一行。

第一个参数是 `$`。`$.plugin.name` 和 `$.plugin.root` 标识这个 mod。

## 5. 应用实际发出的事件

校验器接受更多 Claude Code 事件名。应用目前只发出下面这些。

| 事件 | 何时 | 能做什么 |
|------|------|----------|
| `session.start` | 加载之后，每个已加载的 mod 一次 | 每次发出时，所有 `session.start` 钩子都会运行。`plugin` 是刚加载的那个 mod。只在 `plugin` 等于 `$.plugin.name` 时注册命令。同名 `$.command.register` 第二次会抛错。 |
| `session.end` | 卸载时，每个已加载的 mod 一次 | 同样，所有钩子都会运行。`plugin` 是正在结束的 mod。只观察。 |
| `session.compact` | 对话被压缩之后 | 观察。载荷 `{ sessionId }`。 |
| `prompt.submit` | 用户文本，早于设置里的 `UserPromptSubmit`。mod 最多看到前 20 万字。原样返回则保留其余部分。改写则用改写结果替换整条消息。 | `next({ ...e, text })` 改写。不调用 `next` 而返回 `{ drop: "原因" }` 则取消这一轮。 |
| `turn.start` | 提示被接受之后 | 观察。载荷含 `sessionId`。 |
| `turn.complete` | 一轮结束时 | 观察。载荷 `{ sessionId, status }`。 |
| `tool.call` | 早于设置里的 `PreToolUse` | `next(e)` 继续。`{ deny: "原因" }` 拦截。`{ result }` 跳过工具并代答。载荷含 `tool` 和参数。 |
| `tool.check` | 权限检查附近 | 返回或改写 `{ decision: "allow" \| "deny" }`。 |
| `command.run` | 用户输入已注册的 `/名字`，或代码调用了 `$.command.run` | 返回 `{ text }`，作为 mod 的回复出现在聊天里。 |
| `ui.render` | 旋转指示，以及输入框上方的条（`AbovePrompt`） | 旋转指示是一条链，最后的 `props.suffix` 留下。`AbovePrompt` 会单独调用每个匹配的 mod。返回自己这一条的 `props.tree` 和 `props.plugin`。看不到其他 mod 的树。 |
| `ui.press` / `ui.input` / `ui.select` | 用户操作 mod 树里的 Button、Input、Select | 读取 `id` 和 `value`。 |

工具顺序：`tool.call` → 设置 `PreToolUse` → Plan 模式检查 → `tool.check` / 权限 → 工具。

`prompt.submit` 早于设置钩子 `UserPromptSubmit`。即使 mod 改了文本，设置钩子拒绝时这一轮仍会停。

## 6. 聊天界面

处理函数拿不到 DOM。`$.ui.resolve(event)` 返回冻结的树。

元素：`Box`、`Text`、`Markdown`、`Code`、`Link`、`Button`、`Input`、`Select`。

`$.ui.invalidate()` 会再次绘制 `ui.render`。`$.ui.status` 是芯片下一行，`$.ui.toast` 是角落提示（不推动输入框），`$.ui.notice` 是可关闭的一行，并写入干预记录。`$.ui.open({ id, title, tree })` 是停靠面板。没有 `tree` 时面板会说明没有可显示的内容。旋转指示的 `props.suffix` 加在“思考中”那一行末尾。

芯片列出此聊天已加载的 mods。在菜单里关掉一个会写入 `disabledPlugins` 并重新加载。多个 mod 监听同一事件时会出现冲突行，并可以用提前/延后调整顺序。每个绘制 `AbovePrompt` 的 mod 各有一条。干预记录保存拦截、代答、按钮，以及 `tool.call` 和 `prompt.submit` 的冲突。清空聊天界面时记录一并清空。

`AbovePrompt` 的写法与 [MODS.md](./MODS.md) §6 的例子相同。示例源码在 `examples/mods/first-mod/hooks/register.js`。

## 7. `$` API

| 命名空间 | 作用 |
|----------|------|
| `$.command.register({ name, description })` | 斜杠命令。名字为 `[A-Za-z0-9_-]{1,64}`。内置和重复会被拒绝。 |
| `$.command.run` / `$.command.list` | 运行或列出命令。 |
| `$.tool.register({ name, description, inputSchema, handler })` | 以 `mcp__<plugin>__<name>` 暴露给模型。钩子没有先回答时才运行 `handler(args)`。MCP 已经占用的名字留给 MCP。 |
| `$.tool.call` | 发出 `tool.call`。 |
| `$.prompt.submit({ text, asUser })` | 把提示送进聊天。 |
| `$.session` | `id`、`cwd`、`messages`、`usage`。 |
| `$.fs.*` | 经应用文件 IPC。上限 4 MiB。路径相对当前聊天的 cwd。`list` 的 `size` 恒为 `0`。 |
| `$.process.run(argv, { timeoutMs, cwd })` | shell。沙箱保持打开。默认 30 秒，最长 10 分钟。`$.env.set` 的值只合并进这个子进程。风险为高。 |
| `$.http.fetch(url, init)` | 仅 `http` / `https`。`init` 为 `method`、`headers`、`body`、`timeoutMs`（默认 30 秒，最长 120 秒）。4xx 和 5xx 也返回 `{ status, ok, headers, text }`。非法 URL 或其他协议会抛错。风险为高。 |
| `$.store.*` | 本机上按 mod 分开的键值。 |
| `$.clock.now` / `sleep` / `after` / `every` | 计时器。用 `after` / `every` 返回的句柄取消。 |
| `$.env.get` / `set` | `get` 先读加载时捕获的应用环境，再读这个 mod 写入的值。快照只在 mod 源码引用 `$.env` 时才会采集。`set` 只作用于这个 mod 和之后的 `$.process.run`。不改应用进程的环境。 |
| `$.model.complete({ prompt, system, model, maxTokens, timeoutMs })` | 用路由到的模型，或已配置的 `model`，做一次补全。不写入聊天记录。空提示、未知模型或空回答返回 `{ isAnswered: false, reason }`。`timeoutMs` 默认 60 秒，上限 180 秒。`maxTokens` 只降低提供方的输出上限。 |
| `$.turn.abort()` | 停止当前轮。 |
| `$.ui.log` | 本轮留在内存里。聊天界面不绘制它。 |

Claude Code 文档里的字段不一定都有。上表就是 `src/renderer/src/agent/mods/api.ts` 的实现。

## 8. `first-mod` 与代码

`examples/mods/first-mod/` 统计 `tool.call`，注册 `/tally` 和 `ping` 工具，在输入框上方绘制重置按钮和备注框，并设置旋转指示的后缀。模型可以调用 `mcp__first-mod__ping`，结果是 `pong`。

在 **设置 → 插件 → mods → 安装示例 mods** 之后，于审核对话框中允许。思考中那一行会出现 `· tool calls: N…`。`/tally` 用次数作答。

| 关注点 | 路径 |
|--------|------|
| 发现、同意、检查 | `src/main/mods/` |
| IPC | `src/main/ipc/mods.ts` |
| 运行时、`$`、界面存储 | `src/renderer/src/agent/mods/` |
| 设置与聊天 | `ModsSettingsPanel.tsx`、`ModsChrome.tsx`、`ModTree.tsx` |
| 接入一轮 | `chatLoop.ts`、`toolExecutor.ts` |
| 无界面 | `src/headless/nodeApi.ts` 的 `mods.*` |
