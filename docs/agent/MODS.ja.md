# mods

Pawn の Claude Code 互換 mods。`hooks/hooks.json` に `modules` があるローカルプラグインが mod です。モジュールは `register(on)` を出し、**エージェントプロセスの中**で動きます。ターンの観察、書き換え、代答、チャット UI の描画ができます。

設定フックではありません。設定フック（`~/.pawn/hooks.json`、Claude の `settings.json`）はメインプロセスのシェルまたは HTTP です。mods は `$` API を持つ JavaScript / TypeScript のミドルウェアです。

mods を切ってもスキルと MCP はそのままです。

運用の要約は [GUIDE.ja.md](./GUIDE.ja.md) §7。他言語: [English](./MODS.md) · [한국어](./MODS.ko.md) · [中文](./MODS.zh.md)。

## 1. フォルダ

```text
my-mod/
├── .claude-plugin/plugin.json    # または .pawn-plugin/plugin.json
└── hooks/
    ├── hooks.json                # { "modules": ["./register.js"] }
    └── register.js               # export function register(on) { … }
```

`plugin.json` には `name` が必要です。`version` と `description` は設定に出ます。同意はこの版に結び付きます。

入口は `.js`、`.mjs`、`.ts` です。TypeScript は import の前に TypeScript コンパイラで消します。リストの全モジュールを順に読み込み、それぞれが `register` を出す必要があります。`modules` が無いプラグインは mod になりません。

例: `examples/mods/first-mod/`。

## 2. 探す場所

| 出所 | パス | メモ |
|------|------|------|
| ユーザー | `~/.pawn/mods/<name>/` | 設定のサンプルインストールは `first-mod` をここへコピー |
| 追加フォルダ | 設定の絶対パス | 設定 → プラグイン → mods → フォルダを選択 |
| プロジェクト | `<project>/.claude/plugins/` | 開いているプロジェクトと一緒に読む |
| Claude のインストール | `installed_plugins.json` | **Claude プラグインもスキャン**をオンにするまで見ない |

設定ファイル: `~/.pawn/mods-settings.json`。

| フィールド | 意味 |
|------------|------|
| `enabled` | 全体スイッチ。 |
| `disableAllHooks` | true ならインストール済み mods は読まない。「mods を実行」がオフ。スキルと MCP はそのまま。 |
| `disabledPlugins` | 同意のあとオフにした名前。 |
| `consentedPlugins` | `{ "name", "version" }[]`。キーが一度も無い古いファイルだけ `null`（その mods は許可済み扱い）。 |
| `pluginDirs` | 追加の絶対パス。 |
| `readClaudePlugins` | Claude のインストールをスキャン。既定 `false`。 |
| `pluginOrder` | 同じティアでは先の名前が先に動く。一覧に無い名前は発見順でその後。チャットの競合メニューの先/後がこの項目を書く。 |

古いリストの文字列は版 `*`（どの版でも可）です。版を書いた同意は `plugin.json` と一致が必要です。同じ名前の新しいビルドは再確認するまでオフです。

## 3. 同意と危険度

サンドボックスはありません。ファイル、シェル、ネットワーク、チャットをアカウント権限で使います。

読み込む前に設定が確認ダイアログを出します。

- 登録フックとソース中の `$.…` 呼び出しから作った権限チップ
- 危険度: プロセスまたはネットワークなら高、ファイルまたはツールなら中、それ以外は低
- 許可する版

許可するとその版が `consentedPlugins` に入り、名前は `disabledPlugins` から外れます。同意を取り消すと項目を消し、その名前をオフにします。

静的検査はディレクトリに対する `mods.validate` です（フック一覧、`$` 呼び出し、未知のイベント名）。`src/main/mods/validate.ts` の `KNOWN_EVENTS` に無い名前はエラーです。その集合は、アプリが発火するイベントより広いです。受け付けられても発火しないイベントは、検査結果に警告として出ます。発火するのは第5節です。

## 4. `register(on)`

```js
export function register(on) {
  on('tool.call', async ($, event, next) => next(event))

  on('tool.call', { tool: 'shell_exec' }, async () => {
    return { deny: 'シェルは使わない' }
  })
}
```

