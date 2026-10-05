# mods

Pawn의 Claude Code 호환 mods 안내예요. `hooks/hooks.json`에 `modules`가 있는 로컬 플러그인이 mod입니다. 모듈은 `register(on)`을 내보내고 **에이전트 프로세스 안**에서 돌아요. 턴을 보거나, 고치거나, 대신 답하거나, 채팅 UI를 그릴 수 있어요.

설정 훅이 아니에요. 설정 훅(`~/.pawn/hooks.json`, Claude `settings.json`)은 메인 프로세스의 셸·HTTP 명령이에요. mods는 `$` API가 있는 JavaScript/TypeScript 미들웨어예요.

mods를 꺼도 스킬과 MCP는 그대로예요.

운영 요약은 [GUIDE.ko.md](./GUIDE.ko.md) §7. 다른 언어: [English](./MODS.md) · [日本語](./MODS.ja.md) · [中文](./MODS.zh.md).

## 1. 폴더 모양

```text
my-mod/
├── .claude-plugin/plugin.json    # 또는 .pawn-plugin/plugin.json
└── hooks/
    ├── hooks.json                # { "modules": ["./register.js"] }
    └── register.js               # export function register(on) { … }
```

`plugin.json`에는 `name`이 필요해요. `version`과 `description`은 설정에 보여요. 동의는 이 버전에 묶여요.

```json
{
  "name": "first-mod",
  "version": "0.1.0",
  "description": "도구 호출을 세고, 입력창 위 띠를 보여 주고, /tally와 ping 도구를 넣어요"
}
```

```json
{
  "modules": ["./register.js"]
}
```

진입점은 `.js`, `.mjs`, `.ts`예요. TypeScript는 import 전에 컴파일러로 지워요. `modules`가 없는 플러그인은 그냥 플러그인이에요. mod가 되지 않아요.

예제: `examples/mods/first-mod/`.

## 2. 어디서 찾나

| 출처 | 경로 | 메모 |
|------|------|------|
| 사용자 | `~/.pawn/mods/<name>/` | 설정에서 예제를 설치하면 `first-mod`가 여기로 복사돼요 |
| 추가 폴더 | 설정의 절대 경로 | 설정 → 플러그인 → mods → 폴더 선택 |
| 프로젝트 | `<project>/.claude/plugins/` | 열린 프로젝트와 함께 불러와요 |
| Claude 설치분 | Claude `installed_plugins.json` | **Claude 플러그인도 스캔**을 켜기 전에는 안 봐요 |

설정 파일: `~/.pawn/mods-settings.json`.

| 필드 | 의미 |
|------|------|
| `enabled` | 전체 스위치. |
| `disableAllHooks` | true면 설치된 mods를 불러오지 않아요. 설정의 “mods 실행”을 끈 상태예요. 스킬과 MCP는 그대로예요. |
| `disabledPlugins` | 동의한 뒤 끈 이름. |
| `consentedPlugins` | `{ "name", "version" }[]`. 키가 한 번도 없던 예전 파일만 `null`이에요. 그때는 기존 mods를 허용한 것으로 봐요. |
| `pluginDirs` | 추가로 스캔할 절대 경로. |
| `readClaudePlugins` | Claude 설치분을 스캔. 기본값 `false`. |
| `pluginOrder` | 같은 티어에서 앞에 있는 이름이 먼저예요. 목록에 없는 이름은 그 뒤에 발견한 순서로 남아요. 채팅 충돌 메뉴의 먼저/나중이 이 필드를 써요. |

예전 `consentedPlugins`의 문자열은 버전 `*`로 읽어요. 어떤 버전이든 허용이에요. 버전을 적으면 `plugin.json`과 같아야 해요. 같은 이름의 더 새 빌드는 **오래됨**으로 표시되고, 다시 검토하기 전에는 꺼져 있어요.

## 3. 동의와 위험

mods는 샌드박스가 없어요. 파일, 셸, 네트워크, 채팅을 내 계정 권한으로 써요.

불러오기 전에 설정이 검토 창을 보여요.

