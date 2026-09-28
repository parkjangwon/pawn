# Pawn Design Contract

The UI for a desktop coding tool. Quiet and neutral, and dense without feeling cramped. Hierarchy comes from type, spacing and tone. Color and decoration are not used for hierarchy. Tokens live in `src/renderer/src/styles/global.css` (`:root`, `.app.light`, `.app.dark`); component CSS uses tokens, not raw values.

## Typography
- Font: `Pretendard Variable`, bundled from the `pretendard` package as a dynamic subset (CSP `font-src 'self'`). The system font stack is the fallback. Mono: `ui-monospace, SFMono-Regular, Menlo, monospace`.
- Form controls inherit the font (`button, input, textarea, select { font-family: inherit }`).
- Scale: `--font-xs 11` / `--font-sm 12` / `--font-md 13` / `--font-lg 14` / `--font-xl 16` / `--font-2xl 20` / `--font-3xl 24`. Nothing below 11px. No half-pixel sizes.
- Weights: 400 body, 500 emphasis and active rows, 600 titles, 700 only for rare display text. Never use 550, 650 or 800.
- Section labels use sentence case. No uppercase tracking.

## Radius
- `--radius-xs 4` for chips, kbd and inline code.
- `--radius-sm 6` for rows, buttons and inputs.
- `--radius-md 10` for cards, menus and popovers.
- `--radius-lg 16` for the composer and dialogs.
- `--radius-xl 20` for large sheets.
- `999px` is only for pills. `50%` is only for round icon buttons.

## Color and surface
- There is one gray family (cool zinc), and no second accent. `--accent` is ink (near-black in light mode, near-white in dark).
- Text contrast is at least 4.5:1 for `--text-muted` on `--bg-primary`.
- Shadows are tinted to the canvas and use `--shadow-elevated`. Never use raw black shadows.
- Semantic colors are `--danger`, `--warning` and `--success`, used for status only.

## State
- Hover shows `--bg-hover`. Active or selected shows `--bg-active` plus weight 500.
- No colored edge stripes (inset or border-left accent) on rows or cards. The keyboard `focus-visible` ring is the only colored edge.
- No decorative gradients or glows on avatars and icons. Use flat, tinted neutrals.

## Motion
- Use the existing `--dur-*` and `--ease-*` tokens. Animate only transform and opacity. `prefers-reduced-motion` is respected globally.

## Accepted debt
- UltraWork keeps its rainbow keyword treatment on purpose. It is a mode indicator, not decoration.
- About 200 hardcoded hex colors remain in component CSS. They will be migrated as each surface is touched.
