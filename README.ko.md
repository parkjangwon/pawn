# Pawn

[English Version](./README.md)

AI 코딩 에이전트 GUI — 코딩, 웹 서핑, 컴퓨터 자동화, **기억(Memory)**.

Cursor의 Auto 모드, ChatGPT의 UI, OpenCode의 BYOK, Claude Desktop의 브라우저 사용을 하나로 결합한 데스크톱 앱입니다. 종속성·락인 없이 API 키를 등록하고, 플러그인을 설치하며, 자신만의 에이전트를 만듭니다. **장기 메모리**는 이 기기에만 남아 시간이 지날수록 에이전트를 개인화합니다. **훅**(Claude/Codex 호환)으로 외부 스크립트·연동을 에이전트 루프에 붙입니다.

## 철학

- **No harness (제약 없는 환경)** — 순수한 캔버스. 필요한 스킬·플러그인만 설치. 내장 툴은 **얇은 능력**이며, 고정된 딥리서치 제품 파이프라인이 아닙니다.
- **BYOK** — OpenAI 또는 Claude 호환 규격의 모든 API 엔드포인트 등록.
- **Auto mode** — 작업 난이도·프롬프트 캐시 최적화 기반 멀티 모델 라우팅.
- **로컬 우선 Memory** — 선호·프로젝트 사실은 `~/.pawn/memory.db`에만 저장. Pawn 클라우드로 나가지 않음.
- **라이프사이클 훅** — Claude/Codex 호환 `hooks` 설정. Claude+Pawn 소스 merge·중복 제거. 정책 deny는 YOLO보다 우선.
- **Open source** — MIT, 완전한 커스터마이징.
- **Claude Code 호환** — `CLAUDE.md`, `AGENTS.md`, skills/rules, `~/.agents/`, Claude `settings.json` 훅.
- **MCP 네이티브** — Claude Code, Cursor, Pawn에서 등록한 Model Context Protocol 서버 자동 탐색·연결.

## 설치

