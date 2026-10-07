# Pawn — エージェントガイド

> **対象:** Pawn をインストール・設定・デバッグ・拡張するコーディングエージェントとメンテナ。
> **人:** [README.ja.md](../../README.ja.md)。
> **他言語:** [English](./GUIDE.md) · [한국어](./GUIDE.ko.md) · [中文](./GUIDE.zh.md)

このリポジトリを渡されて変更を頼まれたら、このファイルを読んでから、頼まれた範囲だけ変えます。

---

## 1. 製品

デスクトップエージェント。Electron + React + TypeScript。BYOK: OpenAI / Claude 互換 API。データは `~/.pawn`。UI 言語: en, ko, ja, zh。

- スキル、プラグイン、MCP、フックはユーザーが入れます。製品が最初から持つのは組み込みツールです。
- Claude Code の配置はその場所で読みます。`CLAUDE.md`、`AGENTS.md`、`.claude/skills`、`.claude/rules`、`~/.agents/`、Claude `settings.json` のフック、`.mcp.json`。
- 入力欄のプレースホルダ（`src/renderer/src/i18n/locales/*.json` の `chat.placeholder`）は招待の一文です。`/`、`@`、`$` は書きません。その文字は打ったときにメニューが開きます。`/` はコマンドとスキル、`@` はファイルとフォルダ、`$` は下書きの先頭だけのギャンビット（`$ulw`）です。画面上の操作は添付、録画（macOS）、Plan/Build、権限ピル、モデルチップ、送信です。

## 2. インストール

```bash
npx @parkjangwon/pawn
# または
npm install -g @parkjangwon/pawn && pawn
```

リリース: https://github.com/parkjangwon/pawn/releases/latest

| OS | ファイル |
|----|----------|
| macOS | `pawn-<version>-universal.dmg`。未署名: 一度は右クリック → 開く。 |
| Windows | `pawn-<version>-x64-setup.exe`、`pawn-<version>-arm64-setup.exe` |
| Linux | `pawn-<version>-{x64,arm64}.AppImage` と `.deb` |

インストーラキャッシュ: `~/.pawn/installers/`。アプリ内: 設定 → システム。ソースビルドの Node: `^20.19.0 \|\| >=22.12.0`。

## 3. `~/.pawn`

| パス | 内容 |
|------|------|
| `pawn.db` | プロジェクト、セッション、メッセージ、トランスクリプト、使用量、ルーティン。WAL。トランスクリプトは UI メッセージと分け、プロンプトキャッシュの接頭辞を保ちます。 |
| `wiki/` | LLMウィキ: エージェントが自ら管理するリンク付きマークダウンページ（`global/`、`projects/<id>/` ごとに `pages/`、`index.md`、`log.md`）。通常のファイルなのでObsidianヴォールトとして開けます。 |
| `hooks.json` / `hooks-settings.json` | ユーザーフックとマスタースイッチ。 |
| `config.toml` | アプリ設定。 |
| `mcp.json` | Pawn が管理する MCP サーバー。 |
| `decision.json` | 決定モデル。キーは `safeStorage` で封緘、ファイルモード `0600`。 |
| `kiro.json` | Kiro 資格情報、封緘。 |
| `index/` | ローカルコード索引（BM25 + dense）。 |
| `outputs/` | 退避したツール出力、7日。`read_output` で読み戻します。 |
| `profiles/` | リポジトリごとに学習したコマンドと注意点。 |
| `reports/` | 自動化の成果物。 |
| `telegram.json` | Telegram ボットトークン（封印）、ペアリング許可リスト、チャットバインディング。モード `0600`。 |

## 4. ループ、モード、権限

メインループは `src/renderer/src/stores/chatLoop.ts`。ユーザーメッセージひとつが、最終回答、権限停止、またはラウンド上限まで進みます。

