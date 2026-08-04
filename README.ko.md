# Pawn

[English Version](./README.md)

AI 코딩 에이전트 GUI — 코딩, 웹 서핑, 컴퓨터 자동화.

Cursor의 Auto 모드, ChatGPT의 UI, OpenCode의 BYOK, 그리고 Claude Desktop의 브라우저 사용 기능을 하나로 결합한 데스크톱 애플리케이션입니다. 종속성이나 제약 없이 원하는 API 키를 등록하고, 플러그인을 설치하며, 자신만의 에이전트를 빌드할 수 있습니다.

## 철학

- **No harness (제약 없는 환경)** — 순수한 캔버스를 제공합니다. 사용자는 필요한 스킬과 플러그인만 선택하여 설치할 수 있습니다.
- **BYOK (개인 키 제공)** — OpenAI 또는 Claude 호환 규격의 모든 API 엔드포인트를 자유롭게 등록하여 사용합니다.
- **Auto mode (자동 모드)** — 작업 난이도 및 프롬프트 캐시 최적화 알고리즘에 기반한 지능형 멀티 모델 라우팅을 지원합니다.
- **Open source (오픈 소스)** — MIT 라이선스 하에 배포되며 완전한 커스터마이징이 가능합니다.
- **Claude Code 호환** — 프로젝트 내의 `CLAUDE.md`, `AGENTS.md`, `.claude/skills/`, `.claude/rules/`, `.agent/`, 및 `~/.agents/` 디렉토리를 로드하고 인식합니다.
- **MCP 네이티브** — Claude Code, Cursor, 또는 Pawn에서 직접 등록한 Model Context Protocol 서버를 자동으로 탐색·연결하여, 해당 서버의 도구를 에이전트가 곧바로 사용할 수 있습니다.

## 설치

