# v3.0.0 Component Specs — ZCode parity (pawn-native reimplementation)

> Source: `/tmp/ZCode/packages/ui/src/components/ui/*.tsx` + `styles.css` (Apache 2.0, Z.ai).
> Tailwind values decoded 1:1 (1 unit = 4px). No code copied — vanilla CSS + pawn tokens.
> Base unit: 4px grid. Type scale: `--text-ui-*` (pawn) = `text-ui-*` (ZCode). Motion: `transition-colors` only.

## 0. Global rules (all components)

| Rule | ZCode value | pawn mapping |
|---|---|---|
| Transition props | `transition-colors` (bg/border/color/fill/stroke) only, never `transition-all` | `transition: background-color, border-color, color var(--dur-fast)` |
| Overlay/menu fade | `duration-100` (100ms) | `var(--dur-instant)` (80ms, nearest token) |
| Disabled | `pointer-events: none; opacity: 0.5` | same |
| Invalid | `border-destructive` | `border-color: var(--danger)` |
| Focus | ring utilities | pawn global `:focus-visible` outline (`var(--focus-ring)`); inputs also switch border to `var(--border-strong)` |
| Radius scale | `rounded-sm 2px / md 6px / lg 8px / xl 12px / 2xl 16px / full 999px` | `--radius-xs 4px* / --radius-sm 6px / --radius-md 8px / --radius-lg 12px / --radius-xl 16px / 999px` (*2px has no pawn token — xs uses 4px, noted per table) |
| Overlay scrim | `bg-black/60` + `backdrop-blur-xs` (2px), `z-50` | `rgba(0,0,0,0.6)` + `blur(2px)`, `z-index: 50` (menus `z-index: 60` stay above tooltips) |
| Layering | bg contrast + 1px border, shadow reserved for popover/menu | `box-shadow: none` except menus (keep pawn rule; menu keeps subtle shadow via `--shadow-elevated` fallback — none) |

## 1. Button (`button.tsx`)

| Slot | Height | Padding-x | Radius | Font | Icon |
|---|---|---|---|---|---|
| `xs` | 20px (`h-5`) | 8px (`px-2`) | 4px* (`rounded-sm` 2px) | 14px base | 10px |
| `sm` | 24px (`h-6`) | 8px | 6px (`rounded-md`) | 14px relaxed | 12px |
| `default` | 28px (`h-7`) | 8px | 6px | 14px | 14px |
| `lg` | 32px (`h-8`) | 10px (`px-2.5`) | 8px (`rounded-lg`) | 14px | 16px |
| `icon` | 28px square | — | 6px | — | 16px |
| `icon-xs` | 20px square | — | 4px* | — | 10px |
| `icon-sm` | 24px square | — | 6px | — | 12px |
| `icon-md` | 28px square | — | 8px | — | 16px |
| `icon-lg` | 32px square | — | 8px | — | 16px |

| Variant | Rest | Hover | Active/expanded |
|---|---|---|---|
| `default` | bg primary / text on-primary | bg primary @80% (`color-mix`) | same as hover |
| `outline` | border border / text primary | border strong + bg hover | bg input-ish (`var(--bg-hover)`) |
| `secondary` | bg active / text primary | bg active @80% | same as hover |
| `ghost` | transparent / text primary | bg hover | bg hover |
| `destructive` | bg danger / white | bg danger @90% | same as hover |
| `warning` | bg warning / white | bg warning @90% | same as hover |
| `link` | text primary, `underline-offset: 4px` | underline | — |

Base: `inline-flex items-center justify-center, gap 4px, border 1px transparent, whitespace-nowrap, select-none`.
Pawn color map: primary→`var(--primary)`, on-primary→`var(--on-primary)`, primary-hover→`var(--primary-active)`,
border→`var(--border-color)`, border-strong→`var(--border-strong)`, hover bg→`var(--bg-hover)`,
danger→`var(--danger)`, warning→`var(--warning)`.

## 2. Input (`input.tsx`)

| Size | Height | Padding | Radius | Font |
|---|---|---|---|---|
| `xs` | 20px | `0 8px` | 4px* | 14px base |
| `sm` | 24px | `2px 8px` | 6px | 14px |
| `default` | 28px | `2px 8px` | 6px | 14px |
| `lg` | 32px | `6px 12px` | 8px | 14px |

| State | Border | Background | Text |
|---|---|---|---|
| rest | `var(--border-color)` | `var(--bg-input)` | `var(--text-primary)` |
| hover | `var(--border-strong)` | same | same |
| focus-visible | `var(--border-strong)` (+ global outline) | same | same |
| placeholder | — | — | `var(--text-muted)` |
| disabled | same | same | `opacity: 0.5` |
| invalid | `var(--danger)` | same | same |

Base: `width: 100%, min-width: 0`.

