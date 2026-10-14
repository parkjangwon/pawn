# views-demo

Sample mod for `$.view` custom views. It:

- opens a **Views demo** panel in the left sidebar: a counter saved with `$.store` (called from inside the view through `pawn.call`), a **Toast** button, and buttons that open the same info page as a **tab** above the chat or as a **dialog**,
- answers the view's `pawn.send` messages in a `view.message` hook and replies with `$.view.post`.

Not installed by default. Copy this folder to `~/.pawn/mods/views-demo` and allow it in the review dialog; the dialog lists **Show custom views** (medium risk) and the store/UI permissions the view bridges to.

Docs: [docs/agent/MODS.md](../../../docs/agent/MODS.md#custom-views).
