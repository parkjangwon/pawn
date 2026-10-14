# Mods

Claude Code–compatible mods for Pawn. A mod is a local plugin whose `hooks/hooks.json` lists a `modules` entry. The module exports `register(on)` and runs **inside the agent process**. It can watch a turn, rewrite it, answer it, or draw chat UI.

This is not a settings hook. Settings hooks (`~/.pawn/hooks.json`, Claude `settings.json`) are shell or HTTP commands in the main process. Mods are JavaScript or TypeScript middleware with a `$` API.

Skills and MCP keep working when mods are off.

Operator summary: [GUIDE.md](./GUIDE.md) §7. Other languages: [한국어](./MODS.ko.md) · [日本語](./MODS.ja.md) · [中文](./MODS.zh.md).

## 1. Layout

```text
my-mod/
├── .claude-plugin/plugin.json    # or .pawn-plugin/plugin.json
└── hooks/
    ├── hooks.json                # { "modules": ["./register.js"] }
    └── register.js               # export function register(on) { … }
```

`plugin.json` needs `name`. `version` and `description` are shown in Settings. The version is what consent is bound to.

```json
{
  "name": "first-mod",
  "version": "0.1.0",
  "description": "Counts tool calls, shows a band above the prompt, and adds /tally plus a ping tool"
}
```

```json
{
  "modules": ["./register.js"]
}
```

The entry may be `.js`, `.mjs`, or `.ts`. TypeScript is compiled with the TypeScript compiler before import. Every entry in the list is loaded in order and each must export `register`. A plugin without `modules` stays a normal plugin and is not a mod.

Sample: `examples/mods/first-mod/`.

## 2. Where Pawn looks

| Source | Path | Notes |
|--------|------|--------|
| User | `~/.pawn/mods/<name>/` | Settings → install sample copies `first-mod` here |
| Extra folders | absolute paths in settings | Settings → Plugins → Mods → Choose folder |
| Project | `<project>/.claude/plugins/` | Loaded with the open project |
| Claude installs | Claude `installed_plugins.json` | Off until **Also scan Claude plugins** is on |

Mods load as soon as a project is shown, before the first prompt, and stay loaded for every chat in that project. Module-level variables (counters, timers) survive a chat switch. `$.state` does not: it is a separate in-memory map per mod and per chat. Switching chats emits `chat.switch` with `{ from, to }` and clears panes, toasts, notices, and the intervention log. The draft id `pending` (the home composer before a chat exists) is not a switch. Opening another project, or a change in Settings or the chip menu, reloads every mod.

A turn keeps the `sessionId` captured at `turn.start`. Later `turn.complete`, `tool.call`, `tool.check`, and Spinner `ui.render` for that turn are dispatched with that id. `$.session.id()`, `$.session.cwd()`, `$.session.messages()`, and `$.state` inside those handlers follow the chat that started the turn, including when the user has switched away and the turn is still running. Relative `$.fs` paths resolve from that chat's cwd. They do not follow the chat on screen. A background turn does not rewrite the visible spinner.

Settings file: `~/.pawn/mods-settings.json`.

| Field | Meaning |
|-------|---------|
| `enabled` | Master switch. |
| `disableAllHooks` | When true, installed mods do not load. This is the “Run mods” toggle off. Skills and MCP still load. |
| `disabledPlugins` | Names turned off after consent. |
| `consentedPlugins` | `{ "name", "version" }[]`. `null` only on a legacy file that never had the key (those mods stay allowed). |
| `pluginDirs` | Extra absolute directories. |
| `readClaudePlugins` | Scan Claude installs. Default `false`. |
| `pluginOrder` | Names, earlier first, within a tier. Names not listed keep discovery order after the listed ones. The chat conflict menu writes this when you choose sooner or later. |

A string in an old `consentedPlugins` list is read as version `*` (any version). A concrete version must match `plugin.json`. A newer build of the same name is **stale**: it stays off until you review it again.

## 3. Consent and risk

Mods are not sandboxed. They run with your account: files, shell, network, the chat.

Before a mod loads, Settings shows a review dialog:

