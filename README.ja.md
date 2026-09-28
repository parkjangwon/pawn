# Pawn

[English](./README.md) · [한국어](./README.ko.md) · [中文](./README.zh.md)

**盤上の自分の駒。** コードを書き、ブラウザを見て、コンピュータを操作するデスクトップ AI エージェント。API キーもマシンも自分のもの。

Pawn は Electron アプリです。OpenAI / Claude 互換 API を向けます。セッション、記憶、フックは `~/.pawn` に置きます。スキルは必要なものだけ入れます。

## できること

**リポジトリ、ブラウザ、デスクトップを一つのエージェントが見ます。** ファイルを直し、シェルと git を動かし、言語サーバーに従い、デバッガを付けられます（Node、Python、Go、C/C++/Rust）。内蔵ブラウザは独自の Cookie を持つので、ログイン済みのサイトを扱えます。Mac ではネイティブヘルパーがアクセシビリティツリーから他のアプリを操作します。Windows と Linux はマウス、キーボード、スクリーンショットです。

**一度見せればスキルになります。** macOS で Pawn のブラウザか他の Mac アプリの操作を録画すると `SKILL.md` ができます。別の入力で再実行するか、スケジュールに載せられます。パスワード、ワンタイムコード、カード番号、macOS のセキュア入力欄は記録しません。

**出典のある調査。** 公開ウェブは追加の API キーなしで検索し、読めます。深い調査は並列のリサーチエージェントが、引用を照合したレポートをプロジェクトに書きます。

**すでに払っているサブスクリプションで使います。** 設定から ChatGPT（Plus、Pro、Team、Enterprise）、Claude（Pro、Max、Team、Enterprise）、xAI（SuperGrok または X Premium+）、Antigravity（そこで使っている Google アカウント）にサインインできます。利用量はそのサブスクリプションから消費されます。対応するプリセットの API キーも使え、サインアウト中はそのキーが動きます。リフレッシュトークンは `~/.pawn` に暗号化して保存されます。

**このコンピュータの中にあります。** キーは OS のキーチェーンがあればそこへ保存します。長期記憶はローカルのデータベースです。Claude Code のスキル、プラグイン、`CLAUDE.md`、フック、MCP 設定をいつもの場所から読みます。Google、GitHub、GitLab、AWS CodeCommit は設定から接続します。

**仕事を続けます。** 自動ルーティングがモデルを選び、プロンプトキャッシュが温かいあいだそのモデルを維持します。長い仕事はメモとチェックポイントを残します。サブエージェントが仕事を分け、git worktree でも働けます。同じエージェントをウィンドウなしで `pawn-headless` から動かせます。

## インストール

```bash
npx @parkjangwon/pawn
```

またはランチャーをグローバルに入れます。

```bash
npm install -g @parkjangwon/pawn
pawn
```

**手動ダウンロード:** [Releases](https://github.com/parkjangwon/pawn/releases/latest)

| プラットフォーム | パッケージ |
|------------------|------------|
| macOS | `pawn-<version>-universal.dmg`（Apple Silicon + Intel）。初回は右クリック → **開く**。 |
| Windows | `pawn-<version>-x64-setup.exe` または `pawn-<version>-arm64-setup.exe` |
| Linux | `pawn-<version>-x64` / `arm64` の `.AppImage` と `.deb` |

macOS 10.12+ / Windows 10+ / Linux。API キーは自分で用意します。

起動後、設定でキーを入れ、プロジェクトフォルダを開きます。

## エージェントへ

ここまでが人向けです。Pawn をインストール・設定・変更するコーディングエージェントはガイドを読みます。

| 言語 | ガイド |
|------|--------|
| English | [docs/agent/GUIDE.md](./docs/agent/GUIDE.md) |
| 한국어 | [docs/agent/GUIDE.ko.md](./docs/agent/GUIDE.ko.md) |
| 中文 | [docs/agent/GUIDE.zh.md](./docs/agent/GUIDE.zh.md) |
| 日本語 | [docs/agent/GUIDE.ja.md](./docs/agent/GUIDE.ja.md) |

## ライセンス

MIT — [LICENSE](./LICENSE)。OAuth のプライバシー: [PRIVACY.md](./PRIVACY.md)。

公開ウェブのリサーチは [insane-search](https://github.com/fivetaku/insane-search)（MIT）を移したものです。
