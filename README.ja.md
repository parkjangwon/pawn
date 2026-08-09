# Pawn

[English](./README.md) · [한국어](./README.ko.md) · [中文](./README.zh.md)

**盤上の、あなたの駒。** コード・ブラウズ・自動化・記憶を担うデスクトップ AI コーディングエージェント。API キーもデータもルールも、あなたの側に。

Pawn はまた別のクラウド囲い込み IDE ではありません。OpenAI / Claude 互換 API を持ち込み、必要なスキルだけ入れ、長期メモリとトークンは本機の `~/.pawn` に置きます。強制ハーネスなし。頼んでいない製品パイプラインなし。

### なぜ “Pawn” か？

チェスのポーン（pawn）は**実際に働く駒**です。前進し、ラインを守り、局面が求めれば成ります。Pawn はそのユニットをデスクトップに置いたもの — ベンダーから借りる王座ではなく、**あなたが動かす**ローカル優先のエージェントです。

---

## できること

- **コード** — ファイル・シェル・Git・シンボル検索・チェック、権限付きエージェントループ
- **ブラウザ** — 埋め込み Chromium（`browser_*`）で実 Web UI・ログインセッション（セッション claim 隔離）
- **リサーチ** — 追加キー不要の公開 Web 検索/取得（`web_search` / `web_fetch` / `web_research`）
- **コンピュータ操作** — デスクトップのマウス・キーボード・スクショ・クリップボード（`computer_*`）
- **記憶** — ローカル長期 Memory（`~/.pawn/memory.db`）で使うほどパーソナライズ
- **Hooks** — Claude/Codex 互換ライフサイクルフック（Claude + Pawn 設定をマージ・重複排除）
- **連携** — 設定 → 接続で Google / GitHub（OAuth）と GitLab / AWS CodeCommit（PAT）ツール（トークンはローカルのみ）
- **拡張** — MCP、Claude Code スキル/プラグイン、`CLAUDE.md` / `AGENTS.md`、自動化、トレイ
- **サブエージェント** — セッション内サブエージェント、ツール方針・オーケストレーション、任意で worktree レビュー後に適用
- **マルチルート** — 追加プロジェクトルートと有効 cwd；パネルとエージェントツールがルートを認識
- **セッション** — 永続 plan/thinking、添付を保った編集・再生成、復元、シークレット除外バックアップ
- **利用量・予算** — コンテキストメーター、支出 soft-cap、利用量パネル
- **アップデート** — 設定/起動時に GitHub Releases を確認し、対応インストーラをダウンロードして開く
- **ルーティング** — マルチモデル自動ルーティング、キャッシュ安定、DeepSeek/MiMo thinking + ビジョンフォールバック
- **プロバイダー（BYOK）** — OpenAI、Anthropic、OpenRouter、DeepSeek、**OpenCode Go**、**Command Code**、**Xiaomi MiMo**、Gemini、xAI、Groq などにキーを貼るか、任意の OpenAI/Claude 互換 base URL。可能なら OS `safeStorage` で鍵を暗号化保存
- **モデル一覧同期** — 設定 → プロバイダー → **モデル同期** で `GET {baseUrl}/models` を取得（プリセットはブートストラップ用）

UI: ChatGPT 風レイアウト、ターミナル / ファイル / Git / Diff / ブラウザパネル、ライト・ダーク。言語: 英・韓・日・中。

### 最新 — v0.9.0

BYOK 鍵の暗号化、マルチルート仕上げ、アプリ内アップデート DL、シークレット除外バックアップ、ブラウザ claim 隔離、transcript 安全な編集/再生成、plan・thinking UI、コンテキストメーターと支出上限、worktree レビュー適用、サブエージェント連携、issue→PR ヘルパー、自動化編集、ウェルカムチェックリスト、en/ko/ja/zh パリティ拡大。

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