- a capability list derived from the hooks it registers and the `$.…` calls in source: one row per capability, with a label and a one-line description (`settings.modsSection.cap.<id>` and `settings.modsSection.capDesc.<id>` in `strings.ts`; ids in `src/renderer/src/agent/mods/capabilities.ts`). A new capability needs an id, a rule, and both strings
- a risk chip: **high** if it can run a process or use the network, **medium** if it can touch files or tools, read message text (`message.render`), or change the theme (`$.theme.vars` / `$.theme.css`), **low** otherwise
- the version you are allowing

Allow writes that exact version into `consentedPlugins` and removes the name from `disabledPlugins`. Revoke deletes the consent entry and disables the name.

Static check: the app calls `mods.validate` on the directory (hooks list, `$` calls, unknown event names). A name outside `KNOWN_EVENTS` in `src/main/mods/validate.ts` is an error. That set is wider than the events the app emits: an accepted event that Pawn never emits is a warning in the report. Section 5 is the emitted set.

## 4. `register(on)`

```js
export function register(on) {
  on('tool.call', async ($, event, next) => {
    return next(event)
  })

  on('tool.call', { tool: 'shell_exec' }, async ($, event) => {
    return { deny: 'no shells' }
  })
}
```

- `on(event, handler)` or `on(event, matcher, handler)`.
- A matcher is a flat object. Every field must equal the same field on the event (strings compare case-insensitively).
- Call `next(event)` to pass the event on. You may pass a rewritten object.
- Return without `next` to **answer**. The rest of the chain, including Pawn, does not run.
- `next.to(event, tier)` skips ahead to `append`, `builtin`, or `core`.
- `on(…).catch(handler)` runs when the hook throws or hits the time budget.
- Each hook has about **10 seconds**. After that the hook is skipped and the chain continues.
- Order inside one event is tier order: `prepend`, `user`, `append`, `builtin`, `core`. Two user mods on the same event run in `pluginOrder`, then discovery order. The chat menu can move a mod sooner or later. That writes `pluginOrder` and reloads. The menu lists a conflict for every event that two or more loaded mods listen to. The intervention log adds a line only when `tool.call` or `prompt.submit` actually runs that way.

The first argument is `$` (the mods API). `$.plugin.name` and `$.plugin.root` identify the mod.

## 5. Events Pawn actually emits

The validator allows a wider Claude Code set. Only these are emitted today.

| Event | When | What you can do |
|-------|------|-----------------|
| `session.start` | After load, once for each loaded mod | Every `session.start` hook runs on each emission. `plugin` is the mod that just loaded. Register a command only when `plugin === $.plugin.name`. A second `$.command.register` of the same name throws. |
| `session.end` | On unload, once for each loaded mod | Same fan-out. `plugin` is the mod that is ending. Observe. |
| `session.compact` | After the transcript is compacted | Observe. Payload `{ sessionId }`. |
| `chat.switch` | The open chat changes from one id to another | Observe. Payload `{ from, to }`. Not emitted for `pending`, or when the id does not change. |
| `prompt.submit` | User text, before the settings `UserPromptSubmit` hook. The mod sees at most 200 000 characters. If it echoes that text unchanged, the rest of the message stays. A rewrite replaces the whole message. | `next({ ...e, text })` rewrites. Return `{ drop: "reason" }` without `next` to cancel the turn. |
| `turn.start` | After the prompt is accepted | Observe. Payload includes `sessionId`. |
| `turn.complete` | When the turn ends | Observe. Payload `{ sessionId, status }` where status is `completed`, `aborted`, or `failed`. |
| `tool.call` | Before settings `PreToolUse` | `next(e)` continues. `{ deny: "reason" }` blocks. `{ result }` answers and skips the tool. Payload includes `tool` and the tool arguments. |
| `tool.check` | Around the permission check | Return or rewrite `{ decision: "allow" \| "deny" }`. |
| `command.run` | The user typed `/name` for a registered command, or code called `$.command.run` | Return `{ text }` to post a reply as the mod. |
| `ui.render` | Spinner, and the band above the composer (`AbovePrompt`) | Spinner is one chain: the last `props.suffix` wins. `AbovePrompt` calls each matching mod alone. Return `props.tree` and `props.plugin` for your own band. You do not see the other mods' trees. |
| `ui.press` / `ui.input` / `ui.select` | The user used a Button, Input, or Select in a mod tree | Read `id` and `value`. |

Tool order: `tool.call` → settings `PreToolUse` → Plan-mode check → `tool.check` / permission → the tool.

`prompt.submit` runs before the settings `UserPromptSubmit` hook. A settings-hook deny still stops the turn after a mod rewrite.

