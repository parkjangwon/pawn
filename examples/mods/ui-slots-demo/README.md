# ui-slots-demo

Sample mod for the `$.slot` API. It adds:

- a **Slots demo** section at the bottom of the left sidebar (click count and a `+1` button),
- a **Hello** button in the chat header (shows a toast),
- a **Reset** button in the composer toolbar (hidden on the empty home screen),
- a **Slots demo** page under Settings → Mods with a greeting field,
- a `slots: N` status item at the bottom of the sidebar, above Settings (click adds one).

Not installed by default. Copy this folder to `~/.pawn/mods/ui-slots-demo` and allow it in the review dialog; the dialog lists the sidebar, toolbar, settings page and status bar permissions.

Docs: [docs/agent/MODS.md](../../../docs/agent/MODS.md#ui-slots).