- 등록한 훅과 소스의 `$.…` 호출로 만든 권한 칩
- 위험 칩: 프로세스나 네트워크면 **높음**, 파일이나 도구면 **보통**, 아니면 **낮음**
- 허용하는 버전

허용하면 그 버전이 `consentedPlugins`에 들어가고, 이름은 `disabledPlugins`에서 빠져요. 동의를 철회하면 항목을 지우고 그 이름을 꺼요.

정적 검사: 앱이 폴더에 `mods.validate`를 호출해요 (훅 목록, `$` 호출, 모르는 이벤트 이름). `src/main/mods/validate.ts`의 `KNOWN_EVENTS`에 없는 이름은 오류예요. 그 목록은 앱이 실제로 발생시키는 이벤트보다 넓어요. 발생시키는 목록은 5절이에요.

## 4. `register(on)`

```js
export function register(on) {
  on('tool.call', async ($, event, next) => {
    return next(event)
  })

  on('tool.call', { tool: 'shell_exec' }, async ($, event) => {
    return { deny: '셸은 안 돼요' }
  })
}
```

- `on(event, handler)` 또는 `on(event, matcher, handler)`.
- 매처는 납작한 객체예요. 모든 필드가 이벤트의 같은 필드와 같아야 해요. 문자열은 대소를 구분하지 않아요.
- `next(event)`를 호출하면 이벤트를 넘져요. 고친 객체를 넘겨도 돼요.
- `next` 없이 반환하면 **응답**이에요. Pawn을 포함한 나머지 체인은 돌지 않아요.
- `next.to(event, tier)`는 `append`, `builtin`, `core`로 건너뛰어요.
- `on(…).catch(handler)`는 훅이 던지거나 시간 예산을 넘기면 돌아요.
- 훅 하나의 예산은 약 **10초**예요. 넘기면 그 훅은 건너뛰고 체인은 계속돼요.
- 한 이벤트 안의 순서는 티어예요. `prepend`, `user`, `append`, `builtin`, `core`. 같은 티어에서는 `pluginOrder`가 먼저고, 목록에 없는 이름은 발견한 순서를 유지해요. 채팅 메뉴에서 먼저/나중을 바꾸면 `pluginOrder`에 저장하고 다시 불러와요. 불러온 mod가 둘 이상 같은 이벤트를 들으면 메뉴에 충돌이 나와요. 개입 기록에 줄이 추가되는 것은 `tool.call`이나 `prompt.submit`이 실제로 그렇게 돌 때예요.

첫 인자는 `$`(mods API)예요. `$.plugin.name`과 `$.plugin.root`가 이 mod예요.

## 5. Pawn이 실제로 발생시키는 이벤트

검사기는 Claude Code 쪽 이름을 더 많이 받아요. 지금 앱이 발생시키는 것은 아래뿐이에요.

| 이벤트 | 언제 | 할 수 있는 일 |
|--------|------|----------------|
| `session.start` | 불러온 뒤, 불러온 mod마다 한 번 | `session.start` 훅은 그 발생마다 전부 돌아요. `plugin`은 방금 불러온 mod예요. 명령 등록은 `plugin`이 `$.plugin.name`일 때만 하세요. 같은 이름으로 `$.command.register`를 두 번 하면 예외가 나요. |
| `session.end` | 내릴 때, 불러온 mod마다 한 번 | 같은 방식이에요. `plugin`은 끝나는 mod예요. 관찰만 해요. |
| `session.compact` | 대화를 요약한 뒤 | 관찰. 페이로드 `{ sessionId }`. |
| `prompt.submit` | 사용자 글. 설정 `UserPromptSubmit` 훅보다 먼저. mod는 앞 20만 자만 봐요. 그 글을 그대로 돌려주면 나머지는 유지돼요. 고치면 그 결과가 메시지 전체가 돼요. | `next({ ...e, text })`로 고침. `next` 없이 `{ drop: "이유" }`를 반환하면 턴을 취소. |
| `turn.start` | 프롬프트가 받아들여진 뒤 | 관찰. 페이로드에 `sessionId`. |
| `turn.complete` | 턴이 끝날 때 | 관찰. 페이로드 `{ sessionId, status }`. status는 `completed`, `aborted`, `failed`. |
| `tool.call` | 설정 `PreToolUse`보다 먼저 | `next(e)`면 계속. `{ deny: "이유" }`면 막음. `{ result }`면 도구를 건너뛰고 대신 답함. 페이로드에 `tool`과 인자. |
| `tool.check` | 권한 확인 무렵 | `{ decision: "allow" \| "deny" }`를 반환하거나 고침. |
| `command.run` | 등록된 `/이름`을 쳤거나, 코드가 `$.command.run`을 호출했을 때 | `{ text }`를 반환하면 mod 답으로 채팅에 올라가요. |
| `ui.render` | 스피너, 그리고 입력창 위 띠(`AbovePrompt`) | 스피너는 한 체인이에요. 마지막 `props.suffix`가 남아요. `AbovePrompt`는 맞는 mod를 따로 불러요. 자기 띠의 `props.tree`와 `props.plugin`을 돌려주세요. 다른 mod의 트리는 안 보여요. |
| `ui.press` / `ui.input` / `ui.select` | mod 트리의 Button, Input, Select를 썼을 때 | `id`와 `value`를 읽어요. |