## 6. Chat UI

Handlers do not get a DOM. They return a frozen tree from `$.ui.resolve(event)`.

```js
on('ui.render', { component: 'AbovePrompt' }, async ($, event, next) => {
  const el = $.ui.resolve(event)
  return next({
    ...event,
    props: {
      ...event.props,
      plugin: $.plugin.name,
      tree: el.Box({
        children: [
          el.Text({ text: 'tool calls: ' + calls }),
          el.Button({ id: 'reset-tally', text: 'Reset count' }),
          el.Input({ id: 'note', placeholder: 'Optional note…', value: note })
        ]
      })
    }
  })
})

on('ui.press', { id: 'reset-tally' }, async ($, event) => {
  calls = 0
  $.ui.toast('Tally reset')
  $.ui.invalidate()
  return event
})
```

Elements: `Box`, `Text`, `Markdown`, `Code`, `Link`, `Button`, `Input`, `Select`.

| Call | Effect |
|------|--------|
| `$.ui.invalidate()` | Asks the chat to draw `ui.render` again. |
| `$.ui.status(text)` | One line under the chip. |
| `$.ui.toast(text, { timeoutMs })` | Corner toast. Does not push the composer. |
| `$.ui.notice(text)` | A dismissible line in the chrome. Also lands in the intervention log. |
| `$.ui.open({ id, title, tree })` | A docked pane. Without `tree` the pane says it has nothing to show. |
| `$.ui.close(id)` | Closes that pane. |
| Spinner `props.suffix` | Appended to the thinking line. |

The chip lists mods loaded for this chat. Its menu can turn one off (that writes `disabledPlugins` and reloads). When two mods listen to the same event, the menu lists that conflict and can move one sooner or later. Each mod that draws `AbovePrompt` gets its own band. The intervention log records blocks, answers, button presses, and conflicts from `tool.call` and `prompt.submit`. It clears with the session UI.

### UI slots

`$.slot.*` puts mod controls in fixed places outside the composer band. Each call takes a mod-local `id` (`[A-Za-z0-9_-]{1,64}`). Calling again with the same `id` replaces that item, which is how a mod redraws it. Trees are the same `$.ui.resolve()` elements as above.

| Call | Where it shows | Capability |
|------|----------------|------------|
| `$.slot.sidebar({ id, title, tree })` | A collapsible section at the bottom of the left sidebar. Clicking the title collapses it. | `sidebar` |
| `$.slot.panel({ id, title, tree })` | Same place as `sidebar` for now. The right panel has no mod tabs yet. | `sidebar` |
| `$.slot.header({ id, label, title })` | A button on the right of the chat header. | `toolbar` |
| `$.slot.toolbar({ id, label, title })` | A button in the composer row, next to Attach. Hidden on the empty home screen. | `toolbar` |
| `$.slot.settings({ id, title, tree })` | A page under **Settings → Mods**, one nav entry per page. | `settingsPage` |
| `$.slot.statusbar({ id, text, title, tree })` | A small item in the left sidebar footer, above Settings (Pawn has no visible status bar). A text item is a button; a `tree` item draws the tree. | `statusbar` |
| `$.slot.palette({ id, title, hint })` | An entry in the command palette, group **Mods**. Running it sends `ui.press` with `slot: 'palette'`. | `palette` |
| `$.slot.shortcut({ id, keys, title })` | A keyboard shortcut, e.g. `Mod+Shift+U` (`Mod` = Cmd on macOS, Ctrl elsewhere). Pressing it sends `ui.press` with `slot: 'shortcut'`. | `shortcuts` |
| `$.slot.remove({ slot, id })` / `$.slot.list()` | Remove one of this mod's items / list them. | none |