- `on(event, handler)` または `on(event, matcher, handler)`。
- マッチャは平坦なオブジェクトです。各フィールドはイベントの同名フィールドと一致します。文字列は大文字小文字を区別しません。
- `next(event)` で次へ。書き換えたオブジェクトを渡せます。
- `next` なしの return は**応答**です。Pawn を含む残りは動きません。
- `next.to(event, tier)` は `append`、`builtin`、`core` へ飛びます。
- `on(…).catch(handler)` は throw か時間切れのときです。
- フック一つの予算は約 **10 秒**です。超えるとそのフックを飛ばしてチェーンは続きます。
- 一つのイベント内の順はティアです。`prepend`、`user`、`append`、`builtin`、`core`。同じティアでは `pluginOrder`、その後は発見順です。チャットメニューの先/後は `pluginOrder` を書いて再読込します。読み込んだ mod が二つ以上同じイベントを聞くと、メニューに競合が出ます。介入ログに行が足されるのは、`tool.call` か `prompt.submit` が実際にそう動いたときです。

第一引数は `$` です。`$.plugin.name` と `$.plugin.root` がこの mod です。

## 5. いま発火するイベント

検査器は Claude Code 側の名前をもっと受けます。アプリがいま発火するのは次だけです。

| イベント | いつ | できること |
|----------|------|------------|
| `session.start` | 読み込み後、読み込んだ mod ごとに一度 | すべての `session.start` フックがそのたびに動く。`plugin` は今読み込んだ mod。コマンド登録は `plugin` が `$.plugin.name` のときだけ。同じ名前の `$.command.register` は二度目で例外。 |
| `session.end` | アンロード時、読み込んだ mod ごとに一度 | 同じように、すべてのフックが動く。`plugin` は終わる mod。観察のみ。 |
| `session.compact` | トランスクリプト要約のあと | 観察。ペイロード `{ sessionId }`。 |
| `prompt.submit` | ユーザー文。設定の `UserPromptSubmit` より前。mod が見るのは先頭 20 万字。そのまま返せば残りは残る。書き換えるとその結果が全文になる。 | `next({ ...e, text })` で書き換え。`next` なしの `{ drop: "理由" }` でターン中止。 |
| `turn.start` | プロンプト受理のあと | 観察。ペイロードに `sessionId`。 |
| `turn.complete` | ターン終了時 | 観察。ペイロード `{ sessionId, status }`。 |
| `tool.call` | 設定の `PreToolUse` より前 | `next(e)` で続行。`{ deny: "理由" }` で拒否。`{ result }` でツールを飛ばして代答。ペイロードに `tool` と引数。 |
| `tool.check` | 権限確認のあたり | `{ decision: "allow" \| "deny" }` を返すか書き換える。 |
| `command.run` | 登録した `/名前` を打ったとき、または `$.command.run` を呼んだとき | `{ text }` を返すと mod の返事としてチャットに出る。 |
| `ui.render` | スピナーと、入力欄の上の帯（`AbovePrompt`） | スピナーは一つのチェーンで、最後の `props.suffix` が残る。`AbovePrompt` は各 mod を別々に呼ぶ。自分の帯の `props.tree` と `props.plugin` を返す。他の mod の木は見えない。 |
| `ui.press` / `ui.input` / `ui.select` | mod ツリーの Button、Input、Select を使ったとき | `id` と `value` を読む。 |

ツールの順: `tool.call` → 設定 `PreToolUse` → Plan モード確認 → `tool.check` / 権限 → ツール。

`prompt.submit` は設定 `UserPromptSubmit` より前です。mod が文を直しても、設定フックが拒否すればターンは止まります。

## 6. チャット UI

ハンドラは DOM を受け取りません。`$.ui.resolve(event)` が凍ったツリーを返します。

要素: `Box`、`Text`、`Markdown`、`Code`、`Link`、`Button`、`Input`、`Select`。

`$.ui.invalidate()` は `ui.render` の再描画です。`$.ui.status` はチップ下の一行、`$.ui.toast` は隅のトースト（入力欄は押しません）、`$.ui.notice` は閉じられる行で介入ログにも残ります。`$.ui.open({ id, title, tree })` はドックのパネルです。`tree` が無いと中身なしと出ます。スピナーの `props.suffix` は思考中の行末に付きます。

