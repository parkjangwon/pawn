# Pawn

[English](./README.md) · [한국어](./README.ko.md) · [中文](./README.zh.md)

**盤上の、あなたの駒。** コード・ブラウズ・自動化・記憶を担うデスクトップ AI コーディングエージェント。API キーもデータもルールも、あなたの側に。

Pawn はまた別のクラウド囲い込み IDE ではありません。OpenAI / Claude 互換 API を持ち込み、必要なスキルだけ入れ、長期メモリとトークンは本機の `~/.pawn` に置きます。強制ハーネスなし。頼んでいない製品パイプラインなし。

### なぜ “Pawn” か？

チェスのポーン（pawn）は**実際に働く駒**です。前進し、ラインを守り、局面が求めれば成ります。Pawn はそのユニットをデスクトップに置いたもの — ベンダーから借りる王座ではなく、**あなたが動かす**ローカル優先のエージェントです。

---

## できること

- **コード** — ファイル・シェル・Git・シンボル検索・チェック、権限付きエージェントループ
- **ブラウザ** — 埋め込み Chromium（`browser_*`）で実 Web UI・ログインセッション。**マルチタブ**：エージェント・UI パネル・サブエージェントがそれぞれタブを持ち（owner 分離）、画面を邪魔せず並行ブラウズ
- **リサーチ** — 追加キー不要の公開 Web 検索/取得（`web_search` / `web_fetch` / `web_research`）＋ **`research_report`**：並行リサーチ・サブエージェント（各タブ）が収集・重複排除し、出典検証済みレポートのアーティファクトに統合
- **コンピュータ操作** — デスクトップのマウス・キーボード・スクショ・クリップボード（`computer_*`）
- **記憶** — ローカル長期 Memory（`~/.pawn/memory.db`）で使うほどパーソナライズ
- **Hooks** — Claude/Codex 互換ライフサイクルフック（Claude + Pawn 設定をマージ・重複排除）
- **連携** — 設定 → 接続で Google / GitHub（OAuth）と GitLab / AWS CodeCommit（PAT）ツール（トークンはローカルのみ）
- **拡張** — MCP、Claude Code スキル/プラグイン、`CLAUDE.md` / `AGENTS.md`、自動化、トレイ
- **サブエージェント** — セッション内サブエージェント、ツール方針・オーケストレーション、任意で worktree レビュー後に適用、並行ブラウズ用の専用タブ
- **マルチルート** — 追加プロジェクトルートと有効 cwd；パネルとエージェントツールがルートを認識
- **セッション** — 永続 plan/thinking、添付を保った編集・再生成、復元、シークレット除外バックアップ
- **利用量・予算** — コンテキストメーター、支出 soft-cap、利用量パネル
- **アップデート** — 設定/起動時に GitHub Releases を確認し、対応インストーラをダウンロードして開く
- **ルーティング** — マルチモデル自動ルーティング、キャッシュ安定、DeepSeek/MiMo thinking + ビジョンフォールバック
- **プロバイダー（BYOK）** — OpenAI、Anthropic、OpenRouter、DeepSeek、**OpenCode Go**、**Command Code**、**Xiaomi MiMo**、Gemini、xAI、Groq などにキーを貼るか、任意の OpenAI/Claude 互換 base URL。可能なら OS `safeStorage` で鍵を暗号化保存
- **モデル一覧同期** — 設定 → プロバイダー → **モデル同期** で `GET {baseUrl}/models` を取得（プリセットはブートストラップ用）

UI: ChatGPT 風レイアウト、ターミナル / ファイル / Git / Diff / ブラウザパネル、ライト・ダーク。言語: 英・韓・日・中。

### 最新 — v0.11.1

**セキュリティ強化＋サブエージェント UX＋安定性**
- **プロジェクトフックをゲート（セキュリティ）** — 開いたリポジトリの `.claude/settings.json` / `.pawn/hooks.json` のフックは既定では実行されません。これらのファイルは信頼できないリポジトリに含まれ、任意のシェルコマンドを実行できるためです。Settings → Hooks で明示的に有効化できます。ユーザースコープのフック（~/.claude、Pawn ディレクトリ）は常に動作します。`npm audit` クリーン（既知の脆弱性 0）
- **サブエージェントのライブ状態をインライン表示** — チャットに折りたためるバー（「ヘルパー N 件 作業中…」）で表示され、展開すると各ランを確認できます。右パネルの Agents タブは履歴用に残し、作業開始時にパネルを強制オープンしません
- **サブエージェントブラウザパネル** — サブエージェントのブラウジングがすべて終わるとサイドパネルを閉じます（サブエージェントが開いた場合のみ — ユーザーが開いた・閲覧中のパネルには触れません）。順次パイプラインのちらつき防止のためデバウンス付き
- **安定性** — サブエージェントのランは予期しないクラッシュでも必ず終了状態になります（幽霊の「running」エントリなし）。DB が使えない環境ではサイドバーのセッション検索がメモリ内リストにフォールバック
- **UI** — プラン／エージェント／レビューウィジェットがチャットのカラム幅に揃い、日本語 UI の表記を整理