[릴리스 페이지](https://github.com/parkjangwon/pawn/releases/latest)에서 플랫폼별 최신 버전을 받거나, 터미널에서 한 줄로 실행합니다.

### 간편 설치 (권장)

```bash
npx @parkjangwon/pawn
```

현재 OS에 맞는 빌드를 받아 설치 파일을 실행합니다. 설치 파일은 `~/.pawn/installers/`에 캐시됩니다. 글로벌 설치:

```bash
npm install -g @parkjangwon/pawn
pawn
```

### 직접 다운로드

- **macOS** — `Pawn-<version>-universal.dmg` (Apple Silicon + Intel). `.dmg`를 열어 **Pawn**을 응용 프로그램으로 드래그.
  - 첫 실행: 우클릭 → **열기** 후 Gatekeeper 승인 (서명되지 않은 빌드).
- **Windows** — `Pawn-<version>-x64-setup.exe` (Intel/AMD) 또는 `Pawn-<version>-arm64-setup.exe` (ARM).
- **Linux** — 릴리스의 `.AppImage` / `.deb` (또는 `npm run dist:linux`로 빌드).

### 스킬 & 플러그인 설치

- **Pawn에게 맡기기** — GitHub URL을 붙여넣고 "이 스킬 설치해줘" (`install_skill`) → 레이아웃 자동 감지 후 표준 경로 설치.
- **사용자 전역 스킬** — `~/.agents/skills/` 또는 `~/.claude/skills/`.
- **프로젝트 스킬** — `<프로젝트>/.claude/skills/`, `skills/`, `.agent/skills/`.
- **플러그인** — 프로젝트: `.claude/plugins/`, 사용자: Claude Code 플러그인 또는 `~/.claude/plugins/` + `installed_plugins.json`.
- 설치 목록은 **설정 → 플러그인**에서 켜고 끌 수 있습니다.

스킬은 **카탈로그 항목**입니다. 에이전트는 요약만 보고, 전문은 `load_skill`로 읽습니다. 내장 툴(`web_fetch`, `memory_search`, `run_checks` 등)은 스킬 설치 없이도 항상 도구 목록에 있습니다.

### 요구 사항

- macOS 10.12+, Windows 10/11, 또는 Linux (패키지 빌드)
- OpenAI 또는 Claude 호환 API 키 (BYOK)
- 소스 빌드 시 Node `^20.19.0 || >=22.12.0`

### 서비스 연동 (선택)

**설정 → 서비스 연동**에서 **Google** / **GitHub**를 연결합니다. 메일함·Drive 전용 UI는 없고 **채팅 내장 툴**로 데이터를 다룹니다. 토큰은 이 기기 `~/.pawn`에만 저장됩니다.

**Google** (읽기 전용): Drive, Gmail, Calendar, Tasks, Docs, Sheets, Slides.

**GitHub**: 저장소·이슈·PR(리뷰 팩 포함)·커밋·파일·검색, 선택적 쓰기(이슈/초안 이슈·코멘트·PR, ask 모드에서는 승인).

예: *“이번 주 캘린더”*, *“Alice 메일 요약”*, *“#12 PR 리뷰해줘”*, *“이 브랜치 PR 올려도 돼?”*.

공식 빌드 OAuth Client ID 주입: [.github/OAUTH_SECRETS.md](./.github/OAUTH_SECRETS.md). 개인정보 처리방침: [PRIVACY.md](./PRIVACY.md).

## 주요 기능

### 코어 에이전트 루프

- 도구 호출 루프 (턴당 최대 **50** 라운드; 동일 툴 호출 루프는 조기 중단).
- 도구 유형별 승인 다이얼로그 (MCP 포함).
- 큐 / 조향(Steering) 전송 모드.
- 도구 결과 기본 접힘 (Claude Code 스타일).
- **첨부**: 이미지(비전 모델 이미지 블록)·텍스트 문서, 대량 붙여넣기 칩, 이미지 라이트박스.
- 컨텍스트가 차면 트랜스크립트 압축 (SQLite에 캐시 안정 히스토리 유지).

### 내장 에이전트 툴 (플러그인 불필요)

별도 제품 UI가 아니라, 에이전트가 쓸 수 있는 **얇은 도구**입니다.

#### 파일 · 셸 · Git

| 툴 | 용도 |
|----|------|
| `read_file` / `write_file` / `edit_file` / `list_dir` / `delete_file` | 로컬 FS |
| `read_spreadsheet` | CSV/TSV/XLSX (행·열 상한) |
| `search_files` / `grep_search` | 경로 glob · 텍스트/정규식 |
| `codebase_search` | 심볼·정의 우선 로컬 검색 |
| `shell_exec` / `shell_poll` / `shell_kill` | 로컬 셸·백그라운드 작업 |
| `git_status` / `git_diff` / `git_log` | Git 조회 |
| `git_pr_ready` | 브랜치·상태·base 대비 커밋·diff·PR 체크리스트 |
| `run_checks` | typecheck/test/lint 자동 감지·실행 |
| `write_artifact` / `list_artifacts` | `<프로젝트>/artifacts/` 에 산출물 저장 |
| `terminal_list` / `terminal_read` | 패널 터미널 최근 출력 읽기 |
| `update_plan` | 멀티스텝 작업 체크리스트 |

#### 에이전트 훅 (라이프사이클)

알림·정책 게이트·외부 연동용 Claude/Codex 호환 훅. 소스는 **합집합 merge**, **명령/URL 중복 제거**(같은 스크립트 이중 실행 방지):

| 소스 | 경로 |
|------|------|
| Claude 유저 | `~/.claude/settings.json` → `hooks` |
| Claude 프로젝트 | `<프로젝트>/.claude/settings.json` → `hooks` |
| Pawn 유저 | `~/.pawn/hooks.json` |
| Pawn 프로젝트 | `<프로젝트>/.pawn/hooks.json` |

| 이벤트 | 시점 |
|--------|------|
| `SessionStart` | 빈 트랜스크립트의 첫 턴 |
| `UserPromptSubmit` | 사용자 메시지마다 (턴 차단 가능) |
| `PreToolUse` | 툴 실행 전 (YOLO에서도 deny 가능) |
| `PermissionRequest` | Ask 다이얼로그 전 (UI 없이 allow/deny) |
| `PostToolUse` | 툴 완료 후 (권고) |
| `Stop` | 턴 정상 종료 |

핸들러: `command`(stdin JSON) | `http`(POST JSON). matcher 별칭: `Bash`→`shell_exec`, `Write`/`Edit`→ write/edit. **deny 우선**. UI: **설정 → 에이전트 → 훅**. 옵션: `~/.pawn/hooks-settings.json`.

#### 장기 메모리 (자가 학습)

선호·프로젝트 사실·절차·결정·인물 메모 등 **내구성 있는 지식 카드**. 이 기기 `~/.pawn/memory.db`에만 저장(SQLite + FTS5 + 로컬 해시 임베딩 하이브리드 검색). 클라우드로 나가지 않으며, 저장 시 API 키·토큰·비밀번호는 마스킹되거나 거부됩니다.

| 도구 | 용도 |
|------|------|
| `memory_search` | 저장된 카드 하이브리드 검색 (전문 + 로컬 임베딩) |
| `memory_save` | 카드 저장 (에이전트 또는 사용자) |
| `memory_list` | 목록/필터 |
| `memory_update` / `memory_forget` | 수정·삭제 |

추가로:

- 턴 종료 후 **자동 캡처** (최근 메시지 휴리스틱 추출, 다국어 “기억해” 단서 포함).
- 관련 카드 **턴 주입** (preamble에 **untrusted** 배경 데이터로 표시 — 명령이 아님).
- **설정 → 에이전트 → 메모리**: on/off 하나, 내보내기·가져오기·전체 삭제, 그리고 내 메모리 목록(검색·고정·잊기). 켜 두면 자동 캡처·턴 주입은 알아서 동작.
- 스코프: **user**(전역) / **project**; 고정(pin) 카드는 회상 시 우선.

예: *“기억해: 이 모노레포에서는 항상 pnpm 써”* → 저장 → 이후 턴에 다시 설명하지 않아도 주입.

#### 공개 웹 (내장 리서치 엔진)

API 키 없음. **공개 콘텐츠만** — 로그인·페이월 우회가 아닙니다. [insane-search](https://github.com/fivetaku/insane-search) (MIT) 기반.

| 툴 | 용도 |
|----|------|
| `web_search` | 링크 검색 (DuckDuckGo HTML + HN + Wikipedia) |
| `web_fetch` | 적응형 페이지 읽기 (플랫폼 공개 API → 헤더/UA 그리드 → Jina) |
| `web_research` | 주제별 출처 발견 + 여러 페이지 fetch |

**브라우저 툴과의 구분:** 공개 페이지 **읽기**는 `web_*`, **클릭·폼·로그인 세션**은 `browser_*`. `web_fetch`가 `must_invoke_browser`를 주면 임베드 브라우저로 에스컬레이션합니다.

Phase 0 플랫폼 예: Reddit, X, YouTube, HN, Bluesky, Wikipedia, arXiv, 공개 GitHub, Stack Overflow, npm, PyPI 등. 본문은 **untrusted public web** 경계로 감싸 프롬프트 인젝션에 대비합니다.

Claude Code / `~/.agents` 에 insane-search **스킬**을 따로 깔아도, 전문은 `load_skill` 이후에만 로드됩니다. 기본은 항상 있는 내장 `web_fetch`를 쓰면 됩니다.

#### 브라우저 · 컴퓨터

- **브라우저**: 쿠키 세션이 유지되는 임베드 Chromium — 탐색·스냅샷·클릭·입력·텍스트·스크린샷, AI 커서 (`browser_*`).
- **컴퓨터 제어**: 스크린샷(비전)·클릭·타이핑·키 입력 (`computer_*`).
  - macOS: cliclick / osascript
  - Windows: PowerShell / .NET Forms
  - Linux: xdotool
  - High-DPI 좌표 보정

#### Google · GitHub (설정 → 서비스 연동)

| 영역 | 요약 |
|------|------|
| Google (읽기 전용) | whoami, Drive, Gmail, Calendar, Tasks, Docs, Sheets, Slides |
| GitHub (읽기) | 저장소·이슈·PR·**`github_review_pull`**(패치·CI·체크리스트 묶음)·커밋·파일·검색 |
| GitHub (쓰기) | 이슈 생성, **`github_draft_issue`**(구조화 초안, `create:true` 시 생성), 코멘트, PR 생성 |

결과는 채팅에만 표시됩니다.

#### 앱 제어 · 스킬

| 툴 | 용도 |
|----|------|
| `app_open_tab` / `app_close_tab` | 우측 패널 탭 |
| `app_set_model` / `app_set_permission_mode` / `app_set_reasoning` / `app_toggle_theme` | 세션 UI |
| `app_list_automations` / `app_create_automation` | 채팅에서 자동화 |
| `load_skill` | 카탈로그 스킬 전문 로드 |
| `install_skill` | git URL에서 스킬/플러그인 설치 |

### Model Context Protocol (MCP)

- `~/.claude.json`, 프로젝트 `.mcp.json`, `~/.pawn/mcp.json` 에서 stdio MCP 자동 탐색.
- 도구 목록 병합 및 서버 라우팅.
- **설정 → MCP**: 서버 추가/삭제, 상태·도구 수, 개별 on/off.
- id 충돌 시 프로젝트 스코프 우선, 프로젝트당 세션 유지.

### 프로바이더 및 스마트 라우팅

- OpenAI / Claude API 규격 및 커스텀 OpenAI 호환 엔드포인트.
- **스마트 모델 라우터**: 난이도 휴리스틱, 캐시 인지 라우팅, 실패 시 에스컬레이션, 프로바이더 쿨다운, 비전 폴백.

### 로컬 데이터 (`~/.pawn`)

지속 데이터는 모두 이 기기에만 둡니다.

| 경로 | 용도 |
|------|------|
| `~/.pawn/pawn.db` | 프로젝트·세션·메시지·트랜스크립트·사용량·루틴 |
| `~/.pawn/memory.db` | 장기 메모리 카드 (채팅 히스토리와 분리) |
| `~/.pawn/hooks.json` | Pawn 유저 라이프사이클 훅 (Claude 호환 스키마) |
| `~/.pawn/hooks-settings.json` | 훅 on/off · 소스 토글 |
| `~/.pawn/config.toml` | 앱 설정 (종료 확인 포함) |
| `~/.pawn/mcp.json` | Pawn 관리 MCP 서버 |
| `~/.pawn/reports/` | 자동화 산출물 |
| `~/.pawn/installers/` | `npx` 설치 패키지 캐시 |

- **SQLite** (`better-sqlite3`, WAL) — 앱 DB와 Memory 모두.
- **트랜스크립트**는 UI 메시지와 분리해 프로바이더 호출 시 프롬프트 캐시 prefix를 안정적으로 유지합니다.

### 우측 패널 — 터미널, 파일, Git, Diff, Artifacts, 브라우저

- **터미널**: xterm.js + node-pty (하단 터미널 토글). 에이전트 `terminal_read` 가능.
- **파일** · **Git** · **Diff** · **Artifacts** · **브라우저**.
- 컴포저 git 상태 칩 (브랜치·diff, 전환/이동).

### 자동화

- 간격/매일/매주 스케줄, 창이 없어도 헤드리스 실행.
- 템플릿, `~/.pawn/reports/` 결과물, JSON 내보내기/가져오기.
- macOS 메뉴바 / Windows 트레이.

### UI / UX

- ChatGPT 스타일 레이아웃, macOS 트래픽 라이트 헤더.
- 컴포저·컨트롤 다크 모드 대비 개선.
- **커맨드 팔레트** (`Cmd/Ctrl+K`), **단축키 설정**.
- **단계적 닫기** (`Cmd/Ctrl+W` / close-layer): 오버레이 → 패널 → 창 순으로 닫음.
- **종료 확인** (`Cmd/Ctrl+Q`) + “다시 묻지 않기” (설정 → 시스템에서 토글).
- 사이드바 핀/삭제, “열기” 에디터 런처 (25+ 프리셋).
- 라이트/다크, 리치 마크다운, 스트리밍, i18n (한/영/일/중).

### 확장성

- Claude Code 스킬, Codex `.agent/`, OpenAI Agents `~/.agents/`.
- GitHub URL 원클릭 설치 (`install_skill`).
- `CLAUDE.md` / `rules`.

### 보안

- 컨텍스트 격리 + contextBridge (`nodeIntegration: false`).
- CSP, 민감 작업 승인, 리서치 fetch SSRF 가드.
- Memory 시크릿 마스킹; 주입된 Memory/웹 본문은 **untrusted data**.
- 훅은 메인 프로세스에서만 실행; PreToolUse/PermissionRequest **deny**는 YOLO에서도 강제.
- 설정 가능 샌드박스.

## 기술 스택

- **Electron** · **React 19** · **TypeScript** · **Vite (electron-vite)** · **Zustand** · **i18next**
- **SQLite (better-sqlite3)** · **react-markdown** · **highlight.js**
- **@modelcontextprotocol/sdk** · **xterm.js** + **node-pty** · **exceljs**

## 개발 가이드

```bash
# 의존성 설치
npm install

# 개발 모드 (Electron + Vite HMR)
npm run dev

# 렌더러만 (브라우저 미리보기)
npm run dev:web

# 프로덕션 빌드
npm run build

# 타입 검사
npm run typecheck

# 단위 테스트
npm run test

# 통합 검증 (typecheck + test + build)
npm run check
```

## 패키징

```bash
npm run dist
npm run dist:mac    # .dmg
npm run dist:win    # .exe
npm run dist:linux  # .AppImage, .deb
npm run pack        # 설치 프로그램 없이 디렉터리만
```

결과물은 `release/` 에 생성됩니다.

## 프로젝트 구조

```
src/
├── main/              # Electron 메인 (IPC, DB, CSP, 윈도우)
│   ├── connections/   # Google/GitHub OAuth + API 툴
│   ├── memory/        # 장기 메모리 엔진 (SQLite FTS, embed, extract, store)
│   ├── hooks/         # 라이프사이클 훅 (Claude/Codex 호환 load + run)
│   ├── research/      # 공개 웹 엔진 (web_search / web_fetch / web_research)
│   ├── ipc/           # fs, shell, browser, terminal, mcp, memory, hooks, research, …
│   ├── quit.ts        # Cmd+Q 확인 + before-quit
│   ├── spreadsheet.ts
│   └── mcpManager.ts
├── preload/           # contextBridge
└── renderer/          # React
    └── src/
        ├── agent/     # 에이전트 루프, 툴 정의/실행, 라우터, MCP
        ├── components/# UI (채팅, 설정, Memory 패널, 우측 패널, …)
        ├── i18n/
        ├── stores/
        ├── styles/
        └── types/
```

## 라이선스

MIT — [LICENSE](./LICENSE). 선택 OAuth: [PRIVACY.md](./PRIVACY.md).

공개 웹 리서치 엔진은 [insane-search](https://github.com/fivetaku/insane-search) (MIT, © 2026 fivetaku)를 TypeScript로 이식·적용했습니다.