| つまみ | 値 |
|--------|-----|
| エージェントモード | `plan`（変更ツールは隠し、拒否）· `build`（全表面。権限はそのまま）。`app_set_agent_mode`。 |
| 権限 | `ask` · `auto` · `yolo`。ツールごとの等級は `src/renderer/src/agent/toolPermission.ts`。 |
| ハーネス | `default`（50ラウンド、parallel 呼び出しあたり 6 タスク）· `eco`（25ラウンド、ティア上限 `mid`、3 タスク、プール 2）· `maxing`（80ラウンド、12 タスク、プール 8、同ティアなら強いモデル）。権限、Plan、支出上限は越えません。スキル・MCP・フックには触れません。ユーザーが選んだ推論強度がモードに優先します。 |
| ウルトラワーク | メッセージ先頭の `$ulw` / `$ultrawork`、または `pawn-headless --ulw`。目標が検証されるまで繰り返します。文中の `$`（`$5`、`$HOME`）はギャンビットではありません。 |
| ツールダイエット | スキーマ約 130。コアは常時オン。任意グループは、トランスクリプトで既に使ったか、ユーザー文がグループのキーワードに合うか、モデルが `load_tools` を呼んだあとに付きます。アカウントグループは、そのアカウントが接続されるまで隠れます。設定: smart（既定）または all。 |
| 行き詰まり | 同一呼び出しの反復、編集の空回り、エラーは梯子を上ります。内省 → 強いモデル → 別モデルの意見 → ロールバック提案 → 止まって質問。 |
| 検証ラダー | ファイル編集後、設定 → エージェントの done-gate（typecheck/test）がモデルラウンドなしで一度走ります。auto/yolo は無言で、ask は質問カードで一度尋ねます。失敗はモデルに返り、**2回連続で失敗すると修正ラウンドが一段上のティアに上がります。** |
| 計画の促し | ルーティングがタスクを `complex` と判定し、セッションにプランがなければ、編集前に `update_plan` の作成を促します（ソフトな指示。Plan Strip に進行が表示されます）。 |
| 視覚検証 | 一つのターンで Web UI ファイル（html/css/jsx/tsx/vue/svelte…）を編集すると、ループが一回限りの指示を追加します：実行中の dev サーバーをスクリーンショットで確認し、`browser_console` を読んでから終了する。モデル自身のブラウザツールを使います。 |
| git チェックポイント | ローカル git リポジトリのターンで、最初のファイル変更ツールの前に `git stash create` + `store` を記録します（作業ツリーは無変更）。失敗した試みは `git stash list` で即座に戻せます。 |
| ストリーミング | 読み取り専用ツールは、モデルがまだストリーミング中に開始できます。大きい結果は退避し、完全な圧縮の前に古いものから消します。 |

サブエージェントのハード上限は 25 ラウンドです。`parallel_agents` はハーネスのタスク上限まで受けます（既定 6）。

## 5. ツール

名前が契約です。スキーマは `src/renderer/src/agent/toolDefs/`。

**ファイル、git、シェル**（コア）: `read_file` `write_file` `edit_file` `delete_file` `list_dir` `search_files` `grep_search` `read_spreadsheet` · `git_status` `git_diff` `git_log` `git_add` `git_commit` `git_push` `git_branch` `git_stash` `git_pr_ready` · `shell_exec` `shell_poll` `shell_kill` `shell_wait` `terminal_list` `terminal_read`。

**コード知能**（コア、リファクタ群を除く）: `codebase_search` `semantic_search` `affected_tests` `repo_map` `run_checks` `issue_to_pr` · `lsp_diagnostics` `lsp_definition` `lsp_references` `lsp_hover` · リファクタ群: `lsp_symbols` `lsp_call_hierarchy` `lsp_code_actions` `lsp_apply_code_action` · `lsp_rename` は意味的な名前変更用に残ります。

**持久力**（`workspace` 群）: `working_notes` `checkpoint_mark` `checkpoint_restore` `project_profile` · `read_output` はコアです。

**エージェント**（コア）: `update_plan` `ask_user` `request_plan_approval` `load_tools` `load_skill` `install_skill` `write_artifact` `list_artifacts` · `save_skill` は `skills` 群です。

