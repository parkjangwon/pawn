# Pawn — 에이전트 가이드

> **대상:** Pawn을 설치·설정·디버깅·확장하는 코딩 에이전트와 메인테이너.
> **사람:** [README.ko.md](../../README.ko.md).
> **다른 언어:** [English](./GUIDE.md) · [中文](./GUIDE.zh.md) · [日本語](./GUIDE.ja.md)

이 저장소를 넘기며 수정을 맡기면 이 파일을 읽고, 요청한 범위만 바꿉니다.

---

## 1. 제품

데스크톱 에이전트. Electron + React + TypeScript. BYOK: OpenAI·Claude 호환 API. 데이터는 `~/.pawn`. UI 언어: en, ko, ja, zh.

- 스킬, 플러그인, MCP, 훅은 사용자가 설치합니다. 제품이 기본으로 가진 것은 빌트인 도구입니다.
- Claude Code 배치는 그 자리에서 읽습니다. `CLAUDE.md`, `AGENTS.md`, `.claude/skills`, `.claude/rules`, `~/.agents/`, Claude `settings.json` 훅, `.mcp.json`.
- 입력창 플레이스홀더(`src/renderer/src/i18n/locales/*.json`의 `chat.placeholder`)는 초대 문장 하나입니다. `/`, `@`, `$`를 붙이지 않습니다. 그 글자는 칠 때 메뉴가 열립니다. `/`는 명령과 스킬, `@`는 파일·폴더, `$`는 초안 맨 앞에서만 갬빗(`$ulw`)입니다. 화면에 있는 조작은 첨부, 녹화(macOS), Plan/Build, 권한 알약, 모델 칩, 전송입니다.

## 2. 설치

```bash
npx @parkjangwon/pawn
# 또는
npm install -g @parkjangwon/pawn && pawn
```

릴리스: https://github.com/parkjangwon/pawn/releases/latest

| OS | 파일 |
|----|------|
| macOS | `pawn-<version>-universal.dmg`. 서명 없음: 한 번은 우클릭 → 열기. |
| Windows | `pawn-<version>-x64-setup.exe`, `pawn-<version>-arm64-setup.exe` |
| Linux | `pawn-<version>-{x64,arm64}.AppImage`와 `.deb` |

설치 파일 캐시: `~/.pawn/installers/`. 앱 안 확인: 설정 → 시스템. 소스 빌드 Node: `^20.19.0 \|\| >=22.12.0`.

## 3. `~/.pawn`

| 경로 | 내용 |
|------|------|
| `pawn.db` | 프로젝트, 세션, 메시지, 트랜스크립트, 사용량, 루틴. WAL. 트랜스크립트는 UI 메시지와 분리해 프롬프트 캐시 접두를 유지합니다. |
| `memory.db` | 장기 기억. FTS5 + 로컬 해시 임베딩. |
| `hooks.json` / `hooks-settings.json` | 사용자 훅과 마스터 스위치. |
| `config.toml` | 앱 설정. |
| `mcp.json` | Pawn이 관리하는 MCP 서버. |
| `decision.json` | 결정 모델. 키는 `safeStorage`로 봉인, 파일 모드 `0600`. |
| `kiro.json` | Kiro 자격 증명, 봉인. |
| `index/` | 로컬 코드 인덱스 (BM25 + dense). |
| `outputs/` | 넘긴 도구 출력, 7일. `read_output`으로 다시 읽습니다. |
| `profiles/` | 저장소마다 배운 명령과 주의점. |
| `reports/` | 자동화 산출물. |
| `telegram.json` | 텔레그램 봇 토큰(봉인), 페어링 허용 목록, 채팅 바인딩. 모드 `0600`. |

## 4. 루프, 모드, 권한

메인 루프는 `src/renderer/src/stores/chatLoop.ts`. 사용자 메시지 하나가 최종 답, 권한 정지, 또는 라운드 상한까지 갑니다.

