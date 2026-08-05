# Pawn — 에이전트 유지보수 가이드

> **대상:** Pawn을 설치·설정·디버깅·확장하는 코딩 에이전트(및 메인테이너).  
> **사람:** 루트 [README.ko.md](../../README.ko.md)부터.  
> **다른 언어:** [English](./GUIDE.md) · [中文](./GUIDE.zh.md) · [日本語](./GUIDE.ja.md)

사용자가 이 저장소 URL을 넘기고 작업을 맡기면 **이 문서를 먼저 읽고**, 요청한 범위만 변경하세요.

---

## 1. Pawn이란

데스크톱 **AI 코딩 에이전트** (Electron + React). BYOK: OpenAI·Claude 호환 API. 데이터는 `~/.pawn` 로컬 우선. 클라우드 하네스 없음.

철학:

- **No harness** — 얇은 내장 툴 + 사용자 스킬/플러그인
- **BYOK** — 호환 엔드포인트 자유 등록
- **Auto mode** — 복잡도·캐시 기반 멀티 모델 라우팅
- **로컬 Memory** — `~/.pawn/memory.db` 전용
- **훅** — Claude/Codex 호환; Claude+Pawn **merge** + command/url **중복 제거**; **deny > YOLO**
- **Claude Code 호환** — `CLAUDE.md`, skills, rules, `~/.agents/`, Claude hooks
- **MCP 네이티브** — Claude Code / Cursor / Pawn 서버 탐색

---

## 2. 설치·실행

```bash
npx @parkjangwon/pawn
# 또는
npm install -g @parkjangwon/pawn && pawn
```

릴리스: https://github.com/parkjangwon/pawn/releases/latest

| OS | 아티팩트 | 메모 |
|----|----------|------|
| macOS | `Pawn-*-universal.dmg` | 미서명: 첫 실행 우클릭 → 열기 |
| Windows | `*-x64-setup.exe` / `*-arm64-setup.exe` | |
| Linux | `.AppImage` / `.deb` | 또는 `npm run dist:linux` |

요구: macOS 10.12+ / Win 10+ / Linux; 소스 빌드 시 Node `^20.19.0 || >=22.12.0`; API 키.

캐시: `~/.pawn/installers/`.

---

## 3. 스킬·플러그인

| 방법 | 내용 |
|------|------|
| 에이전트 | GitHub URL + 설치 요청 → `install_skill` |
| 사용자 전역 | `~/.agents/skills/` 또는 `~/.claude/skills/` |
| 프로젝트 | `<project>/.claude/skills/`, `skills/`, `.agent/skills/` |
| 플러그인 | `.claude/plugins/` 등 |
| UI | **설정 → 플러그인** |

스킬은 카탈로그(요약만 노출, 전문은 `load_skill`). 내장 툴은 설치 없이 항상 사용 가능.

---

## 4. 로컬 데이터 (`~/.pawn`)

| 경로 | 용도 |
|------|------|
| `pawn.db` | 프로젝트·세션·메시지·transcript·usage·루틴 |
| `memory.db` | 장기 Memory 카드 |
| `hooks.json` | Pawn 사용자 훅 |
| `hooks-settings.json` | 훅 on/off·소스 토글 |
| `config.toml` | 앱 설정 |
| `mcp.json` | Pawn 관리 MCP |
| `reports/` | 자동화 산출물 |
| `installers/` | 설치 패키지 캐시 |

---

## 5. 내장 툴 요약

턴당 최대 **50** 라운드. 도구 유형별 권한. 큐/조향 모드.

### 파일·셸·git

`read_file` / `write_file` / `edit_file` / `list_dir` / `delete_file` · `read_spreadsheet` · `search_files` / `grep_search` · `codebase_search` · `shell_exec` / `shell_poll` / `shell_kill` · `git_status` / `git_diff` / `git_log` · `git_pr_ready` · `run_checks` · `write_artifact` / `list_artifacts` · `terminal_list` / `terminal_read` · `update_plan`

### 라이프사이클 훅

| 소스 | 경로 |
|------|------|
| Claude 사용자 | `~/.claude/settings.json` → `hooks` |
| Claude 프로젝트 | `<project>/.claude/settings.json` |
| Pawn 사용자 | `~/.pawn/hooks.json` |
| Pawn 프로젝트 | `<project>/.pawn/hooks.json` |