도구 순서: `tool.call` → 설정 `PreToolUse` → Plan 모드 확인 → `tool.check` / 권한 → 도구.

`prompt.submit`은 설정 `UserPromptSubmit`보다 먼저예요. mod가 글을 고쳐도, 설정 훅이 거부하면 턴은 멈춰요.

## 6. 채팅 UI

핸들러는 DOM을 받지 않아요. `$.ui.resolve(event)`가 얼린 트리를 돌려줘요.

```js
on('ui.render', { component: 'AbovePrompt' }, async ($, event, next) => {
  const el = $.ui.resolve(event)
  return next({
    ...event,
    props: {
      ...event.props,
      plugin: $.plugin.name,
      tree: el.Box({
        children: [
          el.Text({ text: '도구 호출: ' + calls }),
          el.Button({ id: 'reset-tally', text: '횟수 초기화' }),
          el.Input({ id: 'note', placeholder: '메모…', value: note })
        ]
      })
    }
  })
})

on('ui.press', { id: 'reset-tally' }, async ($, event) => {
  calls = 0
  $.ui.toast('횟수를 초기화했어요')
  $.ui.invalidate()
  return event
})
```

요소: `Box`, `Text`, `Markdown`, `Code`, `Link`, `Button`, `Input`, `Select`.

| 호출 | 효과 |
|------|------|
| `$.ui.invalidate()` | 채팅이 `ui.render`를 다시 그려요. |
| `$.ui.status(text)` | 칩 아래 한 줄. |
| `$.ui.toast(text, { timeoutMs })` | 구석 토스트. 입력창을 밀지 않아요. |
| `$.ui.notice(text)` | 크롬의 닫을 수 있는 줄. 개입 기록에도 남아요. |
| `$.ui.open({ id, title, tree })` | 도킹 패널. `tree`가 없으면 보여줄 내용이 없다고 해요. |
| `$.ui.close(id)` | 그 패널을 닫아요. |
| 스피너 `props.suffix` | 생각 중 줄 끝에 붙어요. |

칩은 이 채팅에 불러온 mods예요. 메뉴에서 하나를 끄면 `disabledPlugins`에 적고 다시 불러와요. 같은 이벤트를 둘 이상이 들으면 메뉴에 충돌이 나오고, 먼저/나중을 바꿀 수 있어요. `AbovePrompt`를 그린 mod마다 띠가 하나씩 생겨요. 개입 기록은 막음, 대신 답함, 버튼, 그리고 `tool.call`과 `prompt.submit`의 충돌을 남겨요. 채팅 UI를 비우면 기록도 비워요.

## 7. `$` API

