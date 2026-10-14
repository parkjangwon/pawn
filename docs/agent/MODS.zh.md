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

- 由注册的钩子和源码里的 `$.…` 调用得出的能力列表：每项能力一行，含名称和一行说明（`strings.ts` 中的 `settings.modsSection.cap.<id>` 与 `settings.modsSection.capDesc.<id>`，id 在 `src/renderer/src/agent/mods/capabilities.ts`）。新增能力需要 id、规则和这两条文字
- 风险：进程或网络为高，文件、工具、读取消息正文（`message.render`）、更改主题（`$.theme.vars` / `$.theme.css`）或显示自定义视图（`$.view.open`）为中，其余为低
- 路线图 E 新增：更改模型请求（`model.request`）或提供 provider（`$.provider.register`）为高，读取模型回复（`model.response`）或添加子代理（`$.agent.register`）为中，查看通知（`notification`）为低
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
| `model.request` | 每次主聊天模型调用之前（每次重试也会） | `next({ ...e, systemAppend })` 向系统提示追加最多 8 000 个字符，包在 `<mod-instructions>` 中。其他字段不可写。负载 `{ sessionId, round, provider, model, messageCount, lastUserText }`。 |
| `model.response` | 每次模型调用成功之后 | 仅观察。负载 `{ sessionId, round, provider, model, text, toolCalls, usage }`。 |
| `notification` | Pawn 发出的每条桌面通知 | 仅观察。负载 `{ title, body, source }`。mod 不能隐藏或改写通知。 |

工具顺序：`tool.call` → 设置 `PreToolUse` → Plan 模式检查 → `tool.check` / 权限 → 工具。

`prompt.submit` 早于设置钩子 `UserPromptSubmit`。即使 mod 改了文本，设置钩子拒绝时这一轮仍会停。

## 6. 聊天界面

处理函数拿不到 DOM。`$.ui.resolve(event)` 返回冻结的树。

元素：`Box`、`Text`、`Markdown`、`Code`、`Link`、`Button`、`Input`、`Select`。

`$.ui.invalidate()` 会再次绘制 `ui.render`。`$.ui.status` 是芯片下一行，`$.ui.toast` 是角落提示（不推动输入框），`$.ui.notice` 是可关闭的一行，并写入干预记录。`$.ui.open({ id, title, tree })` 是停靠面板。没有 `tree` 时面板会说明没有可显示的内容。旋转指示的 `props.suffix` 加在“思考中”那一行末尾。

芯片列出此聊天已加载的 mods。在菜单里关掉一个会写入 `disabledPlugins` 并重新加载。多个 mod 监听同一事件时会出现冲突行，并可以用提前/延后调整顺序。每个绘制 `AbovePrompt` 的 mod 各有一条。干预记录保存拦截、代答、按钮，以及 `tool.call` 和 `prompt.submit` 的冲突。清空聊天界面时记录一并清空。

`AbovePrompt` 的写法与 [MODS.md](./MODS.md) §6 的例子相同。示例源码在 `examples/mods/first-mod/hooks/register.js`。

### UI 插槽 (UI slots)

`$.slot.*` 把 mod 的控件放在输入框上方横条以外的固定位置。每个调用都接收一个仅在本 mod 内使用的 `id`（`[A-Za-z0-9_-]{1,64}`）。用同一个 `id` 再次调用会替换该项，mod 就是这样重绘的。树与上文相同，是 `$.ui.resolve()` 的元素。

| 调用 | 显示位置 | 权限 |
|------|----------|------|
| `$.slot.sidebar({ id, title, tree })` | 左侧边栏底部可折叠的分区。点击标题即可折叠。 | `sidebar` |
| `$.slot.panel({ id, title, tree })` | 目前与 `sidebar` 位置相同。右侧面板还没有 mod 标签页。 | `sidebar` |
| `$.slot.header({ id, label, title })` | 聊天标题栏右侧的按钮。 | `toolbar` |
| `$.slot.toolbar({ id, label, title })` | 输入框一行中附件按钮旁的按钮。在空白主页上隐藏。 | `toolbar` |
| `$.slot.settings({ id, title, tree })` | **设置 → Mods** 下的页面，每个页面一个导航项。 | `settingsPage` |
| `$.slot.statusbar({ id, text, title, tree })` | 左侧边栏底部、设置按钮上方的小项目（Pawn 没有可见的状态栏）。文本项是按钮；`tree` 项绘制该树。 | `statusbar` |
| `$.slot.palette({ id, title, hint })` | 命令面板 **Mods** 分组中的条目。执行时发送带 `slot: 'palette'` 的 `ui.press`。 | `palette` |
| `$.slot.shortcut({ id, keys, title })` | 键盘快捷键，例如 `Mod+Shift+U`（`Mod` 在 macOS 上是 Cmd，其他平台是 Ctrl）。按下时发送带 `slot: 'shortcut'` 的 `ui.press`。 | `shortcuts` |
| `$.slot.remove({ slot, id })` / `$.slot.list()` | 删除本 mod 的一个项目 / 列出它们。 | 无 |