| 항목 | 값 |
|------|-----|
| 에이전트 모드 | `plan` (변경 도구는 숨기고 거부) · `build` (전체. 권한은 그대로). `app_set_agent_mode`. |
| 권한 | `ask` · `auto` · `yolo`. 도구별 등급은 `src/renderer/src/agent/toolPermission.ts`. |
| 하네스 | `default` (50라운드, parallel 호출당 6작업) · `eco` (25라운드, 티어 상한 `mid`, 3작업, 풀 2) · `maxing` (80라운드, 12작업, 풀 8, 같은 티어면 더 강한 모델). 권한, Plan, 지출 한도를 넘지 않습니다. 스킬·MCP·훅을 건드리지 않습니다. 사용자가 고른 추론 강도가 모드보다 우선합니다. |
| 울트라 워크 | 메시지 맨 앞의 `$ulw` / `$ultrawork`, 또는 `pawn-headless --ulw`. 목표가 검증될 때까지 반복합니다. 문장 중간의 `$`(`$5`, `$HOME`)는 갬빗이 아닙니다. |
| 도구 식단 | 스키마 약 130개. 코어는 항상 켜져 있습니다. 선택 그룹은 트랜스크립트에서 이미 썼거나, 사용자 문장이 그룹 키워드에 맞거나, 모델이 `load_tools`를 부른 뒤에 붙습니다. 계정 그룹은 그 계정이 연결되기 전에는 숨습니다. 설정: smart(기본) 또는 all. |
| 막힘 | 같은 호출 반복, 편집 공회전, 오류는 사다리로 올라갑니다. 반성 → 더 강한 모델 → 다른 모델의 의견 → 롤백 제안 → 멈추고 질문. |
| 스트리밍 | 읽기 전용 도구는 모델이 아직 스트리밍 중일 때 시작할 수 있습니다. 큰 결과는 넘긴 뒤, 전체 압축 전에 오래된 것부터 치웁니다. |

서브에이전트 하드 상한은 25라운드입니다. `parallel_agents`는 하네스 작업 상한까지 받습니다 (기본 6).

## 5. 도구

이름이 계약입니다. 스키마는 `src/renderer/src/agent/toolDefs/`.

**파일, git, 셸** (코어): `read_file` `write_file` `edit_file` `delete_file` `list_dir` `search_files` `grep_search` `read_spreadsheet` · `git_status` `git_diff` `git_log` `git_add` `git_commit` `git_push` `git_branch` `git_stash` `git_pr_ready` · `shell_exec` `shell_poll` `shell_kill` `shell_wait` `terminal_list` `terminal_read`.

**코드 지능** (코어, 리팩터 그룹 제외): `codebase_search` `semantic_search` `affected_tests` `repo_map` `run_checks` `issue_to_pr` · `lsp_diagnostics` `lsp_definition` `lsp_references` `lsp_hover` · 리팩터 그룹: `lsp_symbols` `lsp_call_hierarchy` `lsp_code_actions` `lsp_apply_code_action` · `lsp_rename`은 시맨틱 이름 변경용으로 남아 있습니다.

**지구력** (`workspace` 그룹): `working_notes` `checkpoint_mark` `checkpoint_restore` `project_profile` · `read_output`은 코어입니다.

**에이전트** (코어): `update_plan` `ask_user` `request_plan_approval` `load_tools` `load_skill` `install_skill` `write_artifact` `list_artifacts` · `save_skill`은 `skills` 그룹입니다.