이벤트: `SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PermissionRequest`, `PostToolUse`, `Stop`.  
핸들러: `command` | `http`. Claude 별칭 매칭 (`Bash`→`shell_exec` 등). UI: **설정 → 에이전트 → 훅**.

### Memory

`memory_search` / `memory_save` / `memory_list` / `memory_update` / `memory_forget`  
자동 캡처 + 턴 주입(untrusted). UI: **설정 → 에이전트 → Memory**. 스코프 user/project. 시크릿 저장 거부.

### 공개 웹

`web_search` / `web_fetch` / `web_research` — 추가 API 키 없음. 로그인/페이월 우회 아님.  
읽기=`web_*`, 상호작용/로그인=`browser_*`. SSRF 가드 기본 on.

### 브라우저·컴퓨터

- `browser_*` — 내장 Chromium
- `computer_*` — `screenshot`, `displays`, `click`, `move`, `drag`, `scroll`, `type`, `keypress`, `clipboard`, `wait`
  - 좌표: 기본 **이미지**(직전 스크린샷)
  - macOS: `brew install cliclick` + 손쉬운 사용 + 화면 기록
  - Windows: PowerShell / Linux: `xdotool`
  - 비전 모델(또는 라우터 폴백) 권장

### Google·GitHub

**설정 → 서비스 연동**. 토큰 `~/.pawn`만. 채팅 툴로 사용.  
Google 읽기 전용(Drive/Gmail/Calendar/Tasks/Docs/Sheets/Slides). GitHub 읽기+선택 쓰기(이슈/PR 등).  
OAuth 빌드: [.github/OAUTH_SECRETS.md](../../.github/OAUTH_SECRETS.md).

### 앱 제어

`app_open_tab` / `app_close_tab` · `app_set_model` / `app_set_permission_mode` / `app_set_reasoning` / `app_toggle_theme` · `app_list_automations` / `app_create_automation` · `load_skill` / `install_skill`

---

## 6. MCP

탐색: `~/.claude.json` → 프로젝트 `.mcp.json` → `~/.pawn/mcp.json`.  
프로젝트 id가 사용자 id보다 우선. UI: **설정 → MCP**.

---

## 7. 프로바이더·라우팅

- OpenAI / Claude 포맷, 커스텀 OpenAI 호환
- **DeepSeek:** `deepseek-v4-flash` / `pro` 프리셋. thinking 시 **툴 루프마다 `reasoning_content` 에코 필수**(없으면 빈 문자열). 없으면 HTTP 400. 스크린샷은 비전 모델 페어링
- 라우터: simple|medium|complex, 캐시 점성, 실패 시 에스컬레이션, 쿨다운, 비전 폴백

---

## 8. UI·자동화

오른쪽 패널: 터미널·파일·Git·Diff·Artifacts·Browser.  
자동화: 주기/일/주, `~/.pawn/reports/`. 트레이, `Cmd/Ctrl+K`, progressive close, 종료 확인. i18n: en/ko/ja/zh.

---

## 9. 보안 (깨지 말 것)

- 렌더러: `nodeIntegration: false`, `contextIsolation: true`. 시스템 작업은 IPC + preload만
- Memory/웹 주입 = untrusted
- 훅은 main only; PreToolUse **deny**는 YOLO에서도 강제

---

## 10. 개발·패키징

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

기여 가이드라인: 루트 `CLAUDE.md` / `Claude.md`.

---

## 11. 자주 하는 작업

| 요청 | 조치 |
|------|------|
| 설치 | `npx @parkjangwon/pawn` 또는 릴리스; macOS Gatekeeper |
| API / DeepSeek | 설정 → Providers; thinking + 비전 폴백 |
| 스킬 | `install_skill` 또는 `~/.agents/skills/` |
| 컴퓨터 사용(macOS) | cliclick + 접근성/화면기록 + 비전 모델 |
| MCP | `~/.pawn/mcp.json` 또는 설정 UI |
| 훅 | `~/.pawn/hooks.json` 또는 Claude settings |
| Memory | 설정 → Agent → Memory; `memory.db` |
| OAuth | 설정 → Connections |
| 소스 빌드 | Node 버전 + `npm install` + `npm run check` |
| 툴 거부 | 권한 모드, PreToolUse deny, MCP 상태 |

---

## 12. 라이선스

MIT. OAuth: [PRIVACY.md](../../PRIVACY.md). 상세 표·영문 전문은 [GUIDE.md](./GUIDE.md).