チップはこのチャットに読み込んだ mods です。メニューで一つをオフにすると `disabledPlugins` に書いて再読込します。同じイベントを複数が聞くと競合行が出て、先/後で順番を変えられます。`AbovePrompt` を描いた mod ごとに帯が一つ出ます。介入ログは拒否、代答、ボタン、`tool.call` と `prompt.submit` の競合を残します。チャット UI を消すとログも消えます。

`AbovePrompt` の書き方は [MODS.md](./MODS.md) §6 の例と同じです。サンプルは `examples/mods/first-mod/hooks/register.js`。

## 7. `$` API

| 名前空間 | 役割 |
|----------|------|
| `$.command.register({ name, description })` | スラッシュコマンド。名前は `[A-Za-z0-9_-]{1,64}`。組み込みと重複は拒否。 |
| `$.command.run` / `$.command.list` | コマンドを実行するか一覧。 |
| `$.tool.register({ name, description, inputSchema, handler })` | `mcp__<plugin>__<name>` をモデルに出す。フックが先に答えなければ `handler(args)` が動く。MCP が既に持つ名前は MCP のまま。 |
| `$.tool.call` | `tool.call` を発火する。 |
| `$.prompt.submit({ text, asUser })` | チャットへプロンプトを入れる。 |
| `$.session` | `id`、`cwd`、`messages`、`usage`。 |
| `$.fs.*` | アプリのファイル IPC。4 MiB まで。パスはチャットの cwd 基準。`list` の `size` は `0`。 |
| `$.process.run(argv, { timeoutMs, cwd })` | シェル。サンドボックスはオン。既定 30 秒、最大 10 分。`$.env.set` の値はその子にだけ入る。危険度は高。 |
| `$.http.fetch(url, init)` | `http` / `https` のみ。`init` は `method`、`headers`、`body`、`timeoutMs`（既定 30 秒、最大 120 秒）。4xx と 5xx も `{ status, ok, headers, text }`。不正な URL や他のスキームは例外。危険度は高。 |
| `$.store.*` | この端末の mod ごとのキー値。 |
| `$.clock.now` / `sleep` / `after` / `every` | タイマー。`after` と `every` のハンドルでキャンセル。 |
| `$.env.get` / `set` | `get` は読み込み時のアプリ環境、その後この mod が入れた値。スナップショットは mod ソースが `$.env` を使うときだけ取る。`set` はこの mod と後の `$.process.run` だけ。アプリプロセスの環境は変えない。 |
| `$.model.complete({ prompt, system, model, maxTokens, timeoutMs })` | 経路選択されたモデル、または設定済みの `model` で一回。チャットには書かない。空のプロンプト、未知のモデル、空の答えは `{ isAnswered: false, reason }`。`timeoutMs` は既定 60 秒、上限 180 秒。`maxTokens` は出力上限を下げるだけ。 |
| `$.turn.abort()` | いまのターンを止める。 |
| `$.ui.log` | セッション中メモリに残す。チャット画面には出さない。 |

Claude Code の文書にあるフィールドが全部あるわけではありません。上の表が `src/renderer/src/agent/mods/api.ts` の実装です。

## 8. `first-mod` とコード

`examples/mods/first-mod/` は `tool.call` を数え、`/tally` と `ping` ツールを登録し、入力欄の上にリセットとメモ欄を描き、スピナーの接尾辞を付けます。モデルは `mcp__first-mod__ping` を呼べます。結果は `pong` です。

**設定 → プラグイン → mods → サンプル mods を入れる**のあと、確認ダイアログで許可します。思考中の行に `· tool calls: N…` が付きます。`/tally` は回数で答えます。

| 関心 | パス |
|------|------|
| 発見、同意、検査 | `src/main/mods/` |
| IPC | `src/main/ipc/mods.ts` |
| ランタイム、`$`、UI ストア | `src/renderer/src/agent/mods/` |
| 設定とチャット | `ModsSettingsPanel.tsx`、`ModsChrome.tsx`、`ModTree.tsx` |
| ターンへの接続 | `chatLoop.ts`、`toolExecutor.ts` |
| ヘッドレス | `src/headless/nodeApi.ts` の `mods.*` |
