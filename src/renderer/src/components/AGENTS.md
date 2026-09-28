# renderer/src/components - React UI

## OVERVIEW
This is one flat directory with about 63 `.tsx` files and no feature folders or barrel. Each component default-exports one function and side-effect imports its co-located `X.css`.

## STRUCTURE
```
ChatArea.tsx (1340) + ChatArea.css (2667)   chat view  <- hotspot
Settings.tsx + settingsMeta.ts (SECTIONS) + settingsState.ts (useSettingsState, 777)
*SettingsPanel.tsx      settings sections
RightPanel.tsx          tabs + native WebContentsView browser coordination
BottomTerminal.tsx ToolMessage.tsx ToolBatch.tsx MarkdownRenderer.tsx PermissionDialog.tsx CommandPalette.tsx
toolLabels.ts           human labels for tool ids
__tests__/              23 files (@testing-library/react)
```
`App.tsx` lazy-loads AutomationView, Settings and CommandPalette.

## CONVENTIONS
- All UI strings go through react-i18next `t()`. Add each key to all 4 locales (`../i18n/locales`); the tests enforce parity, plurals, Korean 해요체 and English sentence case.
- CSS classes are kebab-case with a component prefix (`cp-`, `rp-`, `perm-`, `settings-`), using tokens from `../styles/global.css`. No CSS modules or Tailwind.
- Components call `window.api.*` directly, optional-chained, with `.catch(() => {})` on fire-and-forget calls.
- Cross-component signals are DOM CustomEvents named `pawn:*` (toast, open-find, skills-changed, composer-prefill, workspace-changed), mostly consumed in `App.tsx`.
- Dialogs use `useFocusTrap` with `role="dialog"` and `aria-modal`.
- A new Settings section needs three things: a `SettingsSection` id plus a `SECTIONS` row in `settingsMeta.ts`, and a render branch in `Settings.tsx`. Prefer the newer self-managing panel style, where the panel uses stores and IPC itself, over prop-drilled `state: SettingsState`.
- Tests: add `// @vitest-environment jsdom` and mock react-i18next with a key-echo `t`. Stub `(window as any).api` and `vi.mock` heavy children.

## ANTI-PATTERNS
- `MarkdownRenderer`: never render `javascript:` or `data:` links, and never auto-load remote images (they go via main only).
- The renderer never fetches `file:` URLs or remote images (`LocalFileLinks.tsx`), and credentials never reach it (`KiroAuthPanel.tsx`).
- `ChatArea`: never send into another project's session, which can happen with a stale selection. Never yank scroll away from a user who has scrolled up.
- `RightPanel`: never read `openTabs` directly inside effects; mirror it in a ref.
- Do not add new `(window as any).__*` imperative globals (the existing `__toggleTerminal`, `__openRightPanelTab` and similar are legacy). `__openAgentsPanel` is deprecated; use `__openRightPanelTab('agents')`.
- No emojis; use SVG icons.