- Clicks arrive as `ui.press` with `{ plugin, id, slot }`. Buttons, inputs and selects inside a slot tree send `ui.press`, `ui.input` and `ui.select` with the same `slot` field. Filter with `{ plugin: '<your mod>' }`.
- Items belong to the project's mod runtime: they stay when you switch chats and disappear when the mod unloads, is turned off, or the runtime reloads.
- Each kind is its own capability in the review dialog. The runtime refuses a `$.slot.<kind>` call whose literal text is not in the mod's source, so a mod cannot use a slot the dialog never showed. Write the calls out (`$.slot.header(...)`), not `$.slot[name](...)`.
- Sample: `examples/mods/ui-slots-demo/` uses every slot. It is not installed by default; copy it to `~/.pawn/mods/ui-slots-demo` and allow it.
- **Shortcut conflicts are reported, never overridden.** `$.slot.shortcut` throws (and logs a `conflict` line in the mod timeline) when the chord matches an app keybinding (Settings → Shortcuts), a reserved app chord (copy/paste/undo, `Mod+F`, `Mod+S`, `Mod+Q`, `Mod+R`, zoom, `Alt+P`, `Escape`, `Enter`, `Tab`), or another mod's shortcut. The first mod keeps it. If you later rebind an app shortcut onto a mod's chord, the app wins. A chord with no `Mod`/`Ctrl`/`Alt` does not fire while you type in a field.

### Message render hook

`on('message.render', ($, e, next) => …)` decorates finished chat messages. Capability: `messages` (the mod reads message text).

- `e` = `{ messageId, role, text, sessionId, props: { badges, actions, blocks } }`. Append to the arrays and `return next({ ...e, props })`.
- `badges`: `{ id, text, tone? }` (`tone`: `info`, `success`, `warning`, `danger`). `actions`: `{ id, label }`, a button in the message's action row; a click sends `ui.press` with `{ slot: 'message', id, messageId, sessionId, role }`. `blocks`: `{ id, tree }`, a `$.ui.resolve()` tree under the message. At most 8 of each per message.
- Each entry is stamped with the mod that added it, so a later mod cannot take over an earlier mod's item or its clicks.
- **Streaming and performance:** a reply is only sent once it has finished; the live, streaming row is never decorated. Results are cached per (chat, message, text) and asked again only when the text changes, a mod calls for a redraw (`$.ui.invalidate`, or after any slot click), or mods reload. With no `message.render` hook loaded nothing is emitted. A hook that throws or times out leaves the message as it is.
- **Per chat:** `e.sessionId` is the chat the message belongs to, not the chat on screen, and `$.session` inside the hook is that chat. Keep per-chat state keyed by `e.sessionId`.
- Like slots, the event name must be written literally (`on('message.render', …)`); otherwise `on` throws `message.render refused`.


### Theming

`$.theme.*` recolors Pawn and styles a mod's own chrome. Each call takes a mod-local `id` (`[A-Za-z0-9_-]{1,64}`); calling again with the same `id` replaces it. `mode` is `light`, `dark` or `all` (default).

