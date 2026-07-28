# Contributing to hjcode Desktop

## Development Setup

```bash
git clone https://github.com/parkjangwon/hjcode.git
cd hjcode
npm install
npm run dev
```

## Project Structure

- `src/main/` — Electron main process (IPC handlers, window management, CSP)
- `src/preload/` — Secure context bridge
- `src/renderer/` — React application
  - `src/renderer/src/agent/` — Agent loop, tools, skills, routing
  - `src/renderer/src/components/` — UI components
  - `src/renderer/src/stores/` — Zustand state stores
  - `src/renderer/src/i18n/` — Translations

## Adding a New Tool

1. Add the tool definition in `src/renderer/src/agent/tools.ts` (TOOLS array)
2. Add the execution case in the `executeTool` function
3. The tool will automatically be available to the LLM

## Adding a New Language

1. Create `src/renderer/src/i18n/locales/xx.json`
2. Import and register it in `src/renderer/src/i18n/index.ts`
3. Add the option in Settings language selector

## Code Style

- TypeScript strict mode
- No emojis in UI (use SVG icons)
- CSS variables for theming (no hardcoded colors)
- Zustand for state management
- Functional components with hooks

## Security

- Never use `nodeIntegration: true`
- Always use `contextBridge` for IPC
- No `rehype-raw` in markdown rendering
- CSP headers enforced in production
- Permission system for sensitive operations

## License

MIT
