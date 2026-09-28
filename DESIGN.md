# Pawn Design Contract

Desktop coding tool, set in the Cursor visual language (`design/cursor-design-system.md`). Editorial and calm, still dense enough to work in. Hierarchy comes from type, warm surfaces, and hairlines. Tokens live in `src/renderer/src/styles/global.css` (`:root`, `.app.light`, `.app.dark`). Component CSS uses tokens, not raw values.

The source system describes a marketing site. This app keeps its density. It does not adopt 72px heroes, 80px section padding, or a 1200px marketing grid.

## Color
- Canvas is warm cream in light (`#f7f7f4`), warm near-black in dark. Never pure white as the page floor, never cool zinc.
- Ink is warm (`#26251e` light, cream text in dark). `--accent` stays ink and is for selection chrome, not for filling buttons.
- `--primary` (`#f54e00`) is the only brand action color. Use it on primary CTAs, the wordmark, and nowhere else. Press state is `--primary-active`.
- Cards are white (light) or one step above the canvas (dark), separated by a 1px hairline. No drop shadows. `--shadow-elevated` is `none`.
- Timeline pastels (`--timeline-thinking|grep|read|edit|done`) appear only on agent tool rows.
- Semantic `--danger`, `--warning`, `--success` are for status only.
- `--text-muted` is darkened slightly from the marketing token so it stays at least 4.5:1 on the canvas.

## Typography
- Sans: Inter (CursorGothic substitute), then Pretendard Variable for Hangul, kana, and Han. Both are bundled. CSP `font-src` stays `'self'`.
- Mono: JetBrains Mono on code, tool paths, and `<pre>` / `<code>`.
- Weights: 400 body and display, 500 buttons and emphasis, 600 component titles and timeline labels. Do not use 700.
- Display tracking goes slightly negative. Body tracking stays 0.
- Section labels stay sentence case. Timeline pills may track, but they are not forced uppercase (ko/ja/zh labels).

## Radius
- `--radius-xs` 4px tags.
- `--radius-sm` 6px compact rows.
- `--radius-md` 8px buttons, inputs, primary CTAs.
- `--radius-lg` 12px cards, composer, dialogs, menus.
- `--radius-xl` 16px rare large sheets.
- `999px` is only for pills.

## State
- Hover shows `--bg-hover`. Active or selected shows `--bg-active` plus weight 500.
- Primary hover and press use `--primary-active`. No glow, no lift shadow.
- No colored edge stripes on rows or cards. The keyboard focus ring is ink, not orange.
- No decorative gradients on avatars and icons.

## Motion
- Use `--dur-*` and `--ease-*`. Animate transform and opacity. `prefers-reduced-motion` is respected globally.

## Accepted debt
- UltraWork keeps its rainbow keyword treatment. It is a mode indicator, not a brand color.
- Hardcoded hex in component CSS remains until that surface is touched.
- Marketing-only pieces (pricing inversion, 5-column footer, IDE mockup cards) are not part of the app.