| 네임스페이스 | 역할 |
|--------------|------|
| `$.command.register({ name, description })` | 슬래시 명령. 이름은 `[A-Za-z0-9_-]{1,64}`. 내장 명령과 중복은 거절해요. |
| `$.command.run` / `$.command.list` | 명령을 실행하거나 목록. |
| `$.tool.register({ name, description, inputSchema, handler })` | `mcp__<plugin>__<name>`을 모델에 노출해요. 훅이 먼저 답하지 않으면 `handler(args)`가 실행돼요. MCP가 이미 가진 이름은 MCP에 남겨요. |
| `$.tool.call({ tool, ...args })` | `tool.call`을 발생시켜요. |
| `$.prompt.submit({ text, asUser })` | 채팅에 프롬프트를 넣어요. |
| `$.session.id` / `cwd` / `messages` / `usage` | 현재 채팅. |
| `$.fs.read` / `write` / `exists` / `list` / `stat` | 앱 파일 IPC. 4 MiB 한도. 경로는 채팅 cwd 기준. `list`의 `size`는 항상 `0`이에요. |
| `$.process.run(argv, { timeoutMs, cwd })` | 셸. 샌드박스는 켜진 채로예요. 기본 제한 시간은 30초, 최대 10분이에요. `$.env.set` 값은 그 자식 프로세스에만 합쳐져요. 이러면 위험이 높음이에요. |
| `$.http.fetch(url, init)` | `http`/`https`만. `init`은 `method`, `headers`, `body`, `timeoutMs`(기본 30초, 최대 120초). 4xx와 5xx도 `{ status, ok, headers, text }`로 돌아와요. 잘못된 URL이나 다른 스킴은 예외예요. 위험이 높음이에요. |
| `$.store.get` / `set` / `delete` / `keys` | 이 기기의 mod별 키-값. |
| `$.clock.now` / `sleep` / `after` / `every` | 타이머. `after` / `every`가 돌려준 핸들로 취소해요. |
| `$.env.get` / `set` | `get`은 불러올 때 잡은 앱 환경, 그다음 이 mod가 넣은 값이에요. `set`은 이 mod와 이후 `$.process.run`에만 적용돼요. 앱 프로세스 환경은 바꾸지 않아요. |
| `$.model.complete({ prompt, system, model, maxTokens, timeoutMs })` | 라우팅된 모델, 또는 설정된 `model`로 완성 한 번. 채팅 기록에는 안 써요. 빈 프롬프트, 없는 모델, 빈 답은 `{ isAnswered: false, reason }`이에요. `timeoutMs` 기본은 60초, 상한은 180초예요. `maxTokens`는 프로바이더 출력 상한을 낮추기만 해요. |
| `$.turn.abort()` | 현재 턴을 멈춰요. |
| `$.ui.log` | 이 채팅 동안 메모리에만 남아요. 채팅 화면에는 안 그려요. |

Claude Code 문서에 있다고 필드가 있는 것은 아니에요. 위 표가 `src/renderer/src/agent/mods/api.ts`에 있는 것이에요.

## 8. `first-mod`

`examples/mods/first-mod/`는 `tool.call`을 세고, `/tally`와 `ping` 도구를 등록하고, 입력창 위 띠(초기화 버튼과 메모 칸)를 그리고, 스피너 접미사를 붙여요.

**설정 → 플러그인 → mods → 예제 mods 설치**를 누른 뒤 검토 창에서 허용해요. 채팅의 생각 중 줄에 `· tool calls: N…`이 붙어요. `/tally`는 횟수로 답해요. 모델은 `mcp__first-mod__ping`을 부를 수 있고, 결과는 `pong`이에요. 초기화와 메모는 `ui.press`, `ui.input`으로 가요.

## 9. 코드 지도

| 관심 | 경로 |
|------|------|
| 발견, 동의, 검사 | `src/main/mods/` |
| IPC | `src/main/ipc/mods.ts` |
| 런타임, `$`, UI 스토어 | `src/renderer/src/agent/mods/` |
| 설정과 채팅 크롬 | `src/renderer/src/components/ModsSettingsPanel.tsx`, `ModsChrome.tsx`, `ModTree.tsx` |
| 턴에 연결 | `src/renderer/src/stores/chatLoop.ts`, `src/renderer/src/agent/toolExecutor.ts` |
| 헤드리스 | `src/headless/nodeApi.ts`의 `mods.*` |