### v0.11.0 — キュー/ステア簡略化＋セッション検索＋オーバーレイ強化
- **キュー/ステア簡略化** — コンポーザーのトグルを廃止。送信は設定で選んだモードに従い、キュー モード実行中は停止ボタンの隣に小さな**ステア**ボタンが出て入力中の内容を即時送信します
- **セッション検索** — サイドバーが全セッションのタイトルと**メッセージ内容**を DB から検索するため、一度も開いていないセッションも結果に表示されます
- **オーバーレイ強化** — 設定を開くと埋め込みブラウザ（レンダラー z-index では覆えないネイティブ ビュー）を隠し、閉じると復元します。ブラウザのページとタブは維持されます

---

### v0.10.0 — マルチタブブラウザ＋サブエージェント並行ブラウズ＋`research_report`

- **マルチタブブラウザ** — ブラウザパネルのタブバー、`browser_tab_new / list / switch / close` ツール、ポップアップは新規タブで
- **サブエージェント並行ブラウズ** — owner 別タブ（`session:` / `subagent:` / UI）、表示中のページを決して邪魔しない parked バックグラウンドタブ、実行終了時に自動回収
- **`research_report`** — プランナー → 並行リサーチワーカー（各タブ、`web_search` / `web_research` / `web_fetch` ＋ `browser_*` 併用）→ 重複排除ダシエ → 出典検証済みレポート（アーティファクトは `<project>/artifacts/`、プロジェクト未設定なら `~/Downloads/pawn-artifacts/`）
- **安定性強化** — 全 fire-and-forget IPC 呼び出しに拒否処理を追加、オプショナルチェーン短絡バグを修正、リサーチパイプラインは明確なツールエラーを返す
- その他: Agents パネルレイアウト強化、README/CONTRIBUTING 更新

---

## プロバイダー

Pawn はベンダー鍵を同梱しません。自分の API キー（BYOK）を使います。

| プリセット | 説明 |
|------------|------|
| OpenAI、Anthropic、OpenRouter、Gemini、xAI、Groq など | 標準 OpenAI / Claude 互換エンドポイント |
| DeepSeek | V4 Flash/Pro · ディスクキャッシュ + thinking（ツールループで `reasoning_content` エコー必須） |
| **OpenCode Go** | オープンコーディングモデル向けサブスクゲートウェイ — [docs](https://opencode.ai/docs/ko/go/) · `https://opencode.ai/zen/go/v1` |
| **Command Code** | マルチモデル Provider API — [docs](https://commandcode.ai/docs/provider) · `https://api.commandcode.ai/provider/v1` |
| **Xiaomi MiMo** | OpenAI + Anthropic パス — [docs](https://mimo.mi.com/docs/en-US/quick-start/summary/first-api-call) · `https://api.xiaomimimo.com/v1` |

プロバイダー追加後は **モデル同期**（プリセット追加時も試行）で API 一覧に合わせます。**Test** は紐づいたモデルでプローブします（`gpt-4o-mini` 固定ではない）。

---

## インストール

**かんたんインストール（推奨）:**

```bash
npx @parkjangwon/pawn
```

グローバル CLI:

```bash
npm install -g @parkjangwon/pawn
pawn
```

**手動ダウンロード:** [Releases](https://github.com/parkjangwon/pawn/releases/latest)

| プラットフォーム | パッケージ |
|------------------|------------|
| macOS | `pawn-<version>-universal.dmg`（Apple Silicon + Intel）。初回は右クリック → **開く**（未署名）。 |
| Windows | `pawn-<version>-x64-setup.exe` または `pawn-<version>-arm64-setup.exe` |
| Linux | `pawn-<version>-x64.AppImage` / `.deb`（または `npm run dist:linux`） |

**要件:** macOS 10.12+ / Windows 10+ / Linux · OpenAI または Claude 互換 API キー（BYOK）

起動後: 設定で API キーを追加 → プロジェクトフォルダを開く → チャット。

---

## エージェント向けドキュメント（設定・保守）

人間はこのページで十分です。インストール・設定・保守を任せる**コーディングエージェント**は詳細ガイドを読んでください:

| 言語 | ガイド |
|------|--------|
| English | [docs/agent/GUIDE.md](./docs/agent/GUIDE.md) |
| 한국어 | [docs/agent/GUIDE.ko.md](./docs/agent/GUIDE.ko.md) |
| 中文 | [docs/agent/GUIDE.zh.md](./docs/agent/GUIDE.zh.md) |
| 日本語 | [docs/agent/GUIDE.ja.md](./docs/agent/GUIDE.ja.md) |

組み込みツール一覧、Memory / Hooks / MCP パス、`~/.pawn` レイアウト、コンピュータ操作の OS 依存、OAuth、ソースビルドをまとめています。

**ユーザー向けヒント:** このリポジトリ URL をエージェントに渡し、「スキルを入れて」「MCP をつないで」「macOS で computer use を有効に」と頼んでください。`docs/agent/GUIDE.md` または `GUIDE.ja.md` を読ませるとよいです。

---

## ライセンス

MIT — [LICENSE](./LICENSE)。OAuth プライバシー: [PRIVACY.md](./PRIVACY.md)。

公開 Web リサーチは [insane-search](https://github.com/fivetaku/insane-search)（MIT）を基にしています。