**ウェブ**（コア、公開ページ、追加キーなし）: `web_search`（DDG HTML + HN + Wikipedia）`web_fetch`（プラットフォーム API → ヘッダグリッド → Jina）`web_research`。取得テキストは信頼しないデータです。SSRF はプライベートとループバックを止めます。`must_invoke_browser` なら `browser_*` へ移ります。[insane-search](https://github.com/fivetaku/insane-search)（MIT）を移したものです。

**ブラウザ**（群 `browser`）: 内蔵 Chromium、独自 Cookie。`browser_navigate` `browser_snapshot` `browser_click` `browser_fill` `browser_select` `browser_read_text` `browser_eval` `browser_scroll` `browser_back` `browser_wait` `browser_screenshot` `browser_open_external` · タブ: `browser_tab_new` `browser_tab_list` `browser_tab_switch` `browser_tab_close` · `browser_console` `browser_network`。エージェント、UI パネル、各サブエージェントは自分のタブを持ちます。

**コンピュータ**（群 `computer`）: `computer_screenshot` `computer_zoom` `computer_ui_snapshot` `computer_ui_action` `computer_find` `computer_ocr` `computer_apps` `computer_windows` `computer_menu` `computer_open` `computer_click` `computer_mouse` `computer_drag` `computer_scroll` `computer_type` `computer_key` `computer_hold_key` `computer_clipboard` `computer_wait` `computer_displays` `computer_status`。

**デバッグ**（群 `debug`）: `debug_start` `debug_breakpoints` `debug_control` `debug_eval` `debug_stop`。Node inspector、debugpy、delve、lldb-dap。

**ウィキ**（コア）: `wiki_search` `wiki_read` `wiki_list` `wiki_write` `wiki_rename` `wiki_delete` `wiki_lint`。エージェントが `[[ページタイトル]]` リンクで知識ページを作り、ターンプレランブルにはウィキの索引と最近の活動が入ります — 信頼しないデータです。範囲: `~/.pawn/wiki` 下の project / global。秘密は保存を拒否します。UI: 設定 → ウィキ — グラフビュー（ホイール/ピンチズーム、ドラッグパン、ノードドラッグ、近傍ハイライト）、並べ替え・全選択・一括削除ができるページグリッド（削除はログに記録）、活動ログ。リンク自動接続は本文中のタイトル言及に[[リンク]]を差し込み、孤立ページに See also を追加します。

**決定**（コア、プロバイダがなければ隠す）: `decide`。呼び出しあたり型付きの質問は最大 32。

**アプリ**（群 `app`。`app_set_agent_mode` はコア）: `app_open_tab` `app_close_tab` `app_set_model` `app_set_permission_mode` `app_set_reasoning` `app_toggle_theme` `app_list_automations` `app_create_automation`。

**サブエージェント**（コア）: `spawn_agent` `parallel_agents` `list_agents` `await_agent` `cancel_agent` `research_report`。

**モデルネイティブツール**（設定 → エージェント、既定でオン）: Anthropic API の Claude 4+ は `read_file` / `write_file` / `edit_file` の代わりに `str_replace_based_edit_tool` と持続 `bash` を受け取ります。GPT-4.1 / GPT-5 / o3 / o4 / Codex は `edit_file` / `write_file` の代わりに `apply_patch` を受け取ります。アンドゥ台帳、古い書き込み検査、権限、Plan ゲートは同じです。Anthropic API の Claude はネイティブコンピュータツール（`computer_20251124` ほか、同じ設定ページ）も受け取れます。

`load_tools` の群: `browser` `computer` `debug` `refactor` `workspace` `github` `gitlab` `google` `codecommit` `app` `skills`。

## 6. サブエージェントとリサーチ

`spawn_agent` のプロファイル: `explore` と `plan`（読み取り専用）、`worker`（実装。既定の隔離は `worktree`、適用は `auto`）、`code-reviewer`（読み取り専用）。カスタム: `.pawn/agents/` または `.claude/agents/`。`background: true` は run id を返します。`await_agent` / `cancel_agent` は id、名前、または `*` を取ります。

`parallel_agents` は独立タスクを同時に走らせ、残りは `depends_on` で順序を付けます。失敗した依存の後続は、`on_dependency_fail` が別を言うまで飛ばします。

`research_report` は主題を計画し、並列ワーカー（各自のタブ、`web_*` と `browser_*` を混ぜる）を走らせ、出典の重複を除き、読み取りツールと `write_artifact` だけを持つ合成器がレポートを書きます。プロジェクトのエージェントファイルがツールを広げても、この合成器のプロファイルは狭いままです。

## 7. スキル、フック、mods、MCP

| スキル | 場所 |
|--------|------|
| チャットで頼む | Git URL → `install_skill`（既定 `user`、または `project`） |
| ユーザー | `~/.agents/skills/<name>/SKILL.md`、`~/.claude/skills/` |
| プロジェクト | `<project>/.claude/skills/`、`skills/`、`.agent/skills/` |
| プラグイン | `.claude/plugins/` と `installed_plugins.json` |
| エージェントが書く | `save_skill` → `~/.agents/skills`。Plan では拒否。 |

スキルは `load_skill` までカタログの一行です。あわせて読むもの: `CLAUDE.md`、`CLAUDE.local.md`、`.claude/rules/*.md`、Codex `.agent/`、`~/.agents/AGENTS.md`。UI: 設定 → プラグイン。

フックは出典をマージします。同じコマンドまたは URL は重複を除きます。`PreToolUse` の拒否は `yolo` でも拒否です。

| 出典 | パス |
|------|------|
| Claude ユーザー | `~/.claude/settings.json` → `hooks` |
| Claude プロジェクト | `<project>/.claude/settings.json` → `hooks` |
| Pawn ユーザー | `~/.pawn/hooks.json` |
| Pawn プロジェクト | `<project>/.pawn/hooks.json` |

イベント: `SessionStart`、`UserPromptSubmit`（止められる）、`PreToolUse`（拒否できる）、`PermissionRequest`、`PostToolUse`（参考）、`Stop`。ハンドラ `type` は `command`（stdin JSON）または `http`（POST JSON）。マッチャは Claude の別名を受けます（`Bash` → `shell_exec`、`Write` / `Edit` → write/edit）。UI: 設定 → エージェント → フック。フックはメインプロセスだけで動きます。

### mods（Claude Code 互換）

`hooks/hooks.json` の `modules` があるプラグインが mod です。`register(on)` を出し、エージェントプロセスの中で動きます。設定フックではありません。書き方、同意、イベント、UI、`$` API は **[MODS.ja.md](./MODS.ja.md)**。

UI は設定 → プラグイン → mods。チャットにはチップと介入ログが出ます。チップのメニューは、複数が同じイベントを聞くと競合を出し、順番を変えられます。介入ログに競合行が残るのは `tool.call` か `prompt.submit` がそう動いたときです。`AbovePrompt` は mod ごとに帯が一つです。イベント、同意、`$` API は [MODS.ja.md](./MODS.ja.md)。`tool.call` は設定の `PreToolUse` より前です。mods を切ってもスキルと MCP は残ります。サンプルは `examples/mods/first-mod/`。

MCP の探索は stdio で、id が衝突するとプロジェクトがユーザーに勝ちます。

1. `~/.claude.json`
2. `<project>/.mcp.json`
3. `~/.pawn/mcp.json`

UI: 設定 → MCP。`user-claude` は読み取り専用です。Pawn は Claude Code のファイルを書きません。

## 8. 録画と再生（macOS）

一度の実演が `SKILL.md` になります。再生は `browser_*`、`computer_*`、MCP を使います。手順は意図と画面上のラベルで、座標ではありません。

- 開始: 入力欄の録画ボタン、`/record`、コマンドパレット、メニューバー。設定で目標、実行ごとに変わる入力、ソースを尋ねます。Pawn ブラウザ（隔離ワールドのスクリプト、要素の名前/役割/ラベル、`isTrusted` イベント）および/または Mac アプリ（`pawn-cua` ≥ 1.1.0）。
- 停止: 録画バー、メニューバー、または Esc 二回。上限: 30 分 / 3000 イベント。赤いピルが画面に残ります。
- プライバシー: パスワード、OTP、カード、macOS のセキュア欄は "secret value, not recorded" として残します。Pawn 自身のウィンドウとエージェントの合成入力は無視します。生の録画（イベント + スクリーンショット最大 8 枚）はメモリだけにあり、スキル草案のためにチャットモデルへ一度送ったあと捨てます。
- カード: 保存（`~/.agents/skills`、上書き前に確認）、実行（`/<name>` と入力を入れる）、自動化、推敲（`save_skill`）。草案が失敗したら、破棄するか終了するまでメモリに残り、やり直せます。

コード: `src/main/recorder/*`、`src/main/ipc/recorder.ts`、`native/macos/pawn-cua/Recorder.swift`、`src/renderer/src/stores/recording.ts`、`src/renderer/src/agent/recordReplay.ts`、`src/renderer/src/agent/skillDrafting.ts`。

## 9. プロバイダ、ルーティング、決定

プリセット: Kiro、OpenAI、Anthropic、OpenRouter、DeepSeek、OpenCode Go（`https://opencode.ai/zen/go/v1`）、Command Code（`https://api.commandcode.ai/provider/v1`）、Xiaomi MiMo（`https://api.xiaomimimo.com/v1`、OpenAI + Anthropic 経路）、Gemini、xAI、Groq、Moonshot、Ollama、LM Studio、および任意の OpenAI / Claude 互換 base URL。

- **サブスクリプションのサインイン**（設定 → プロバイダー）: ChatGPT（Plus、Pro、Team、Enterprise。デバイスコード。利用量はそのサブスクリプション。API キーは OpenAI プリセット）、Claude（Pro、Max、Team、Enterprise、またはコンソール API キー。サインイン中のセッションはサインアウトまで `api.anthropic.com` に使う）、xAI（SuperGrok または X Premium+ のデバイスコード。サインアウト中はコンソール API キー）、Antigravity（Antigravity で使う Google アカウント。API キーは Gemini プリセット）。リフレッシュトークンは `~/.pawn` に暗号化して保存されます。
- **モデル同期**は `GET {baseUrl}/models` を呼びます。シードモデルはブートストラップです。テストはそのプロバイダに既についているモデルで行います。
- キーは OS の `safeStorage` があればそれを使います。
- ルーター: 複雑さ `simple|medium|complex`、キャッシュ固定、ツール失敗後の昇格、プロバイダのクールダウン 5 秒–120 秒、画像ターンのビジョンフォールバック。DeepSeek / MiMo の thinking ツールループは `reasoning_content` を返さなければなりません（なければ空文字）。
- **Kiro**（`apiFormat: kiro`、`src/main/kiro/*`）: AWS Builder ID / IAM Identity Center のデバイスフロー、Kiro API キー（`ksk_`）、または Kiro CLI / IDE ログインの読み取り専用インポート（Pawn はそのログインを更新しません）。チャットは `GenerateAssistantResponse`。非公式プロトコル。ヘッドレス: `KIRO_API_KEY` または CLI ログイン。ライブテスト: `PAWN_KIRO_E2E=1`。

決定モデル（設定 → 決定モデル、`src/main/decision/*`）。有効なプロバイダは一つ。無ければ何も変わりません。転送はメインプロセスのみ、公式 `@typesafe-ai/sdk`、秘密は伏せます。

| プロバイダ | 内容 |
|------------|------|
| TypeSafe（Jev） | `https://api.typesafe.ai`、キー必須、既定モデル `jev-latest`。 |
| Ollaya | `http://localhost:11435` の公開モデル（Laya、Winnow、…）。`OLLAYA_API_KEY` がなければキーなし。 |
| カスタム | TypeSafe 互換の `/v1/systemone`。 |

スイッチは失敗すると通常動作に戻ります。`decide`（既定オン）。シェル危険確認（既定オン）は、自動承認された `shell_exec` が破壊的（`≥ 0.5`）または流出（`≥ 0.8`）に見えるとユーザーへ戻します。ルーター補助（既定オフ、キー `routerAssist`）は p ≥ 0.5 のときターンの複雑さに名前を付けられます。ヘッドレスは `~/.pawn/decision.json` を読みます。キー: `TYPESAFE_API_KEY` / `OLLAYA_API_KEY` / `PAWN_DECISION_API_KEY`。

## 10. 接続

設定 → 接続。トークンは `~/.pawn` だけにあります。

| プロバイダ | 認証 | ツール |
|------------|------|--------|
| GitHub | OAuth | `github_whoami` `list_repos` `get_repo` `list_issues` `get_issue` `list_pulls` `get_pull` `review_pull` `list_commits` `get_file` `search_code` `search_issues` `create_issue` `draft_issue` `comment` `create_pull` |
| GitLab | PAT + base URL | `gitlab_whoami` `list_projects` `get_project` `list_issues` `get_issue` `list_merge_requests` `get_merge_request` `list_commits` `get_file` `search` `create_issue` `comment` `create_merge_request` |
| Google | OAuth、既定は読み取り | `google_whoami` `drive_search` `drive_read` `gmail_search` `gmail_read` `calendar_list` `tasks_list` `sheets_read` `docs_read` `slides_read`。書き込みスコープを与える再接続のあと: `google_gmail_send` `google_sheets_write` `google_calendar_create`。送信や作成の前にユーザーへ確認します。 |
| CodeCommit | IAM キー | `codecommit_whoami` `list_repos` `get_repo` `list_branches` `get_branch` `list_commits` `get_file` |

デスクトップ OAuth クライアント ID（Google、GitHub）はリリース時に注入します。[.github/OAUTH_SECRETS.md](../../.github/OAUTH_SECRETS.md)、[PRIVACY.md](../../PRIVACY.md)。

## 11. Telegram

設定 → Telegram。非公開のボットでこのデスクトップエージェントを DM から動かします。Webhook なしのロングポーリング（OpenClaw・Hermes と同じ構造）。トークンは main プロセスにだけあります。

- 知らない送信者にはペアリングコードだけを返し、エージェントのターンは実行しません。設定で承認するか、数字のユーザー id を手動で追加してコードを省けます。グループチャットは無視します。ボットの文面は各ユーザーの Telegram 言語に従います（不明ならアプリの言語）。
- ペアリング済みのメッセージは、そこで選んだプロジェクト内のフォーカスを奪わないサイドバーチャットとして実行されます。コマンドはエージェントの慣習に従います: `/plan [依頼]` はセッションを計画モードに切り替えて依頼（またはタスク計画の更新）を読み取り専用で実行、`/build` はビルドモードへ復帰、`/tasks` はこのチャットのタスク一覧。このほか `/new` 新しいチャット、`/stop` 取り消し、`/sessions` + `/chat <番号>` チャット切替、`/changes` ファイル変更の確認、`/undo <番号>` 取り消し（後で再変更されたファイルは決して上書きしません）、`/model` モデルと文脈の表示、`/compact` 文脈の圧縮、`/project` フォルダ、`/usage` 直近 1 日の使用量、`/help` `/status` `/whoami` はボットが即答します。
- `ask` 権限の確認はそのチャットに Allow / Deny ボタンとして届きます。デスクトップのダイアログもそのまま動きます。
- 第二のポーラー（HTTP 409）は再試行の後、ゲートウェイが停止します。Pawn を終了すればボットも止まります。起動に成功するたびにコマンド一覧とチャットメニューボタンを Telegram に登録し、`/` 入力時にクライアントの自動補全が出ます。

コード: `src/main/telegram/*`、`src/main/ipc/telegram.ts`、`src/renderer/src/stores/telegramBridge.ts`。

## 12. コンピュータ使用

macOS は同梱ヘルパー `pawn-cua` を使います（Swift: ScreenCaptureKit、CGEvent、Accessibility、Vision）。Homebrew パッケージはありません。アクセシビリティと画面収録を許可します（設定 → エージェント → コンピュータ使用 → 確認）。Esc 二回で止まります。座標は最新スクリーンショットのピクセルで、マルチモニタを知っています。`return_screenshot` は操作に乗せられます。入力は IME 安全で、長いテキストは貼り付けます。

Windows と Linux: PowerShell / `xdotool` でマウス、キーボード、スクリーンショット、クリップボード。

ヘッドレス: `pawn-headless run --computer "…"`。

## 13. ヘッドレス

`npm run headless` が `out/headless/pawn-headless.mjs` を作ります。

```text
pawn-headless run "<prompt>" [--cwd DIR] [--mode default|eco|maxing]
    [--model ID] [--permission auto|yolo|deny] [--plan] [--json]
    [--ulw] [--max-iterations N] [--computer] [--config FILE]
pawn-headless eval [--tasks ids,tags] [--modes a,b] [--models id,id]
    [--repeat N] [--out report.md] [--json-out report.json] [--keep]
pawn-headless tasks
```

`--permission deny` は `ask` に対応します。設定の既定ファイルは `~/.pawn/config.toml`。キー: `PAWN_API_KEY_<PROVIDER_ID>` または `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` / `DEEPSEEK_API_KEY` / `OPENROUTER_API_KEY` / `GEMINI_API_KEY`。

## 14. セキュリティの不変条件

- レンダラ: `nodeIntegration: false`、`contextIsolation: true`。システム呼び出しは `src/main/ipc/*` と `src/preload/index.ts`（`contextBridge`）を通ります。
- ウィキと取得したウェブテキストは信頼しないデータであり、指示ではありません。
- `PreToolUse` / `PermissionRequest` の拒否は `yolo` でも適用されます。
- リサーチの SSRF ガードはオンのままです。ウィキ書き込みの秘密は `[REDACTED:*]` でマスクするか拒否し、録画には決して書きません。
- Telegram ボットトークンがレンダラーに届くことはありません。DM はこのコンピュータでペアリングコードを承認するまで拒否されます。

## 15. 開発

```bash
npm install
npm run dev          # Electron + Vite HMR
npm run dev:web      # レンダラのみ、127.0.0.1:5173
npm run typecheck
npm run test
npm run check        # typecheck + test + build
npm run dist         # 現在の OS → release/
npm run dist:mac | dist:win | dist:linux
npm run pack
```

リリースビルドは `CSC_LINK` / `CSC_KEY_PASSWORD` と `APPLE_ID` / `APPLE_APP_SPECIFIC_PASSWORD` / `APPLE_TEAM_ID` があるときだけ署名します。`build/notarize.cjs` はそのときだけ動きます。

```
src/main/            Electron メイン、IPC、DB、ウィンドウ
  connections/       OAuth + PAT ツール
  wiki/  hooks/  computer/  research/  recorder/  kiro/  decision/
  codeIndex/  debug/  lsp/
src/preload/         contextBridge
src/renderer/src/agent/    ループ、toolDefs、toolHandlers、router
src/headless/        pawn-headless
native/macos/pawn-cua/
```

貢献者の規則: ルートの `CLAUDE.md`。スタック: Electron、React 19、TypeScript、electron-vite、Zustand、i18next、better-sqlite3、MCP SDK、xterm.js、node-pty。

右パネル: ターミナル、ファイル、Git、Diff、アーティファクト、ブラウザ。ファイルビューアの `.md` は描画プレビューとソースを切り替え、相対リンクはそのファイルのフォルダから解決します。コマンドパレット `Cmd/Ctrl+K`。自動化は `~/.pawn/reports/<name>/` に書きます。プロジェクトはフォルダを複数持て、セッションのパスがツールの cwd を選びます。

## 16. プレイブック

| 依頼 | すること |
|------|----------|
| インストール | `npx @parkjangwon/pawn`、またはリリース成果物。macOS Gatekeeper: 右クリック → 開く。 |
| プロバイダ追加 | 設定 → プロバイダ → プリセットまたは base URL → モデル同期。DeepSeek/MiMo の thinking は `reasoning_content` を返すこと。コンピュータ使用はビジョンモデルと組む。 |
| スキル導入 | git URL で `install_skill`、または `~/.agents/skills/<name>/SKILL.md` へコピー。 |
| Mac のコンピュータ使用 | 同梱の `pawn-cua`。アクセシビリティ + 画面収録を許可。cliclick は入れない。 |
| MCP | 設定 → MCP、または `~/.pawn/mcp.json`、またはプロジェクトの `.mcp.json`。 |
| フック | `~/.pawn/hooks.json` または Claude `settings.json`。マージ + 重複除去。拒否が勝つ。 |
| ウィキ | 設定 → ウィキ。ファイル: `~/.pawn/wiki/`（Obsidianで開ける）。 |
| 接続 | 設定 → 接続。Google の書き込みツールは、書き込みスコープを与える再接続が必要。 |
| ワークフロー録画 | macOS。録画ボタンまたは `/record` → 実行 → 停止 → 保存。あとで `/<skill-name>`。 |
| 決定モデル | 設定 → 決定モデル。TypeSafe のキー、または `ollaya serve` + `ollaya pull laya`。 |
| ヘッドレス | `npm run headless` のあと `node out/headless/pawn-headless.mjs run "…"`。 |
| ビルド | 上の Node 版、`npm install`、`npm run check`。 |
| ツール拒否 | 権限モード、Plan モード、`PreToolUse` の拒否、未接続のアカウント、ロードされていないツール群。 |

## 17. ライセンス

MIT。OAuth のプライバシー: [PRIVACY.md](../../PRIVACY.md)。