- 点击以带 `{ plugin, id, slot }` 的 `ui.press` 到达。插槽树里的按钮、输入框和选择框也会带同样的 `slot` 字段发送 `ui.press`、`ui.input`、`ui.select`。请用 `{ plugin: '<你的 mod>' }` 过滤。
- 项目属于该项目的 mod 运行时：切换聊天时保留，mod 卸载、被关闭或运行时重新加载时消失。
- 每种插槽在审核对话框中都是单独的权限。源码中没有逐字写出的 `$.slot.<种类>` 调用会被运行时拒绝，因此 mod 无法使用对话框未显示的插槽。请写成 `$.slot.header(...)`，不要写 `$.slot[name](...)`。
- 示例：`examples/mods/ui-slots-demo/` 使用了所有插槽。默认不安装；复制到 `~/.pawn/mods/ui-slots-demo` 后允许即可。
- **快捷键冲突会被报告，绝不会被静默覆盖。** 当组合键与应用快捷键（设置 → 快捷键）、应用保留的组合键（复制/粘贴/撤销、`Mod+F`、`Mod+S`、`Mod+Q`、`Mod+R`、缩放、`Alt+P`、`Escape`、`Enter`、`Tab`）或其他 mod 的快捷键相同时，`$.slot.shortcut` 会抛出异常，并在 mod 时间线中记录一条 `conflict`。先注册的 mod 保留该组合键。之后若把应用快捷键改成 mod 的组合键，以应用为准。不含 `Mod`/`Ctrl`/`Alt` 的组合键在输入框中打字时不会触发。

### 消息渲染钩子

`on('message.render', ($, e, next) => …)` 用于装饰已完成的聊天消息。权限：`messages`（mod 会读取消息文本）。

- `e` = `{ messageId, role, text, sessionId, props: { badges, actions, blocks } }`。向数组追加后 `return next({ ...e, props })`。
- `badges`：`{ id, text, tone? }`（`tone`：`info`、`success`、`warning`、`danger`）。`actions`：`{ id, label }`，消息操作行中的按钮；点击时发送带 `{ slot: 'message', id, messageId, sessionId, role }` 的 `ui.press`。`blocks`：`{ id, tree }`，消息下方的 `$.ui.resolve()` 树。每条消息每种最多 8 个。
- 每个条目都会标记添加它的 mod，后面的 mod 无法接管前面 mod 的条目或点击。
- **流式输出与性能：** 回复完成后才发送；正在流式输出的行不会被装饰。结果按（聊天、消息、文本）缓存，仅在文本变化、mod 请求重绘（`$.ui.invalidate`，或任何插槽点击之后）或 mod 重新加载时重新询问。未加载 `message.render` 钩子时不发送任何事件。钩子抛错或超时时消息保持原样。
- **按聊天区分：** `e.sessionId` 是消息所属的聊天，而不是屏幕上的聊天；钩子内的 `$.session` 也是该聊天。请用 `e.sessionId` 区分每个聊天的状态。
- 与插槽一样，事件名必须按字面写出（`on('message.render', …)`），否则 `on` 会抛出 `message.render refused`。


### 主题 (Theming)

`$.theme.*` 用来给 Pawn 换色，并为 mod 自己的界面加样式。每个调用都接收一个仅在本 mod 内使用的 `id`（`[A-Za-z0-9_-]{1,64}`），用同一个 `id` 再次调用会替换它。`mode` 为 `light`、`dark` 或 `all`（默认）。

