# first-mod

Sample mod. Counts tool calls, draws a band above the composer, adds `/tally`, and registers a `ping` tool.

How mods load, consent, and the `$` API: [docs/agent/MODS.md](../../../docs/agent/MODS.md) ([한국어](../../../docs/agent/MODS.ko.md)).

## Layout

```text
first-mod/
├── .claude-plugin/plugin.json
└── hooks/
    ├── hooks.json
    └── register.js
```

## Try it

1. Settings → Plugins → Mods → Install sample mod. Or copy this folder to `~/.pawn/mods/first-mod`.
2. Allow it in the review dialog. Consent is tied to `plugin.json` `version`.
3. In chat, the thinking line shows `· tool calls: N…`.
4. Type `/tally`. The model can call `mcp__first-mod__ping` (it returns `pong`). Reset and the note field use `ui.press` and `ui.input`.
