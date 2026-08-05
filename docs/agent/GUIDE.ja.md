# Pawn — エージェント保守ガイド

> **対象:** Pawn のインストール・設定・デバッグ・拡張を行うコーディングエージェント（およびメンテナ）。  
> **人間:** ルートの [README.ja.md](../../README.ja.md) から。  
> **他言語:** [English](./GUIDE.md) · [한국어](./GUIDE.ko.md) · [中文](./GUIDE.zh.md)

ユーザーがこのリポジトリ URL を渡し作業を依頼したら、**先にこの文書を読み**、依頼範囲だけを変更してください。

---

## 1. Pawn とは

デスクトップ **AI コーディングエージェント**（Electron + React）。BYOK: OpenAI / Claude 互換 API。データは `~/.pawn` にローカル優先。クラウドハーネスなし。

方針:

- **No harness** — 薄い内蔵ツール + ユーザースキル/プラグイン
- **BYOK** — 互換エンドポイントを自由に登録
- **Auto mode** — 複雑度とキャッシュ粘性に基づくマルチモデルルーティング
- **ローカル Memory** — `~/.pawn/memory.db` のみ
- **Hooks** — Claude/Codex 互換；Claude+Pawn を **マージ** し command/url で **重複排除**；**deny は YOLO より優先**
- **Claude Code 互換** — `CLAUDE.md`、skills、rules、`~/.agents/`、Claude hooks
- **MCP ネイティブ** — Claude Code / Cursor / Pawn サーバーを発見

---

## 2. インストールと起動

```bash
npx @parkjangwon/pawn
# または
npm install -g @parkjangwon/pawn && pawn
```

リリース: https://github.com/parkjangwon/pawn/releases/latest

| OS | 成果物 | メモ |
|----|--------|------|
| macOS | `Pawn-*-universal.dmg` | 未署名: 初回は右クリック → 開く |
| Windows | `*-x64-setup.exe` / `*-arm64-setup.exe` | |
| Linux | `.AppImage` / `.deb` | または `npm run dist:linux` |

要件: macOS 10.12+ / Win 10+ / Linux；ソースビルド時 Node `^20.19.0 || >=22.12.0`；API キー。

キャッシュ: `~/.pawn/installers/`。

---

## 3. スキルとプラグイン

| 方法 | 内容 |
|------|------|
| エージェントへ | GitHub URL + インストール依頼 → `install_skill` |
| ユーザー全局 | `~/.agents/skills/` または `~/.claude/skills/` |
| プロジェクト | `<project>/.claude/skills/`、`skills/`、`.agent/skills/` |
| プラグイン | `.claude/plugins/` など |
| UI | **設定 → プラグイン** |

スキルはカタログ（要約のみ、全文は `load_skill`）。内蔵ツールはインストール不要。

---

## 4. ローカルデータ（`~/.pawn`）

| パス | 用途 |
|------|------|
| `pawn.db` | プロジェクト・セッション・メッセージ・transcript・usage・ルーチン |
| `memory.db` | 長期 Memory カード |
| `hooks.json` | Pawn ユーザー hooks |
| `hooks-settings.json` | hooks マスタースイッチ / ソース切替 |
| `config.toml` | アプリ設定 |
| `mcp.json` | Pawn 管理 MCP |
| `reports/` | 自動化成果物 |
| `installers/` | インストーラキャッシュ |

---

## 5. 内蔵ツール概要

ターンあたり最大 **50** ツールラウンド。ツール種別ごとの権限。キュー / ステアリング。

### ファイル・シェル・Git

`read_file` `write_file` `edit_file` `list_dir` `delete_file` · `read_spreadsheet` · `search_files` `grep_search` · `codebase_search` · `shell_exec` `shell_poll` `shell_kill` · `git_status` `git_diff` `git_log` · `git_pr_ready` · `run_checks` · `write_artifact` `list_artifacts` · `terminal_list` `terminal_read` · `update_plan`

### ライフサイクル Hooks

| ソース | パス |
|--------|------|
| Claude ユーザー | `~/.claude/settings.json` → `hooks` |
| Claude プロジェクト | `<project>/.claude/settings.json` |
| Pawn ユーザー | `~/.pawn/hooks.json` |
| Pawn プロジェクト | `<project>/.pawn/hooks.json` |

イベント: `SessionStart` `UserPromptSubmit` `PreToolUse` `PermissionRequest` `PostToolUse` `Stop`。  
ハンドラ: `command` | `http`。Claude 別名対応（`Bash`→`shell_exec` など）。UI: **設定 → エージェント → Hooks**。

### Memory