| 调用 | 作用 | 权限 |
| --- | --- | --- |
| `$.theme.vars({ id, vars, mode })` | 覆盖应用根上的 CSS 自定义属性，例如 `{ '--accent': '#2f6b3a' }`。只接受 `--名称` 键（缺少时自动加 `--`），每次最多 128 个，值最多 200 个字符。 | `theme` |
| `$.theme.css({ id, css, mode })` | 用 `@scope ([data-plugin="<mod>"])` 包裹的样式表，只作用于本 mod 用 `$.slot.*` 绘制的元素（`:scope` 是插槽根）。最多 32KB。 | `theme` |
| `$.theme.remove({ id })` / `$.theme.list()` | 删除本 mod 的一项 / 列出它们。 | 无 |

- 可能加载资源或跳出代码块的内容会被拒绝并报错：`url(`、`@import`、`image-set(`、`expression(`、`<`、`\`、不配对的花括号，以及 `@scope`、`@layer`、`@font-face`、`@namespace`、`@charset`。变量值还拒绝 `;`、`{`、`}`。
- 常用变量：`--bg-primary`、`--bg-secondary`、`--bg-sidebar`、`--text-primary`、`--text-secondary`、`--text-muted`、`--border-color`、`--primary`、`--accent`、`--danger`、`--success`（完整列表见 `src/renderer/src/styles/global.css`）。
- 用户可以只关闭某个 mod 的主题而不关闭 mod：在 mods 菜单（输入框上方的标签）中该 mod 旁边的 **Theme** 开关。选择在重启后保留。重新加载 mod 时主题会被清除。
- 与插槽一样，源码中没有逐字写出的 `$.theme.vars` / `$.theme.css` 调用会被运行时拒绝。审核对话框中显示为 **Change colors and styles**。风险为**中**：主题无法读取任何内容，也无法访问网络，但可以让 Pawn 的某些部分看起来像别的东西。
- 防伪装：同意对话框、mods 菜单（含 Theme 开关）和 **设置 → Mods** 是 `.mods-trusted` 根。它们重新声明默认变量，mod 的变量规则使用 `:not(.mods-trusted)`，因此 `$.theme.vars` 无法影响它们。限定范围的样式表也无法影响它们，并且 `position: fixed` / `sticky` 会被拒绝，mod 无法在其上浮出伪造的对话框。
- 示例：`examples/mods/theming-demo/` 切换两套配色（浅色和深色），并为自己的侧边栏分区加样式。默认不安装；复制到 `~/.pawn/mods/theming-demo` 后允许即可。

### 自定义视图 (Custom views)

`$.view.*` 在沙箱 iframe 中显示 mod 自己的 HTML 页面。当 `$.ui.resolve()` 元素不够用时（图表、编辑器、自由布局）使用。

| 调用 | 作用 | 权限 |
| --- | --- | --- |
| `$.view.open({ id, title, html, script, placement, height })` | 打开或替换视图 `id`。`placement` 为 `panel`（左侧边栏，默认）、`tab`（聊天上方的标签栏）或 `modal`（带 mod 名称的对话框）。`html` 和 `script` 各最多 256KB，`height` 为 60–2000px。 | `views` |
| `$.view.post({ id, data })` | 向视图发送 JSON 数据（`pawn.onMessage`）。 | 无 |
| `$.view.close({ id })` / `$.view.list()` | 关闭本 mod 的一个视图 / 列出它们。 | 无 |

视图内有一个全局 `pawn` 对象：

- `pawn.call(method, ...args)` → Promise。只有这些方法能到达 mod 的 `$`：`ui.toast`、`ui.notice`、`ui.status`、`store.get/set/delete/keys`、`fs.read`、`fs.list`、`fs.exists`、`http.fetch`、`model.complete`、`clock.now`。每个方法还必须在 mod 源码中逐字出现（`$.store.get`），因此审核对话框已经列出过。其余调用会被拒绝。
- `pawn.send(data)` → mod 通过 `on('view.message', { plugin: '<mod>' }, ($, e, next) => …)` 收到 `{ plugin, id, data }`。
- `pawn.onMessage(fn)` 接收 `$.view.post` 的数据。`pawn.resize(px)` 设置高度（panel 和 modal）。

沙箱与 CSP：

- 仅 `sandbox="allow-scripts"`，没有 `allow-same-origin`：不透明源，无法访问 Pawn 窗口、`window.api`、存储、Cookie、弹窗、表单或顶层导航。
- 页面以自己的 CSP 开头：`default-src 'none'`，没有 `connect-src`、框架、Worker 或表单；图片和字体只能是 `data:`。视图本身无法访问网络；远程请求只能通过需要 `$.http.fetch`（及其同意）的 `pawn.call('http.fetch', …)`。
- 脚本只从 `script`（和桥接脚本）运行，Pawn 会给它们加上每次启动生成的 nonce。打包版中 `html` 里的 `<script>` 和 `onclick=` 会被阻止；请在 `script` 中使用 `addEventListener`。
- 视图无法自行导航到任何地方（主进程会取消），因此数据无法通过 URL 外泄。
- 浅色/深色：主题变量（`--bg-primary`、`--text-primary`、`--accent`、`--border-color` 等）会复制到页面的 `:root`，主题变化时视图会重新加载。
- 风险为**中**：视图运行的不是你写的代码，且模态框可能看起来像对话框，因此模态框始终显示 `mod: <名称>`。
- 示例：`examples/mods/views-demo/`（用 `$.store` 保存的面板计数器，以及标签页和对话框）。默认不安装；复制到 `~/.pawn/mods/views-demo` 后允许即可。

### 模型事件、子代理和 provider

这些钩子需要高度信任，因此除非事件名在源码中逐字写出，运行时会拒绝 `on('model.request' | 'model.response' | 'notification', …)` 和 `message.*`。计算出的名称无法触达它们。

| 调用 | 作用 | 权限 |
| --- | --- | --- |
| `$.agent.register({ name, description, prompt, tools, disallowedTools, model, maxTurns })` | 添加助手可以启动的子代理。名称为 `<mod>-<name>`，因此不能替换内置代理。磁盘上同名的代理文件优先。传 `markdown` 而不是 `prompt` 可使用 Claude Code 代理文件（frontmatter + 正文）。mod 代理始终在 worktree 中以 `apply: none` 运行，`maxTurns` 上限为 25。返回完整名称。 | `subagents`（中） |
| `$.agent.remove({ name })` / `$.agent.list()` | 删除本 mod 的一个代理 / 列出。 | 无 |
| `$.provider.register({ id, name, apiFormat, baseUrl, models })` | 提供一个 provider（`openai` 或 `claude` 格式）和最多 32 个模型。`baseUrl` 必须是 `https`，或 `localhost`/`127.0.0.1` 上的 `http`，且不能包含凭据。不会自动改变任何东西：提议显示在 **设置 → Mods → Providers offered by mods**，点 **Add** 才会以关闭、无密钥的状态添加 provider 和模型。 | `providers`（高） |
| `$.provider.remove({ id })` / `$.provider.list()` | 撤回提议 / 列出本 mod 的提议。 | 无 |

注册只在本会话有效，mod 重新加载时清除。与插槽一样，源码中没有逐字写出的 `$.agent.register` / `$.provider.register` 调用会被拒绝。

示例：`examples/mods/events-demo/` 用到了以上全部。默认不安装；复制到 `~/.pawn/mods/events-demo` 并允许即可。

### Claude Code 兼容

Pawn 读取 Claude Code 插件目录结构（`.claude-plugin/plugin.json`、`hooks/`、`agents/`、`skills/`）。可沿用的部分：

| Claude Code | Pawn |
| --- | --- |
| 钩子 `SessionStart` / `SessionEnd` | `session.start` / `session.end` |
| 钩子 `UserPromptSubmit` | `prompt.submit` |
| 钩子 `PreToolUse` | `tool.call` |
| 钩子 `PermissionRequest` | `tool.check` |
| 钩子 `Stop` | `turn.complete` |
| 钩子 `PreCompact` | `session.compact`（在压缩之后运行） |
| 钩子 `Notification` | `notification` |
| 钩子 `PostToolUse`、`SubagentStop` 等 | 校验器接受，但不会发出（警告） |
| 代理文件（`agents/*.md`） | 用 `$.agent.register({ markdown })` 加载，或放进 `~/.claude/agents` / `.claude/agents` |
| 技能（`skills/*/SKILL.md`） | 从常规技能目录读取，无需 mod 调用 |
| 通过 `ANTHROPIC_BASE_URL` 的自定义模型 | `$.provider.register` 提议，由用户添加 |

`on()` 接受原样的 Claude Code 名称（`'PreToolUse'`）或带 `classic.` 前缀的名称，审核对话框按 Pawn 事件显示。Claude Code `hooks.json` 中的 shell `command` 钩子不会由 mod 运行，应放到 设置 → Hooks。mod 钩子是在 `modules` 中列出的 JavaScript 模块。

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
