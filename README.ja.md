# Pawn

[English](./README.md) · [한국어](./README.ko.md) · [中文](./README.zh.md)

**盤上の、あなたの駒。** コード・ブラウズ・自動化・記憶を担うデスクトップ AI コーディングエージェント。API キーもデータもルールも、あなたの側に。

Pawn はまた別のクラウド囲い込み IDE ではありません。OpenAI / Claude 互換 API を持ち込み、必要なスキルだけ入れ、長期メモリとトークンは本機の `~/.pawn` に置きます。強制ハーネスなし。頼んでいない製品パイプラインなし。

### なぜ “Pawn” か？

チェスのポーン（pawn）は**実際に働く駒**です。前進し、ラインを守り、局面が求めれば成ります。Pawn はそのユニットをデスクトップに置いたもの — ベンダーから借りる王座ではなく、**あなたが動かす**ローカル優先のエージェントです。

---

## できること

- **コード** — ファイル・シェル・Git・シンボル検索・チェック、権限付きエージェントループ
- **エージェントの地力** — モデルネイティブのツール（Claude のテキストエディタ・永続 bash、GPT の `apply_patch`）、モデルのストリーミング中に始まるツール実行、本物のデバッガー（Node・Python・Go・C/C++/Rust）、LSP のリネーム・クイックフィックス・呼び出し階層、ローカルの意味検索、影響するテストの選別、開発サーバー・ブラウザの実行時エラー検知、長時間タスクの持久力（出力の退避・コンテキスト整理・作業メモ・チェックポイント）、別モデルの意見を含む行き詰まり回復、学習するリポジトリプロファイルと修正からの学習
- **ブラウザ** — 埋め込み Chromium（`browser_*`）で実 Web UI・ログインセッション。**マルチタブ**：エージェント・UI パネル・サブエージェントがそれぞれタブを持ち（owner 分離）、画面を邪魔せず並行ブラウズ
- **リサーチ** — 追加キー不要の公開 Web 検索/取得（`web_search` / `web_fetch` / `web_research`）＋ **`research_report`**：並行リサーチ・サブエージェント（各タブ）が収集・重複排除し、出典検証済みレポートのアーティファクトに統合
- **コンピューター操作** — Codex / Claude の computer use のように Mac アプリを操作：ネイティブヘルパーによるアクセシビリティツリー要素操作、アプリ・ウインドウ・メニュー制御、高解像度スクリーンショットと拡大、オンデバイス OCR、IME 対応入力、マルチモニター、Claude ネイティブのコンピューターツール。Esc 2回で停止（`computer_*`、Windows/Linux は基本的なマウス・キーボード）
- **録画＆再生** — Pawn ブラウザや Mac アプリで作業を一度見せると、新しい入力や予約実行でエージェントが繰り返せるスキルを作ります（macOS）
- **意思決定モデル** — 任意。ホスト型 TypeSafe Jev またはローカルの Ollaya で、はい/いいえ・ひとつ選ぶ・スコアを補正済み確率で素早く判定：`decide` ツール、シェルコマンドの危険度チェック、自動ルーティングの補助
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

### 最新 — v0.16.1

**xAI サインインと Markdown プレビュー**
- **xAI OAuth** — 設定 → プロバイダー → xAI で SuperGrok または X Premium+ にサインインできます（デバイスコード）。console の API キーも使え、サインアウト中はキーが使われます。リフレッシュトークンは `~/.pawn` に暗号化して保存されます
- **Markdown プレビュー** — ファイルビューアの `.md` は表示とソースを切り替えられます。相対リンクはそのファイルのフォルダ基準です

### v0.16.0

**Cursor に寄せた画面**
- **暖かいキャンバス** — ライトはクリーム、ダークは暖色の近黒。白いカードはヘアラインだけで区切り、ドロップシャドウはありません
- **抑えたオレンジ** — `#f54e00` はワードマークと主要な操作（送信、主ボタン）だけ。選択の強調はインク色のままです
- **書体** — UI は Inter、ハングル・かな・漢字は Pretendard、コードは JetBrains Mono
- **エージェントのタイムライン** — ツール行は動作に応じた桃・ミント・青・ラベンダーのピルで、完了はゴールドです

### v0.15.1

**UI の刷新 ＋ Computer Use の簡単セットアップ**
- **落ち着いた洗練された UI** — Pretendard フォント、統一した文字・余白・角丸のスケール、コントラストを上げたニュートラルな zinc ライトテーマ。大文字ラベル、アクセントの線、グラデーションや発光をなくし、入力欄はフォーカス時に光らず枠線だけがはっきりします
- **使用量の予算** — セッション・1日の上限入力が、数字がそろう `$` 付きの入力欄になりました
- **ワンクリックの Computer Use 設定** — 設定 → Computer Use のボタンが、ヘルパーがなければ準備し（開発ビルド）、アクセシビリティと画面収録の権限を求め、まだオンにする必要があるシステム設定の画面を開きます

### v0.15.0

**録画＆再生 ＋ 意思決定モデル**
- **録画＆再生（macOS）** — ワークフローを一度見せるだけで再利用できるスキルになります。入力欄の録画ボタン（または `/record`）を押し、Pawn ブラウザや Mac アプリで作業して停止すると（Esc 2回でも可）、Pawn が `SKILL.md` を書きます。実行ごとに変わる入力、座標ではなく画面のラベルによる手順、確認手順、送信前の確認ルールが入ります。`~/.agents/skills` に保存し、新しい入力で再実行（`/スキル名`）、チャットで調整、自動化として予約できます
- **プライバシー重視** — パスワード、ワンタイムコード、カード番号、macOS のセキュア入力欄は記録せず、Pawn 自身のウィンドウとエージェントの入力は無視し、録画中は画面に赤い表示が出ます。元の録画はメモリ上にだけあり、スキルを書き終えると消えます
- **意思決定モデル（任意）** — 設定 → 意思決定モデルで、チャットモデルの隣に高速な判定モデル（"System One"）を追加します。**TypeSafe Jev**（ホスト型、公式 SDK）か **Ollaya**（Laya や Winnow などの公開モデルを Mac で実行）から選べます。エージェントは仕分け・順位付け・確認に使う `decide` ツールを得て、確認なしで実行されるシェルコマンドが破壊的だったりデータを外に送りそうなら確認に戻し、自動ルーティングはリクエストの難しさの判定に使えます。モデルが遅いかオフのときは通常の動作に戻ります
- **その他** — `save_skill` ツール、メニューバーの「ワークフローを録画…」、ネイティブヘルパー 1.1.0

過去のリリースノート: [GitHub Releases](https://github.com/parkjangwon/pawn/releases)。

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

### 意思決定モデル（任意）

| プロバイダー | 説明 |
|--------------|------|
| **TypeSafe**（Jev） | ホスト型・公式。[TypeSafe コンソール](https://console.typesafe.ai)の API キーを使用、公式 `@typesafe-ai/sdk` で呼び出し、入力トークン単位で TypeSafe が課金 |
| **Ollaya** | 公開の意思決定モデル（Laya、Winnow、decider など）を Mac の `http://localhost:11435` で実行 — [ダウンロード](https://ollaya.dev/download)後に `ollaya pull laya`。キー不要、データは外に出ません |
| カスタム | TypeSafe 互換サーバー（`/v1/systemone`）なら何でも |

キーは `~/.pawn/decision.json` に暗号化して保存し、すべてのリクエストで秘密情報を伏せます。

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
