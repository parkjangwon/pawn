# Pawn Design Contract v3.0.0

Pawn is a desktop AI coding agent. Its product character is **calm, dense, and operational** — never decorative. The interface is a workbench, not a billboard. Every pixel serves the agent loop: read, act, verify.

This document is written for the coding agent. If a rule here conflicts with your instinct, the rule wins. Violating the type scale or surfacing a raw hex value is a design-system defect, not a style choice.

Tokens live in `src/renderer/src/styles/global.css` (`:root`, `.app.light`, `.app.dark`). Component CSS uses tokens, never raw values.

## Color

The palette is a near-monochrome homage to high-density agent UIs. Color is information, not decoration.

- Canvas: `#f8f8f8` light, `#161616` dark. Never pure white as the page floor.
- Ink: `#262626` light, `#d4d4d4` dark. Text is neutral gray, never warm, never cool.
- `--primary` is monochrome: `#000000` light, `#ffffff` dark. Primary CTAs, and nothing else. Press state is `--primary-active`.
- `--accent` follows the same monochrome. It is for selection chrome, not for filling buttons.
- Surfaces layer with background contrast plus a 1px hairline (`--border-color`: `rgba(13,13,13,0.1)` light, `rgba(255,255,255,0.1)` dark). `--surface` is the subtlest fill. No drop shadows on cards — `--shadow-elevated` is `none`. Shadows exist only for floating layers: `--shadow-popover` (menus, popovers, dialogs), `--shadow-toast` (toasts).
- Semantic colors are for status only: `--danger` (`#e03131` / `#ff5c5c`), `--warning` (`#e07b00` / `#eab308`), `--success` (`#1e8a3e` / `#46bf72`).
- `--idle-task` (`#9e77ed` / `#7b5ce5`) marks idle-time work. It is the only chromatic accent in the chrome.
- Timeline pastels (`--timeline-thinking|grep|read|edit|done`) appear only on agent tool rows. They are the agent's working colors, not the app's.
- The pawn chess piece survives at brand moments (logo, home). That is where pawn's identity lives — not in the color system.

## Typography

One scale, relative to `--ui-font-size` (14px). Change the base and the whole UI scales proportionally. Do not invent sizes.

- `--text-ui-xl`: base + 4px (18px). h1 only.
- `--text-ui-lg`: base + 2px (16px). h2.
- `--text-ui-base`: 14px. Body, buttons, titles.
- `--text-ui-caption`: base − 1px (13px). Secondary text under body copy.
- `--text-ui-sm`: base − 2px (12px). Helpers, tooltips, inline code.
- `--text-ui-xs`: base − 4px (10px). Badges, counters, keyboard shortcuts. Nothing goes below this except workflow-graph axes.

Sans: Inter, then Pretendard Variable for Hangul, kana, and Han. Both are bundled. CSP `font-src` stays `'self'`. Mono: JetBrains Mono — on code, tool paths, command output, and `<pre>` / `<code>` only. Never for prose.

Weights: 400 body and display, 500 buttons and emphasis, 600 component titles and timeline labels. Do not use 700. Section labels stay sentence case. Timeline pills may track slightly, but are never forced uppercase (ko/ja/zh labels).

## Radius

- `--radius-xs` 4px: tags.
- `--radius-sm` 6px: compact rows.
- `--radius-md` 8px: buttons, inputs, primary CTAs.
- `--radius-lg` 12px: cards, dialogs, menus, suggestion rows.
- Composer is `16px` (`rounded-2xl`). This is the one sanctioned exception.
- `999px` is only for pills.

## State

- Hover shows `--bg-hover`. Active or selected shows `--bg-active` plus weight 500.
- Primary hover and press use `--primary-active`. No glow, no lift shadow.
- No colored edge stripes on rows or cards. The keyboard focus ring follows `--focus-ring`, never a brand color.
- No decorative gradients on avatars and icons.

## Motion

Fast and low-drama. Fade, zoom, and directional slide only. No springs, no playful motion.

- `--dur-instant` 80ms, `--dur-fast` 150ms, `--dur-med` 260ms, `--dur-slow` 300ms, `--dur-stream` 900ms.
- `--ease-out-soft` (`cubic-bezier(0.22, 1, 0.36, 1)`) is the default easing.
- Interactive elements animate `transition-colors` only. `transition-all` is banned — it fires every property on resize and looks broken in traces.
- Entrances: `pawn-draft-waterfall` (260ms, suggestion lists), `pawn-collapsible-up/down` (300ms), `pawn-stream-text-in` (900ms ease, streaming text).
- `prefers-reduced-motion` is respected globally. The existing global rule zeroes all animations and transitions; new keyframes are covered automatically.

## Icons

UI icons come from `lucide-react` — one set, 24px viewBox, `stroke="currentColor"`, `strokeWidth={2}`. No inline SVG in components (the pawn logo excepted). No emojis in the UI, ever.

## Layout

- Home: centered column, `max-width: 42rem`. Time-aware greeting (six segments, local hour), pawn logo, then a suggestion list of concrete capabilities — icon, title, one-line description per row. The setup checklist (provider, project, GitHub) keeps its function but wears the row style.
- Composer: `rounded-2xl` shell with workspace/branch context chips on top. The agent always shows where it works.
- Settings: every page is "title + description + right-side control" cards. Appearance previews code themes live.
- Workspace: conversation, bottom terminal, and side pane are independent frames. Trust surfaces (progress, diffs, approvals) live in the side pane, not in the chat stream.

## i18n

Every UI string goes through `t()`. Keys ship in all four locales (`en`, `ko`, `ja`, `zh`) — tests enforce parity. Korean in 해요체, English in sentence case.

## Accepted debt

- UltraWork keeps its rainbow keyword treatment. It is a mode indicator, not a brand color.
- Syntax-highlighting themes (hljs) keep their own palettes. Terminal, tooltip, and lightbox chrome keep fixed-dark values for readability.
- `--font-sans` / `--font-mono` stacks remain; only the size tokens were migrated to `text-ui-*`.