`memory_search` `memory_save` `memory_list` `memory_update` `memory_forget`  
自動キャプチャ + ターン注入（untrusted）。UI: **設定 → エージェント → Memory**。スコープ user/project。秘密情報は保存拒否。

### 公開 Web

`web_search` `web_fetch` `web_research` — 追加 API キー不要。ログイン/ペイウォール回避ではない。  
読み取り=`web_*`、操作/ログイン=`browser_*`。SSRF ガード既定 on。

### ブラウザとコンピュータ操作

- `browser_*` — 埋め込み Chromium
- `computer_*` — `screenshot` `displays` `click` `move` `drag` `scroll` `type` `keypress` `clipboard` `wait`
  - 座標は既定で**直前スクショの画像空間**
  - macOS: `brew install cliclick` + アクセシビリティ + 画面収録
  - Windows: PowerShell / Linux: `xdotool`
  - スクショにはビジョンモデル（またはルータのフォールバック）推奨

### サービス接続（Google / GitHub / GitLab / CodeCommit）

**設定 → 接続**。トークンは `~/.pawn` のみ。  
- Google（OAuth）読み取り専用: Drive / Gmail / Calendar / Tasks / Docs / Sheets / Slides  
- GitHub（OAuth）: 読み取り + 任意書き込み（Issue/PR コメント、PR 作成など）  
- GitLab（PAT）: プロジェクト/Issue/MR/コミット/ファイル/検索 + Issue 作成・コメント・MR 作成  
- AWS CodeCommit（IAM）: リポジトリ/ブランチ/コミット/ファイル  
Google/GitHub の OAuth ビルド: [.github/OAUTH_SECRETS.md](../../.github/OAUTH_SECRETS.md)。GitLab/CodeCommit は設定で PAT/IAM を入力（OAuth 不要）。

### アプリ制御

`app_open_tab` `app_close_tab` · `app_set_model` など · `load_skill` `install_skill` · 自動化系 `app_*_automation`

---

## 6. MCP

発見: `~/.claude.json` → プロジェクト `.mcp.json` → `~/.pawn/mcp.json`。  
同一 id はプロジェクトがユーザーを上書き。UI: **設定 → MCP**。

---

## 7. プロバイダとルーティング

- OpenAI / Claude 形式、カスタム OpenAI 互換
- **DeepSeek:** `deepseek-v4-flash` / `pro`。thinking 時は**ツールループごとに `reasoning_content` をエコー必須**（無ければ空文字）。欠けると HTTP 400。スクショはビジョンモデルと併用
- ルータ: simple|medium|complex、キャッシュ粘性、失敗時エスカレーション、クールダウン、ビジョンフォールバック

---

## 8. UI と自動化

右パネル: ターミナル / ファイル / Git / Diff / Artifacts / ブラウザ。  
自動化: `~/.pawn/reports/`。トレイ、`Cmd/Ctrl+K`、段階的クローズ、終了確認。i18n: en/ko/ja/zh。

---

## 9. セキュリティ（壊さない）

- レンダラ: `nodeIntegration: false`、`contextIsolation: true`。システム操作は IPC + preload のみ
- Memory / Web 注入 = untrusted
- Hooks は main のみ；PreToolUse の **deny** は YOLO でも強制

---

## 10. 開発とパッケージ

```bash
npm install
npm run dev | dev:web | build | typecheck | test | check
npm run dist | dist:mac | dist:win | dist:linux | pack
```

```
src/main/          # IPC, DB, memory, hooks, computer, research, connections
src/preload/
src/renderer/src/  # agent, components, stores, i18n
```

貢献ガイド: ルート `CLAUDE.md` / `Claude.md`。

---

## 11. よくある依頼

| 依頼 | 対応 |
|------|------|
| インストール | `npx @parkjangwon/pawn` または Releases；macOS Gatekeeper 注意 |
| API / DeepSeek | 設定 → Providers；thinking + ビジョンフォールバック |
| スキル | `install_skill` または `~/.agents/skills/` |
| コンピュータ操作 (macOS) | cliclick + 権限 + ビジョンモデル |
| MCP | `~/.pawn/mcp.json` または設定 UI |
| Hooks | `~/.pawn/hooks.json` または Claude settings |
| Memory | 設定 → Agent → Memory；`memory.db` |
| サービス接続 | 設定 → Connections（Google/GitHub OAuth、GitLab/CodeCommit PAT） |
| ソースビルド | 正しい Node + `npm install` + `npm run check` |
| ツール拒否 | 権限モード、PreToolUse deny、MCP 状態 |

---

## 12. ライセンス

MIT。OAuth: [PRIVACY.md](../../PRIVACY.md)。英語の完全なツール表は [GUIDE.md](./GUIDE.md)。
