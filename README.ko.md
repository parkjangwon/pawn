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
- **브라우저 제어 (Browser Use)**: 특정 URL을 열고 웹 브라우저 조작을 자동화합니다.
- 민감한 작업에 대한 세분화된 사용자 승인 권한 시스템.
- 큐(Queue) 전송 및 조향(Steering) 전송 모드 제공.

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

### UI / UX
- ChatGPT 스타일의 레이아웃 (사이드바 + 대화 창).
- 라이트 모드 및 다크 모드 지원 (설정 > 외관에서 변경 가능).
- 반응형 웹 디자인: 데스크톱, 태블릿, 모바일 화면 크기에 맞게 자동 최적화.
- 구문 강조(Syntax Highlighting) 및 코드 블록 복사 기능을 포함한 리치 마크다운 렌더링.
- 스트리밍 응답 출력을 돕는 커서 애니메이션 효과.
- 새로운 메시지 수신 시 하단 자동 스크롤.
- 다국어 번역(i18n): 한국어, 영어, 일본어, 중국어 지원.

### 확장성 (Extensibility)
- Claude Code 스킬 포맷 지원 (`.claude/skills/*/SKILL.md`).
- Codex 호환 `.agent/` 디렉토리 지원.
- OpenAI Agents 사용자 컨텍스트 지원 (`~/.agents/AGENTS.md`, `~/.agents/skills/`).
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
├── preload/           # 프리로드 스크립트 (보안 API 노출용 컨텍스트 브릿지)
└── renderer/          # React 애플리케이션
    └── src/
        ├── agent/     # 에이전트 루프, 도구(Tools), 스마트 라우터, 트랜스크립트
        ├── components/# UI 화면 구성 컴포넌트
        ├── i18n/      # 다국어 번역 파일 리소스 (en, ko, ja, zh)
        ├── stores/    # Zustand 전역 상태 스토어
        ├── styles/    # 글로벌 CSS 및 테마 스타일 시트
        └── types/     # 공통 TypeScript 타입 정의 파일
```

## 라이선스

MIT
