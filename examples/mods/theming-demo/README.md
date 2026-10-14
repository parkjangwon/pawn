# theming-demo

Sample mod for the `$.theme` API. It:

- recolors the app with `$.theme.vars` (separate light and dark palettes for `--accent`, `--primary`, `--bg-sidebar`),
- styles its own sidebar section with a scoped `$.theme.css` sheet (accent border and title),
- adds a **Theme demo** sidebar section with **Swap palette** (forest ↔ dusk) and **Clear theme**.

Not installed by default. Copy this folder to `~/.pawn/mods/theming-demo` and allow it in the review dialog; the dialog lists the **Change colors and styles** permission. Switch the theme off without disabling the mod from the mods menu (**Theme** toggle).

Docs: [docs/agent/MODS.md](../../../docs/agent/MODS.md#theming).
