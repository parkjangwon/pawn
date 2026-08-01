# Pawn Development Guide

Guidelines for building, testing, and contributing to the Pawn AI Coding Agent desktop application.

## Build and Run Commands

- **Install Dependencies**: `npm install`
- **Development Run (Electron + Vite HMR)**: `npm run dev`
- **Renderer-Only Web Preview (no Electron)**: `npm run dev:web`
- **Compile & Build Application**: `npm run build`
- **Type Check (TypeScript)**: `npm run typecheck`
- **Full Quality Check (Typecheck + Test + Build)**: `npm run check`

## Packaging Commands

- **Pack Current Platform (Installer)**: `npm run dist`
- **Target macOS (.dmg)**: `npm run dist:mac`
- **Target Windows (.exe)**: `npm run dist:win`
- **Target Linux (.deb, .AppImage)**: `npm run dist:linux`
- **Quick Pack (No Installer)**: `npm run pack`

## Testing Commands

- **Run Automated Tests**: `npm run test`
- **Run Tests in Watch Mode**: `npm run test:watch`
- **Generate Coverage Report**: `npm run test:coverage`

## Architecture & Coding Guidelines

### 1. Security & Process Isolation (Critical)
- **Strict Context Isolation**: Always keep `nodeIntegration: false` and `contextIsolation: true` in the renderer window options.
- **IPC Communication**: Never run Node.js code or native modules directly inside the renderer. All system operations (FS, Shell, DB, Browser) must go through IPC handlers (`src/main/ipc/*`) and be exposed securely via `src/preload/index.ts` using `contextBridge`.

### 2. State & Styling (Renderer)
- **State Management**: Use Zustand stores (`src/renderer/src/stores/*`) for shared client states (app, chat, theme, providers). Keep components modular.
- **Aesthetics & Styling**: Use CSS variables for color tokens and dark/light modes (`src/renderer/src/styles/*`). Follow premium UI guidelines (vibrant gradients, hover states, and smooth micro-animations).

### 3. Local Persistence
- **SQLite Database**: Database scripts in `src/main/db.ts` use `better-sqlite3` with WAL (`journal_mode = WAL`) and foreign keys enabled.
- **Cache-stable History**: Maintain `transcripts` database entries separately from UI `messages` to preserve prompt caching prefixes across provider API calls.

### 4. Smart Model Router
- **Complexity Assessment**: When calling LLMs, route dynamically based on prompt complexity heuristics (`simple`, `medium`, `complex`).
- **Stickiness Policy**: Maintain cache stability and do not downgrade mid-turn unless the cost saving outweighs the re-priming cache write penalty.