## 3. Textarea (`textarea.tsx`)

| Prop | ZCode value | pawn mapping |
|---|---|---|
| min-height | 64px (`min-h-16`) | 64px |
| padding | 8px (`px-2 py-2`) | `var(--space-sm)` |
| radius | 6px (`rounded-md`) | `var(--radius-sm)` |
| font | 14px base | `var(--text-ui-base)` |
| resize | `none` (+ `field-sizing-content`) | `none` |
| placeholder | muted | `var(--text-muted)` |
| states | border input → focus `border-ring` | rest `var(--border-color)`, focus `var(--border-strong)`; disabled `opacity: 0.5`; invalid `var(--danger)` |

## 4. Card (`card.tsx`)

| Part | ZCode value | pawn mapping |
|---|---|---|
| shell | `rounded-xl` 12px, 1px `border-card-border`, bg card, `flex-col gap 16px, py 16px`, `text-ui-base` | `var(--radius-lg)`, `var(--border-color)`, `var(--bg-elevated)`, `gap/padding var(--space-lg)` |
| shell `sm` | `gap 12px, py 12px` | `gap/padding var(--space-md)` |
| header | `grid, gap 4px, px 16px` (sm 12px) | `var(--space-xs)` gap, `var(--space-lg)` px |
| title | 14px, weight 500 | `var(--text-ui-base)`, 500 |
| description | 14px, subtle | `var(--text-secondary)` |
| content/footer | `px 16px` (sm 12px) | same scale |
| action | top-right grid slot | `margin-left: auto` |

## 5. Dialog (`dialog.tsx`)

| Part | ZCode value | pawn mapping |
|---|---|---|
| overlay | fixed full, `bg-black/60`, blur 2px, `z-50`, 100ms fade | same, `var(--dur-instant)` |
| content | centered, `w full max-w(calc(100%-2rem))`, `rounded-2xl` 16px, 1px popover border, bg popover, `p 16px, gap 16px`, 14px, 100ms fade+zoom | `var(--radius-xl)`, `var(--border-color)`, `var(--bg-elevated)`, `var(--space-lg)`; pawn generic adds `max-width: 512px` |
| close btn | absolute top-right 16px, ghost `icon-sm` 24px | `Button ghost icon-sm`, label via prop (no hardcoded strings) |
| header | `flex-col gap 4px` | `var(--space-xs)` |
| footer | `flex-row justify-end gap 8px` (stacked on xs) | `var(--space-sm)`, column under 480px |
| title | 14px, weight 500 | `var(--text-ui-base)`, 500 |
| description | 14px, subtle, links underlined offset 3px | `var(--text-secondary)` |

Behavior: portal to `document.body`, overlay-click + Escape close, focus trap (existing `useFocusTrap`).

## 6. Dropdown menu (`dropdown-menu.tsx`)

| Part | ZCode value | pawn mapping |
|---|---|---|
| content | `min-w 128px`, `rounded-lg` 8px, 1px popover border, bg menu, `p 4px, gap 2px`, `z-60`, 100ms fade+zoom | `var(--radius-md)`, `var(--border-color)`, `var(--bg-elevated)`, `var(--space-xs)`/`2px` |
| item | `min-h 28px, px 8px py 4px, rounded-md` 6px, 14px, icon 16px, `gap 8px` | `var(--radius-sm)`, `var(--text-ui-base)` |
| item hover/open | bg menu-hover | `var(--bg-hover)` |
| item destructive | text destructive; hover bg destructive + destructive-fg | `var(--danger)` / `var(--on-primary)` |
| item disabled | subtlest, no pointer events | `var(--text-muted)`, `opacity: 0.5` |
| label | `px 8px py 6px`, 14px medium, subtlest | `var(--text-muted)`, 500 |
| separator | `-mx 4px my 4px, h 1px, bg-border` | `var(--border-color)` |
| shortcut | `ml-auto`, 10px, subtlest, wide tracking | `var(--text-ui-xs)`, `var(--text-muted)` |

pawn note: no radix dependency — reimplemented as controlled/uncontrolled trigger + menu with outside-click,
Escape, ArrowUp/Down + Enter navigation.

## 7. Badge (`badge.tsx`)

| Prop | ZCode value | pawn mapping |
|---|---|---|
| size | `h 20px, px 8px, py 2px, rounded-full`, 10px weight 500, `gap 4px`, icon 10px | `var(--text-ui-xs)`, 500, `999px` |
| `default` | bg primary / fg on-primary | `var(--primary)` / `var(--on-primary)` |
| `secondary` | bg secondary / fg secondary-fg | `var(--bg-active)` / `var(--text-primary)` |
| `destructive` | bg destructive @10% / text destructive | `color-mix(danger 12%, transparent)` / `var(--danger)` |
| `outline` | 1px border / text primary | `var(--border-color)` / `var(--text-primary)` |
| `ghost` | transparent; hover muted | hover `var(--bg-hover)` |
| `link` | text primary, `underline-offset 4px`, hover underline | same |