| Call | What it does | Capability |
| --- | --- | --- |
| `$.theme.vars({ id, vars, mode })` | Overrides CSS custom properties on the app root, e.g. `{ '--accent': '#2f6b3a' }`. Only `--name` keys (the `--` is added if missing), up to 128 per call, values up to 200 characters. | `theme` |
| `$.theme.css({ id, css, mode })` | A stylesheet wrapped in `@scope ([data-plugin="<mod>"])`, so it only reaches elements this mod drew with `$.slot.*` (`:scope` is the slot's root). Up to 32 KB. | `theme` |
| `$.theme.remove({ id })` / `$.theme.list()` | Remove one of this mod's entries / list them. | none |

- Anything that could load a resource or break out of the block is refused with an error: `url(`, `@import`, `image-set(`, `expression(`, `<`, `\`, unbalanced braces, and the at-rules `@scope`, `@layer`, `@font-face`, `@namespace`, `@charset`. Var values also refuse `;`, `{` and `}`.
- Variables to start with: `--bg-primary`, `--bg-secondary`, `--bg-sidebar`, `--text-primary`, `--text-secondary`, `--text-muted`, `--border-color`, `--primary`, `--accent`, `--danger`, `--success` (full list in `src/renderer/src/styles/global.css`).
- The user can switch one mod's theme off without turning the mod off: the **Theme** toggle next to it in the mods menu (the chip above the composer). The choice is kept across restarts. Themes are cleared when mods reload.
- Like slots, the runtime refuses a `$.theme.vars` / `$.theme.css` call that isn't written literally in the source. The review dialog shows them as **Change colors and styles**. Risk is **medium**: a theme can't read anything or reach the network, but it can make parts of Pawn look like something they're not.
- Anti-spoofing: the consent dialog, the mods menu (with its Theme toggles) and **Settings → Mods** are `.mods-trusted` roots. They re-declare the default tokens, and mod var rules use `:not(.mods-trusted)`, so `$.theme.vars` never reaches them. Scoped sheets can't reach them either, and `position: fixed` / `sticky` is refused so a mod can't float a fake dialog over them.
- Sample: `examples/mods/theming-demo/` swaps two palettes (light and dark) and styles its sidebar section. It is not installed by default; copy it to `~/.pawn/mods/theming-demo` and allow it.

## 7. `$` API

| Namespace | Role |
|-----------|------|
| `$.command.register({ name, description })` | Slash command. Names are `[A-Za-z0-9_-]{1,64}`. Built-ins and duplicates are refused. |
| `$.command.run` / `$.command.list` | Invoke or list commands. |
| `$.tool.register({ name, description, inputSchema, handler })` | Exposes `mcp__<plugin>__<name>` to the model. `handler(args)` runs after hooks, unless a hook answers first. A name already taken by MCP is left to MCP. |
| `$.tool.call({ tool, ...args })` | Emits `tool.call`. |
| `$.prompt.submit({ text, asUser })` | Sends a prompt into the chat. |
| `$.session.id` / `cwd` / `messages` / `usage` | Current chat. On a turn, tool, or spinner event, `$.session.id()`, `$.session.cwd()`, and `$.session.messages()` follow the chat that started the turn, not whichever chat is open now. |
| `$.state.get` / `set` / `delete` | In-memory values for this mod and this chat. Not written to disk. A background turn reads and writes the chat it started in. |
| `$.fs.read` / `write` / `exists` / `list` / `stat` | Through the app file IPC. 4 MiB cap. Relative paths resolve from the cwd of the chat that started the turn (`$.session.cwd()`). `list` reports `size: 0`. |
| `$.process.run(argv, { timeoutMs, cwd })` | Shell, sandbox on. Default timeout 30s, maximum 10 minutes. Values from `$.env.set` are merged into that child. This is what marks the mod high risk. |
| `$.http.fetch(url, init)` | `http`/`https` only. `init` is `method`, `headers`, `body`, `timeoutMs` (default 30s, maximum 120s). 4xx and 5xx return `{ status, ok, headers, text }`. A bad URL or another scheme throws. High risk. |
| `$.store.get` / `set` / `delete` / `keys` | Per-mod key-value store on this device. |
| `$.clock.now` / `sleep` / `after` / `every` | Timers. Cancel the handle `after` / `every` return. |
| `$.env.get` / `set` | `get` reads the app environment captured at load, then values this mod set. The snapshot is taken only when a mod's source references `$.env`. `set` applies to this mod and to later `$.process.run`. It does not change the app process environment. |
| `$.model.complete({ prompt, system, model, maxTokens, timeoutMs })` | One completion on the routed model, or on `model` when that id is configured. It does not write into the chat. An empty prompt, an unknown model, or an empty answer returns `{ isAnswered: false, reason }`. `timeoutMs` defaults to 60s and caps at 180s. `maxTokens` only lowers the provider output cap. |
| `$.turn.abort()` | Stops the current turn. |
| `$.ui.log` | Kept in memory for the session. The chat chrome does not draw it. |

Do not assume a field exists just because Claude Code documents it. The table above is what `src/renderer/src/agent/mods/api.ts` implements.

## 8. `first-mod`

`examples/mods/first-mod/` counts `tool.call`, registers `/tally` and a `ping` tool, draws an AbovePrompt band (reset button and a note field), and sets the spinner suffix.

Install from **Settings → Plugins → Mods → Install sample mod**, then allow it in the review dialog. In chat, the thinking line gains `· tool calls: N…`. `/tally` answers with the count. The model can call `mcp__first-mod__ping`, which returns `pong`. Reset and the note field go through `ui.press` and `ui.input`.

## 9. Code map

| Concern | Path |
|---------|------|
| Discover, consent, validate | `src/main/mods/` |
| IPC | `src/main/ipc/mods.ts` |
| Runtime, `$`, UI store | `src/renderer/src/agent/mods/` |
| Settings and chat chrome | `src/renderer/src/components/ModsSettingsPanel.tsx`, `ModsChrome.tsx`, `ModTree.tsx` |
| Wired into the turn | `src/renderer/src/stores/chatLoop.ts`, `src/renderer/src/agent/toolExecutor.ts` |
| Headless | `src/headless/nodeApi.ts` `mods.*` |