**웹** (코어, 공개 페이지, 추가 키 없음): `web_search` (DDG HTML + HN + Wikipedia) `web_fetch` (플랫폼 API → 헤더 그리드 → Jina) `web_research`. 가져온 텍스트는 신뢰하지 않는 데이터입니다. SSRF는 사설·루프백 호스트를 막습니다. `must_invoke_browser`이면 `browser_*`로 넘어갑니다. [insane-search](https://github.com/fivetaku/insane-search) (MIT)를 옮긴 것입니다.

**브라우저** (그룹 `browser`): 내장 Chromium, 자체 쿠키. `browser_navigate` `browser_snapshot` `browser_click` `browser_fill` `browser_select` `browser_read_text` `browser_eval` `browser_scroll` `browser_back` `browser_wait` `browser_screenshot` `browser_open_external` · 탭: `browser_tab_new` `browser_tab_list` `browser_tab_switch` `browser_tab_close` · `browser_console` `browser_network`. 에이전트, UI 패널, 서브에이전트는 각자 탭을 가집니다.

**컴퓨터** (그룹 `computer`): `computer_screenshot` `computer_zoom` `computer_ui_snapshot` `computer_ui_action` `computer_find` `computer_ocr` `computer_apps` `computer_windows` `computer_menu` `computer_open` `computer_click` `computer_mouse` `computer_drag` `computer_scroll` `computer_type` `computer_key` `computer_hold_key` `computer_clipboard` `computer_wait` `computer_displays` `computer_status`.

**디버그** (그룹 `debug`): `debug_start` `debug_breakpoints` `debug_control` `debug_eval` `debug_stop`. Node inspector, debugpy, delve, lldb-dap.

**기억** (코어): `memory_search` `memory_save` `memory_list` `memory_update` `memory_forget` `memory_consolidate`. 턴 뒤에 자동 수집합니다. 주입된 일치는 신뢰하지 않는 데이터입니다. 범위: user / project. 비밀은 저장을 거부합니다. UI: 설정 → 에이전트 → 기억.

**결정** (코어, 프로바이더가 없으면 숨김): `decide`. 호출당 형식 있는 질문 최대 32개.

**앱** (그룹 `app`. `app_set_agent_mode`는 코어): `app_open_tab` `app_close_tab` `app_set_model` `app_set_permission_mode` `app_set_reasoning` `app_toggle_theme` `app_list_automations` `app_create_automation`.

**서브에이전트** (코어): `spawn_agent` `parallel_agents` `list_agents` `await_agent` `cancel_agent` `research_report`.

**모델 네이티브 도구** (설정 → 에이전트, 기본 켜짐): Anthropic API의 Claude 4+는 `read_file` / `write_file` / `edit_file` 대신 `str_replace_based_edit_tool`과 지속형 `bash`를 받습니다. GPT-4.1 / GPT-5 / o3 / o4 / Codex는 `edit_file` / `write_file` 대신 `apply_patch`를 받습니다. 언두 원장, 오래된 쓰기 검사, 권한, Plan 게이트는 같습니다. Anthropic API의 Claude는 네이티브 컴퓨터 도구(`computer_20251124` 등, 같은 설정 페이지)도 받을 수 있습니다.

`load_tools` 그룹: `browser` `computer` `debug` `refactor` `workspace` `github` `gitlab` `google` `codecommit` `app` `skills`.

## 6. 서브에이전트와 리서치

`spawn_agent` 프로필: `explore`와 `plan` (읽기 전용), `worker` (구현. 기본 격리 `worktree`, 적용 `auto`), `code-reviewer` (읽기 전용). 커스텀 프로필: `.pawn/agents/` 또는 `.claude/agents/`. `background: true`는 run id를 돌려줍니다. `await_agent` / `cancel_agent`는 id, 이름, 또는 `*`를 받습니다.

`parallel_agents`는 독립 작업을 동시에 돌리고, 나머지는 `depends_on`으로 순서를 맞춥니다. 실패한 의존성의 후속 작업은 `on_dependency_fail`이 다르게 말하기 전에는 건너뜁니다.

`research_report`는 주제를 계획하고, 병렬 워커(각자 탭, `web_*`와 `browser_*` 혼합)를 돌린 뒤 출처를 중복 제거하고, 읽기 도구와 `write_artifact`만 가진 합성기가 보고서를 씁니다. 프로젝트 에이전트 파일이 도구를 넓혀도 이 합성기 프로필은 좁게 유지됩니다.

## 7. 스킬, 훅, MCP

| 스킬 | 위치 |
|------|------|
| 채팅에서 요청 | Git URL → `install_skill` (기본 `user`, 또는 `project`) |
| 사용자 | `~/.agents/skills/<name>/SKILL.md`, `~/.claude/skills/` |
| 프로젝트 | `<project>/.claude/skills/`, `skills/`, `.agent/skills/` |
| 플러그인 | `.claude/plugins/`와 `installed_plugins.json` |
| 에이전트가 작성 | `save_skill` → `~/.agents/skills`. Plan에서는 거부. |

스킬은 `load_skill` 전까지 카탈로그 한 줄입니다. 함께 읽는 파일: `CLAUDE.md`, `CLAUDE.local.md`, `.claude/rules/*.md`, Codex `.agent/`, `~/.agents/AGENTS.md`. UI: 설정 → 플러그인.

훅은 출처를 합칩니다. 같은 명령이나 URL은 중복을 제거합니다. `PreToolUse` 거부는 `yolo`에서도 거부입니다.

| 출처 | 경로 |
|------|------|
| Claude 사용자 | `~/.claude/settings.json` → `hooks` |
| Claude 프로젝트 | `<project>/.claude/settings.json` → `hooks` |
| Pawn 사용자 | `~/.pawn/hooks.json` |
| Pawn 프로젝트 | `<project>/.pawn/hooks.json` |

이벤트: `SessionStart`, `UserPromptSubmit` (막을 수 있음), `PreToolUse` (거부할 수 있음), `PermissionRequest`, `PostToolUse` (참고), `Stop`. 핸들러 `type`은 `command` (stdin JSON) 또는 `http` (POST JSON)입니다. 매처는 Claude 별칭을 받습니다 (`Bash` → `shell_exec`, `Write` / `Edit` → write/edit). UI: 설정 → 에이전트 → 훅. 훅은 메인 프로세스에서만 돕니다.

MCP 탐색은 stdio이고, id가 겹치면 프로젝트가 사용자를 이깁니다.

1. `~/.claude.json`
2. `<project>/.mcp.json`
3. `~/.pawn/mcp.json`

UI: 설정 → MCP. `user-claude` 항목은 읽기 전용입니다. Pawn은 Claude Code 파일을 쓰지 않습니다.

## 8. 녹화와 재생 (macOS)

한 번의 시연이 `SKILL.md`가 됩니다. 재생은 `browser_*`, `computer_*`, MCP를 씁니다. 단계는 의도와 화면 라벨이고, 좌표가 아닙니다.

- 시작: 입력창 녹화 버튼, `/record`, 명령 팔레트, 메뉴 막대. 설정에서 목표, 실행마다 바뀌는 입력, 소스를 묻습니다. Pawn 브라우저(격리 월드 스크립트, 요소 이름/역할/라벨, `isTrusted` 이벤트) 그리고/또는 Mac 앱(`pawn-cua` ≥ 1.1.0).
- 정지: 녹화 바, 메뉴 막대, 또는 Esc 두 번. 상한: 30분 / 3000이벤트. 화면에 빨간 알약이 남습니다.
- 개인정보: 비밀번호, OTP, 카드, macOS 보안 칸은 "secret value, not recorded"로 남습니다. Pawn 자신의 창과 에이전트의 합성 입력은 무시합니다. 원본 녹화(이벤트 + 스크린샷 최대 8장)는 메모리에만 있고, 스킬 초안을 위해 채팅 모델에 한 번 보낸 뒤 버립니다.
- 카드: 저장(`~/.agents/skills`, 덮어쓰기 전에 확인), 실행(`/<name>`과 입력을 채움), 자동화, 다듬기(`save_skill`). 초안이 실패하면 버리거나 종료할 때까지 메모리에 남아 다시 시도할 수 있습니다.

코드: `src/main/recorder/*`, `src/main/ipc/recorder.ts`, `native/macos/pawn-cua/Recorder.swift`, `src/renderer/src/stores/recording.ts`, `src/renderer/src/agent/recordReplay.ts`, `src/renderer/src/agent/skillDrafting.ts`.

## 9. 프로바이더, 라우팅, 결정

프리셋: Kiro, OpenAI, Anthropic, OpenRouter, DeepSeek, OpenCode Go (`https://opencode.ai/zen/go/v1`), Command Code (`https://api.commandcode.ai/provider/v1`), Xiaomi MiMo (`https://api.xiaomimimo.com/v1`, OpenAI + Anthropic 경로), Gemini, xAI, Groq, Moonshot, Ollama, LM Studio, 그리고 임의의 OpenAI·Claude 호환 base URL.

- **구독 로그인** (설정 → 프로바이더): ChatGPT (Plus, Pro, Team, Enterprise. 기기 코드. 사용량은 그 구독. API 키는 OpenAI 프리셋), Claude (Pro, Max, Team, Enterprise, 또는 콘솔 API 키. 로그인 세션은 로그아웃 전까지 `api.anthropic.com`에 사용), xAI (SuperGrok 또는 X Premium+ 기기 코드. 로그아웃 중에는 콘솔 API 키), Antigravity (Antigravity에 쓰는 Google 계정. API 키는 Gemini 프리셋). 갱신 토큰은 `~/.pawn`에 암호화됩니다.
- **모델 동기화**는 `GET {baseUrl}/models`를 부릅니다. 시드 모델은 부트스트랩입니다. 테스트는 그 프로바이더에 이미 붙은 모델로 합니다.
- 키는 OS `safeStorage`가 있으면 그것을 씁니다.
- 라우터: 복잡도 `simple|medium|complex`, 캐시 고정, 도구 실패 후 상승, 프로바이더 쿨다운 5초–120초, 이미지 턴의 비전 폴백. DeepSeek·MiMo thinking 도구 루프는 `reasoning_content`를 되돌려야 합니다 (없으면 빈 문자열).
- **Kiro** (`apiFormat: kiro`, `src/main/kiro/*`): AWS Builder ID / IAM Identity Center 디바이스 플로, Kiro API 키(`ksk_`), 또는 Kiro CLI / IDE 로그인의 읽기 전용 가져오기 (Pawn은 그 로그인을 갱신하지 않습니다). 채팅은 `GenerateAssistantResponse`. 비공식 프로토콜. 헤드리스: `KIRO_API_KEY` 또는 CLI 로그인. 라이브 테스트: `PAWN_KIRO_E2E=1`.

결정 모델 (설정 → 결정 모델, `src/main/decision/*`). 활성 프로바이더는 하나. 없으면 아무것도 바뀌지 않습니다. 전송은 메인 프로세스만, 공식 `@typesafe-ai/sdk`, 비밀은 가립니다.

| 프로바이더 | 내용 |
|------------|------|
| TypeSafe (Jev) | `https://api.typesafe.ai`, 키 필요, 기본 모델 `jev-latest`. |
| Ollaya | `http://localhost:11435`의 공개 모델 (Laya, Winnow, …). `OLLAYA_API_KEY`가 없으면 키 없음. |
| 직접 입력 | TypeSafe 호환 `/v1/systemone`. |

스위치는 모두 실패하면 원래 동작으로 돌아갑니다. `decide` (기본 켜짐). 셸 위험 확인 (기본 켜짐)은 자동 승인된 `shell_exec`이 파괴적(`≥ 0.5`)이거나 유출(`≥ 0.8`)로 보이면 사용자에게 되돌립니다. 라우터 보조 (기본 꺼짐, 키 `routerAssist`)는 p ≥ 0.5일 때 턴 복잡도에 이름을 붙일 수 있습니다. 헤드리스는 `~/.pawn/decision.json`을 읽습니다. 키: `TYPESAFE_API_KEY` / `OLLAYA_API_KEY` / `PAWN_DECISION_API_KEY`.

## 10. 연동

설정 → 서비스 연동. 토큰은 `~/.pawn`에만 있습니다.

| 프로바이더 | 인증 | 도구 |
|------------|------|------|
| GitHub | OAuth | `github_whoami` `list_repos` `get_repo` `list_issues` `get_issue` `list_pulls` `get_pull` `review_pull` `list_commits` `get_file` `search_code` `search_issues` `create_issue` `draft_issue` `comment` `create_pull` |
| GitLab | PAT + base URL | `gitlab_whoami` `list_projects` `get_project` `list_issues` `get_issue` `list_merge_requests` `get_merge_request` `list_commits` `get_file` `search` `create_issue` `comment` `create_merge_request` |
| Google | OAuth, 기본은 읽기 | `google_whoami` `drive_search` `drive_read` `gmail_search` `gmail_read` `calendar_list` `tasks_list` `sheets_read` `docs_read` `slides_read`. 쓰기 스코프를 주는 재연결 뒤: `google_gmail_send` `google_sheets_write` `google_calendar_create`. 보내거나 만들기 전에 사용자에게 확인합니다. |
| CodeCommit | IAM 키 | `codecommit_whoami` `list_repos` `get_repo` `list_branches` `get_branch` `list_commits` `get_file` |

데스크톱 OAuth 클라이언트 ID (Google, GitHub)는 릴리스 때 주입합니다. [.github/OAUTH_SECRETS.md](../../.github/OAUTH_SECRETS.md), [PRIVACY.md](../../PRIVACY.md).

## 11. 텔레그램

설정 → Telegram. 비공개 봇으로 이 데스크톱 에이전트를 DM에서 불러옵니다. 웹훅 없이 롱폴링(OpenClaw·Hermes와 같은 구조). 토큰은 main 프로세스에만 있습니다.

- 모르는 발신자에게는 페어링 코드만 주고 에이전트 턴은 없습니다. 설정에서 승인하거나 숫자 사용자 id를 직접 추가해 코드를 건너뛸 수 있습니다. 그룹 채팅은 무시합니다. 봇 문구는 각 사용자의 텔레그램 언어를 따릅니다(모르면 앱 언어).
- 페어링된 메시지는 그곳에서 고른 프로젝트에서, 포커스를 가져가지 않는 사이드바 채팅으로 실행됩니다. 명령어는 에이전트 관례를 따릅니다: `/plan [요청]`은 세션을 계획 모드로 바꾸고 요청(또는 작업 계획 갱신)을 읽기 전용으로 실행, `/build`는 빌드 모드 복귀, `/tasks`는 이 채팅의 작업 목록. 이 밖에 `/new` 새 채팅, `/stop` 취소, `/sessions` + `/chat <번호>` 채팅 전환, `/changes` 파일 변경 확인, `/undo <번호>` 되돌리기(나중에 다시 바뀐 파일은 절대 덮지 않음), `/model` 모델과 맥락 표시, `/compact` 맥락 축소, `/project` 폴더, `/usage` 하루 사용량, `/help` `/status` `/whoami`는 봇이 바로 답합니다.
- `ask` 권한 요청은 그 채팅에 Allow / Deny 버튼으로 전달됩니다. 데스크톱 대화창도 그대로 동작합니다.
- 두 번째 폴러(HTTP 409)는 재시도 후 게이트웨이가 멈춥니다. Pawn을 끄면 봇도 멈춥니다. 시작에 성공할 때마다 명령어 목록과 채팅 메뉴 버튼을 텔레그램에 등록해 `/` 입력 때 클라이언트 자동완성을 제공합니다.

코드: `src/main/telegram/*`, `src/main/ipc/telegram.ts`, `src/renderer/src/stores/telegramBridge.ts`.

## 12. 컴퓨터 사용

macOS는 번들 헬퍼 `pawn-cua`를 씁니다 (Swift: ScreenCaptureKit, CGEvent, Accessibility, Vision). Homebrew 패키지는 없습니다. 손쉬운 사용과 화면 기록을 허용합니다 (설정 → 에이전트 → 컴퓨터 사용 → 확인). Esc 두 번이면 멈춥니다. 좌표는 마지막 스크린샷의 픽셀이고 멀티 모니터를 압니다. `return_screenshot`은 동작에 실을 수 있습니다. 입력은 IME에 안전하고, 긴 텍스트는 붙여 넣습니다.

Windows와 Linux: PowerShell / `xdotool`로 마우스, 키보드, 스크린샷, 클립보드.

헤드리스: `pawn-headless run --computer "…"`.

## 13. 헤드리스

`npm run headless`가 `out/headless/pawn-headless.mjs`를 만듭니다.

```text
pawn-headless run "<prompt>" [--cwd DIR] [--mode default|eco|maxing]
    [--model ID] [--permission auto|yolo|deny] [--plan] [--json]
    [--ulw] [--max-iterations N] [--computer] [--config FILE]
pawn-headless eval [--tasks ids,tags] [--modes a,b] [--models id,id]
    [--repeat N] [--out report.md] [--json-out report.json] [--keep]
pawn-headless tasks
```

`--permission deny`는 `ask`로 대응합니다. 설정 기본 파일은 `~/.pawn/config.toml`. 키: `PAWN_API_KEY_<PROVIDER_ID>` 또는 `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` / `DEEPSEEK_API_KEY` / `OPENROUTER_API_KEY` / `GEMINI_API_KEY`.

## 14. 보안 불변 조건

- 렌더러: `nodeIntegration: false`, `contextIsolation: true`. 시스템 호출은 `src/main/ipc/*`와 `src/preload/index.ts` (`contextBridge`)를 통합니다.
- 기억과 가져온 웹 텍스트는 신뢰하지 않는 데이터이고, 지시가 아닙니다.
- `PreToolUse` / `PermissionRequest` 거부는 `yolo`에서도 적용됩니다.
- 리서치 SSRF 가드는 켜 둡니다. 비밀은 기억이나 녹화에 쓰지 않습니다.
- 텔레그램 봇 토큰은 렌더러에 닿지 않습니다. DM은 이 컴퓨터에서 페어링 코드를 승인할 때까지 거부됩니다.

## 15. 개발

```bash
npm install
npm run dev          # Electron + Vite HMR
npm run dev:web      # 렌더러만, 127.0.0.1:5173
npm run typecheck
npm run test
npm run check        # typecheck + test + build
npm run dist         # 현재 OS → release/
npm run dist:mac | dist:win | dist:linux
npm run pack
```

릴리스 빌드는 `CSC_LINK` / `CSC_KEY_PASSWORD`와 `APPLE_ID` / `APPLE_APP_SPECIFIC_PASSWORD` / `APPLE_TEAM_ID`가 있을 때만 서명합니다. `build/notarize.cjs`는 그때만 돕니다.

```
src/main/            Electron 메인, IPC, DB, 창
  connections/       OAuth + PAT 도구
  memory/  hooks/  computer/  research/  recorder/  kiro/  decision/
  codeIndex/  debug/  lsp/
src/preload/         contextBridge
src/renderer/src/agent/    루프, toolDefs, toolHandlers, router
src/headless/        pawn-headless
native/macos/pawn-cua/
```

기여자 규칙: 루트 `CLAUDE.md`. 스택: Electron, React 19, TypeScript, electron-vite, Zustand, i18next, better-sqlite3, MCP SDK, xterm.js, node-pty.

오른쪽 패널: 터미널, 파일, Git, Diff, 아티팩트, 브라우저. 파일 뷰어의 `.md`는 렌더된 미리보기와 원문을 오가고, 상대 링크는 그 파일의 폴더에서 엽니다. 명령 팔레트 `Cmd/Ctrl+K`. 자동화는 `~/.pawn/reports/<name>/`에 씁니다. 프로젝트는 폴더를 여러 개 가질 수 있고, 세션 경로가 도구 cwd를 고릅니다.

## 16. 플레이북

| 요청 | 할 일 |
|------|--------|
| 설치 | `npx @parkjangwon/pawn`, 또는 릴리스 파일. macOS Gatekeeper: 우클릭 → 열기. |
| 프로바이더 추가 | 설정 → 프로바이더 → 프리셋 또는 base URL → 모델 동기화. DeepSeek/MiMo thinking은 `reasoning_content`를 되돌려야 합니다. 컴퓨터 사용은 비전 모델과 짝을 맞춥니다. |
| 스킬 설치 | git URL로 `install_skill`, 또는 `~/.agents/skills/<name>/SKILL.md`에 복사. |
| Mac에서 컴퓨터 사용 | 번들 `pawn-cua`. 손쉬운 사용 + 화면 기록 허용. cliclick은 설치하지 않습니다. |
| MCP | 설정 → MCP, 또는 `~/.pawn/mcp.json`, 또는 프로젝트 `.mcp.json`. |
| 훅 | `~/.pawn/hooks.json` 또는 Claude `settings.json`. 병합 + 중복 제거. 거부가 이깁니다. |
| 기억 | 설정 → 에이전트 → 기억. DB: `~/.pawn/memory.db`. |
| 연동 | 설정 → 서비스 연동. Google 쓰기 도구는 쓰기 스코프를 주는 재연결이 필요합니다. |
| 워크플로 녹화 | macOS. 녹화 버튼 또는 `/record` → 수행 → 정지 → 저장. 이후 `/<skill-name>`. |
| 결정 모델 | 설정 → 결정 모델. TypeSafe 키, 또는 `ollaya serve` + `ollaya pull laya`. |
| 헤드리스 | `npm run headless` 후 `node out/headless/pawn-headless.mjs run "…"`. |
| 빌드 | 위의 Node 버전, `npm install`, `npm run check`. |
| 도구 거부 | 권한 모드, Plan 모드, `PreToolUse` 거부, 연결되지 않은 계정, 로드되지 않은 도구 그룹. |

## 17. 라이선스

MIT. OAuth 개인정보: [PRIVACY.md](../../PRIVACY.md).