[릴리스 페이지](https://github.com/parkjangwon/pawn/releases/latest)에서 사용 중인 플랫폼에 맞는 최신 버전을 다운로드하거나, 터미널에서 한 줄로 실행할 수 있습니다.

### 간편 설치 (권장)

```bash
npx @parkjangwon/pawn
```

현재 OS에 맞는 빌드를 다운로드하여 설치 파일을 자동으로 실행합니다. 설치 파일은 `~/.pawn/installers/`에 캐싱되며 이후 실행 시 재사용됩니다. 명령어를 글로벌로 설치하려면:

```bash
npm install -g @parkjangwon/pawn
pawn
```

### 직접 다운로드

- **macOS** — `Pawn-<version>-universal.dmg` (Apple Silicon + Intel). `.dmg`를 열어 **Pawn**을 응용 프로그램으로 드래그하세요.
  - 첫 실행: 우클릭 → **열기**를 선택한 뒤 Gatekeeper 대화상자에서 승인하세요 (서명되지 않은 빌드입니다).
- **Windows** — `Pawn-<version>-x64-setup.exe` (Intel/AMD) 또는 `Pawn-<version>-arm64-setup.exe` (ARM). 파일을 더블클릭하여 설치하세요.

### 스킬 & 플러그인 설치

- **Pawn에게 맡기기** — GitHub URL을 붙여넣고 "이 스킬 설치해줘"라고 하면(`install_skill` 툴) 리포를 clone해 레이아웃(`plugin.json`, `skills/`, 루트 `SKILL.md`)을 자동 감지한 뒤 표준 경로에 설치합니다.
- **사용자 전역 스킬** — `<이름>/SKILL.md` 폴더를 `~/.agents/skills/` 또는 `~/.claude/skills/`에 복사합니다.
- **프로젝트 스킬** — `<프로젝트>/.claude/skills/`, `<프로젝트>/skills/`, `<프로젝트>/.agent/skills/` 중 원하는 곳에 복사합니다.
- **플러그인** — 프로젝트 전용은 `<프로젝트>/.claude/plugins/`, 사용자 전역은 Claude Code 플러그인 설치(또는 `~/.claude/plugins/` + `installed_plugins.json` 항목)로 설치합니다.
- 설치된 스킬은 **설정 → 플러그인**에서 확인하고 켜고 끌 수 있습니다.

### 요구 사항

- macOS 10.12+ 또는 Windows 10/11
- OpenAI 또는 Claude 호환 API 키 (BYOK)

## 주요 기능

### 코어 에이전트 및 도구 (Tools)
- 도구 호출 에이전트 루프 지원 (사용자 턴당 최대 25회 연속 호출).
- **파일 시스템**: 로컬 파일 읽기, 쓰기, 수정, 목록 조회, 삭제를 안전하게 수행합니다.
- **쉘 실행**: 로컬 CLI 명령어 실행 (백그라운드 태스크 및 표준 샌드박스 모드 완벽 지원).
- **컴퓨터 제어 (Computer Use)**: 종속성 없는 크로스 플랫폼 자동화:
  - **멀티모달 비주얼 인식**: 스크린샷을 Claude 및 OpenAI API 규격의 이미지 블록으로 변환하여 모델에 전송합니다.
  - **macOS 제어**: `cliclick` 조작을 기본으로 하며, 미설치 환경 대비 AppleScript(`osascript`)를 통한 텍스트 타이핑 및 단축키 폴백(Fallback)을 지원합니다.
  - **Windows 제어**: 외부 C++ 컴파일 모듈 설치 없이 PowerShell 및 `.NET Forms SendKeys`를 이용해 구동합니다.
  - **Linux 제어**: `xdotool` 연동을 지원합니다.
  - **고해상도(High-DPI) 보정**: 윈도우 스케일 팩터를 반영하여 클릭 정밀도를 보정합니다.
- **브라우저 제어 (Browser Use)**: 자체 쿠키 세션이 유지되는 실제 임베드 Chromium 브라우저를 사용합니다 — 접근성(accessibility) 스타일의 요소 스냅샷 기반으로 탐색/클릭/입력/텍스트 읽기/스크린샷을 수행하므로 깨지기 쉬운 CSS 셀렉터가 필요 없고, 화면에 보이는 AI 커서로 동작을 직접 지켜볼 수 있습니다.
- **첨부 (Attachments)**: 이미지(비전 모델에 실제 이미지 블록으로 전송)와 텍스트 문서를 첨부할 수 있고, 대량 텍스트를 붙여넣으면 제거 가능한 칩으로 변환됩니다.
- 민감한 작업에 대한 세분화된 사용자 승인 권한 시스템 (MCP 도구 포함, 도구 유형별로 세분화).
- 큐(Queue) 전송 및 조향(Steering) 전송 모드 제공.
- 도구 호출 결과는 Claude Code 스타일로 기본 접힘(collapsed) 처리되어 대화창이 항상 깔끔합니다.

### Model Context Protocol (MCP)
- `~/.claude.json`(Claude Code), 프로젝트의 `.mcp.json`, Pawn 자체 설정인 `~/.pawn/mcp.json`에서 stdio 방식 MCP 서버를 자동으로 탐색합니다 — 다른 도구용으로 이미 설정해 둔 서버를 다시 설정할 필요가 없습니다.
- 탐색된 도구는 에이전트의 도구 목록에 자동으로 병합되고, 호출 시 알맞은 서버로 라우팅됩니다.
- **설정 → MCP**: UI에서 직접 Pawn 관리 서버를 추가/삭제(id, command, args, env)하고, 서버별 연결 상태와 도구 개수를 실시간으로 확인하며, 서버를 개별적으로 켜고 끌 수 있습니다.
- id가 충돌하면 프로젝트 스코프 서버가 사용자 스코프 서버보다 우선하며, 각 서버는 프로젝트당 한 번만 실행되어 앱 세션 동안 유지됩니다.

### 프로바이더 및 스마트 라우팅
- OpenAI API 규격(GPT-4o, o1 등) 및 Claude API 규격(Claude 3.5 Sonnet 등)을 기본 지원합니다.
- 커스텀 엔드포인트 연동 기능 (모든 OpenAI 호환 API 연동 가능).
- API Key 인증을 제공합니다.
- **스마트 모델 라우터**:
  - **난이도 판단(Complexity Heuristics)**: 입력 크기, 키워드, 지시 사항 등을 바탕으로 작업의 난이도(`simple` | `medium` | `complex`)를 로컬에서 자동으로 판별합니다.
  - **캐시 인지 라우팅(Cache-Aware Routing)**: 모델을 변경할 때 발생하는 캐시 작성 비용과 토큰당 절감액을 비교 계산하여, 프롬프트 캐싱(Prompt Caching) 효율을 극대화합니다.
  - **자동 에스컬레이션(Automatic Escalation)**: 연속적인 도구 실행 실패나 모델의 빈(empty) 응답이 감지되면 자동으로 더 고성능 등급의 모델로 티어를 상향합니다.
  - **장애 대응 및 쿨다운(Failover & Cooldown)**: 응답에 실패한 프로바이더에 일시적인 쿨다운(5초~120초)을 적용하여 에이전트의 중단 없는 반응성을 보장합니다.

### 로컬 데이터베이스 및 영속성
- WAL 저널 모드가 활성화된 **SQLite** (`better-sqlite3`) 기반으로 가볍고 강력한 로컬 스토리지를 제공합니다.
- **주요 데이터베이스 스키마**:
  - `projects` & `sessions`: 멀티 프로젝트 작업 공간 지원.
  - `messages`: 대화 내역 시각화용 데이터.
  - `transcripts`: 프로바이더 중립적인 대화 히스토리 캐시로, API 프롬프트 캐시 적중률 최적화에 기여.
  - `usage`: 입력/출력 토큰 및 캐시 읽기/쓰기 토큰의 상세 정보와 예측 비용 추적.
  - `routines`: 주기적으로 백그라운드에서 자동 실행되는 스케줄 기반 루틴 저장.

### 우측 패널 — 터미널, 파일, Git & Diff
- **터미널**: 프로젝트별 실제 셸(xterm.js + `node-pty`)을 채팅 옆에 나란히 사용할 수 있습니다.
- **파일**: Pawn을 벗어나지 않고 프로젝트 트리를 탐색하며 내장 에디터로 파일을 열고 수정할 수 있습니다.
- **Git**: 현재 프로젝트의 브랜치·상태·로그를 확인합니다.
- **Diff**: 변경된 모든 파일을 한 곳에서 검토한 뒤 무엇을 유지할지 결정할 수 있습니다.
- **브라우저**: 에이전트가 직접 조작하는 것과 동일한 임베드 브라우저를 지켜보거나 직접 넘겨받아 조작할 수 있습니다.
- 컴포저 바의 실시간 git 상태 칩으로 현재 브랜치와 diff 통계를 한눈에 확인하고, 팝오버에서 브랜치를 전환하거나 Git/Diff 탭으로 바로 이동할 수 있습니다.

### 자동화 (Automation)
- 간격/매일/매주 스케줄 기반 반복 루틴. 모든 창이 닫혀 있어도 헤드리스로 실행됩니다.
- **템플릿**: 일일 리포트, 웹/가격 모니터, RSS 다이제스트, 이슈 트리아지, 체인지로그, 리포 점검 — 클릭 한 번으로 생성.
- **결과물**: 완료된 루틴은 `~/.pawn/reports/<이름>/`에 마크다운 리포트로 저장되고, 완료 알림에 경로가 포함됩니다.
- **공유**: 자동화 설정을 JSON 파일로 내보내기/가져오기할 수 있습니다.
- **메뉴바/트레이**: Pawn 로고 아이콘으로 macOS 메뉴바·Windows 시스템 트레이에 표시. 좌/우클릭 모두 다국어 메뉴(표시 여부, 열기, 종료)가 열립니다.

### UI / UX
- ChatGPT 스타일의 레이아웃 (사이드바 + 대화 창), macOS 트래픽 라이트를 고려한 네이티브 헤더 — 사이드바 토글 버튼이 창 컨트롤 버튼 옆에 위치하고, 헤더 어디를 더블클릭해도 창 최대화/복원이 동작합니다.
- ChatGPT 스타일 컴포저 카드: 정렬된 툴바, 첨부 버튼, 제거 가능한 첨부 칩.
- **커맨드 팔레트** (`Cmd/Ctrl+K`)로 빠른 이동과 실행이 가능합니다.
- **커스터마이즈 가능한 키보드 단축키** (설정 → 단축키) — 커맨드 팔레트를 포함한 모든 바인딩을 재지정하거나 초기화할 수 있습니다.
- **사이드바 세션 관리**: Pinned/Recent 목록에서 세션을 고정하거나, 세션·프로젝트를 바로 삭제할 수 있으며, 삭제 시 진행 중이던 스트림도 함께 정리됩니다.
- **"열기" 실행기**: 25개 이상의 프리셋(VS Code 계열, Cursor, Windsurf, Trae, Zed, Nova, JetBrains 전 제품군, Sublime, BBEdit, Xcode, Android Studio 등)에서 설치된 에디터를 감지하고 각 앱의 실제 아이콘을 메뉴에 표시합니다.
- 라이트 모드 및 다크 모드 지원 (설정 > 외관에서 변경 가능).
- 반응형 웹 디자인: 데스크톱, 태블릿, 모바일 화면 크기에 맞게 자동 최적화.
- 구문 강조(Syntax Highlighting) 및 코드 블록 복사 기능을 포함한 리치 마크다운 렌더링.
- 스트리밍 응답 출력을 돕는 커서 애니메이션 효과.
- 새로운 메시지 수신 시 하단 자동 스크롤.
- 우측 하단에 앱 버전 표시.
- 다국어 번역(i18n): 한국어, 영어, 일본어, 중국어 지원.

### 확장성 (Extensibility)
- Claude Code 스킬 포맷 지원 (`.claude/skills/*/SKILL.md`).
- Codex 호환 `.agent/` 디렉토리 지원.
- OpenAI Agents 사용자 컨텍스트 지원 (`~/.agents/AGENTS.md`, `~/.agents/skills/`).
- 원클릭 설치: GitHub URL을 붙여넣고 설치를 요청하면 리포를 clone해 레이아웃을 감지하고 표준 경로(`~/.agents/skills` / `~/.claude/plugins`)에 설치합니다.
- 프로젝트 전체 맥락을 잡기 위한 `CLAUDE.md` / `CLAUDE.local.md` 파싱.
- 프로젝트별 커스텀 규칙 적용을 위한 `.claude/rules/*.md` 연동.

### 보안 (Security)
- 컨텍스트 격리(Context Isolation) 및 contextBridge 구현 (렌더러 내 `nodeIntegration` 비활성화).
- 엄격한 콘텐츠 보안 정책(CSP) 헤더 적용.
- 민감한 로컬 작업 실행 시 대화식 권한 요청 팝업 표출.
- 설정 가능한 샌드박스 실행 모드 지원.

## 기술 스택

- **Electron** — 데스크톱 앱 쉘
- **React 19** — UI 프레임워크
- **TypeScript** — 타입 안정성 확보
- **Vite** (via electron-vite) — 빌드 도구
- **Zustand** — 영속성이 지원되는 상태 관리
- **i18next** — 다국어 라이브러리
- **SQLite (better-sqlite3)** — 로컬 데이터베이스
- **react-markdown** + **rehype-highlight** — 마크다운 렌더링
- **highlight.js** — 소스 코드 구문 강조
- **@modelcontextprotocol/sdk** — MCP 클라이언트 (stdio 트랜스포트)
- **xterm.js** + **node-pty** — 내장 터미널

## 개발 가이드

```bash
# 의존성 패키지 설치
npm install

# 개발 모드 실행 (Electron + Vite HMR 적용)
npm run dev

# 렌더러 단독 개발 실행 (브라우저 미리보기, Electron 없음)
npm run dev:web

# 프로덕션 빌드
npm run build

# 타입 검사
npm run typecheck

# 통합 검증 (타입 검사 + 빌드 테스트)
npm run check
```

## 패키징 및 배포 빌드

```bash
# 현재 OS 플랫폼에 최적화된 패키징 파일 빌드
npm run dist

# 특정 플랫폼 지정 빌드
npm run dist:mac    # macOS (.dmg)
npm run dist:win    # Windows (.exe NSIS 설치 파일)
npm run dist:linux  # Linux (.AppImage, .deb)

# 단순 빌드 디렉토리 추출 (설치 프로그램 제외)
npm run pack
```

결과물은 프로젝트 루트의 `release/` 폴더에 생성됩니다.

## 프로젝트 구조

```
src/
├── main/              # Electron 메인 프로세스 (IPC 통신, DB 제어, CSP 설정, 윈도우 생성)
│   ├── ipc/           # IPC 핸들러: fs, shell, browser, computer, terminal, mcp, routine 등
│   └── mcpManager.ts  # MCP 서버 탐색, 라이프사이클, 도구 호출
├── preload/           # 프리로드 스크립트 (보안 API 노출용 컨텍스트 브릿지)
└── renderer/          # React 애플리케이션
    └── src/
        ├── agent/     # 에이전트 루프, 도구(Tools), 스마트 라우터, 트랜스크립트, MCP 도구 브릿지
        ├── components/# UI 화면 구성 컴포넌트 (채팅, 우측 패널, 설정, 사이드바 등)
        ├── i18n/      # 다국어 번역 파일 리소스 (en, ko, ja, zh)
        ├── stores/    # Zustand 전역 상태 스토어 (app, chat, provider, theme, permission, mcp, keybindings 등)
        ├── styles/    # 글로벌 CSS 및 테마 스타일 시트
        └── types/     # 공통 TypeScript 타입 정의 파일
```

## 라이선스

MIT