## 8. Switch (`switch.tsx`)

| Prop | ZCode value | pawn mapping |
|---|---|---|
| track `default` | 32×18px, `rounded-full` | same |
| track `sm` | 28×16px | same |
| thumb | 16px / 14px (sm), `rounded-full`, bg primary-fg | `var(--on-primary)` |
| off | bg primary @30% | `color-mix(var(--primary) 30%, transparent)` |
| on | bg primary | `var(--primary)` |
| thumb travel | `translateX(calc(100% - 2px))` from 0 | same (14px / 12px) |
| hit area | `after: -inset 8px/12px` extended | `padding` via `::after` same insets |
| disabled | `opacity: 0.5` | same |
| motion | transform + bg `transition-colors` | `var(--dur-fast)` |

pawn note: native `<button role="switch" aria-checked>` — no radix; Space/Enter free via button semantics.

## 9. Tooltip (`tooltip.tsx` — pawn API kept)

| Prop | ZCode value | pawn mapping |
|---|---|---|
| container | `rounded-lg` 8px, 1px border, bg tooltip, `px 12px py 6px`, 12px, `max-w 320px`, `gap 6px`, `z-50` | `var(--radius-md)`, `var(--border-color)`, `var(--bg-secondary)`, `var(--text-ui-sm)`; pawn keeps top-layer z-index (portal stacking over dialog overlays) |
| kbd | `rounded-sm`, isolated | existing `app-tooltip-kbd` kept |
| delay | provider `delayDuration 0`; pawn prop `delay 200ms` + 300ms regroup fast-path | kept (behavioral, no change) |
| placement | 4 sides + flip + viewport clamp | kept |

## 10. Select (`select.tsx`)

| Prop | ZCode value (trigger `input` variant) | pawn mapping |
|---|---|---|
| `xs` | `h 20px, rounded-sm` 2px, `pl 8px pr 4px`, 14px, chevron 10px | radius 4px* |
| `sm` | `h 24px, rounded-md`, `pl 8px pr 4px`, 14px, chevron 12px | `var(--radius-sm)` |
| `default` | `h 28px, rounded-md`, `pl 8px pr 4px`, 14px, chevron 14px | same |
| `lg` | `h 32px, rounded-lg`, `pl 12px pr 8px`, 14px, chevron 16px | `var(--radius-md)` |
| rest/hover/focus | border input → hover → focused; placeholder subtlest | `var(--border-color)` → `var(--border-strong)`; `var(--text-muted)` |
| menu/item | same as §6 content/item (`rounded-lg` shell, `min-h 28px` options) | §6 tokens (native popup; no custom menu) |

pawn note: styled native `<select>` — zero JS, full keyboard/screen-reader behavior free.
Other ZCode trigger variants (`default/outline/secondary/ghost/destructive`) map to the matching Button
variant visuals when a button-styled trigger is needed — use `Button` + custom menu (`Dropdown`) instead.

## 11. Checkbox (`checkbox.tsx`)

| Prop | ZCode value | pawn mapping |
|---|---|---|
| box | 16px square, `rounded-sm` 2px, 1px input border, bg input | radius 4px*, `var(--border-color)`, `var(--bg-input)` |
| checked/indeterminate | border + bg primary | `var(--primary)` |
| glyph | 12px check/minus, currentColor (on-primary) | inline SVG, `var(--on-primary)` |
| focus | ring on input-border-focused | global `:focus-visible` outline |
| disabled | `opacity: 0.5` | same |

pawn note: native `<input type="checkbox">` with `appearance: none`; `indeterminate` set via ref prop.

## 12. Separator (`separator.tsx`)

| Prop | ZCode value | pawn mapping |
|---|---|---|
| horizontal | `h 1px, w full`, bg border | `var(--border-color)` |
| vertical | `w 1px, self-stretch` | same |

## Token reuse ledger (no new tokens added)

`--primary --primary-active --on-primary --bg-input --bg-elevated --bg-hover --bg-active --surface
--text-primary --text-secondary --text-muted --border-color --border-strong --danger --warning
--success --idle-task --focus-ring --dur-instant --dur-fast --dur-med --text-ui-base --text-ui-caption
--text-ui-sm --text-ui-xs --radius-xs --radius-sm --radius-md --radius-lg --radius-xl
--space-xs --space-sm --space-md --space-lg --space-xl`
plus `color-mix()` for % tints (already used in `global.css`).
Deviations from ZCode: 2px radii → 4px token; focus rings → pawn global outline; tooltip bg → `--bg-secondary`.
