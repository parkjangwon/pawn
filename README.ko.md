# Pawn

[English](./README.md) · [中文](./README.zh.md) · [日本語](./README.ja.md)

**보드 위의 내 말(piece).** 코딩·브라우징·자동화·기억을 대신 수행하는 데스크톱 AI 코딩 에이전트. API 키는 내 것, 데이터는 내 기기, 규칙은 내가 정한다.

Pawn은 또 하나의 클라우드 락인 IDE가 아닙니다. OpenAI·Claude 호환 API를 붙이고, 필요한 스킬만 설치하며, 장기 메모리와 토큰은 `~/.pawn`에 둡니다. 강제 하네스 없음. 원치 않는 제품 파이프라인 없음.

### 왜 “Pawn”인가?

체스에서 폰(pawn)은 **일을 하는 말**입니다. 앞으로 나가고, 라인을 지키며, 게임이 필요로 하는 것으로 승급합니다. Pawn은 데스크톱 위의 그 유닛입니다 — 화려하게 임대하는 왕좌가 아니라, **당신이 직접 움직이는** 로컬 우선 에이전트.

---

## 무엇을 할 수 있나

- **코드** — 파일·셸·git·심볼 검색·체크, 권한 있는 에이전트 루프
- **브라우저** — 내장 Chromium (`browser_*`)으로 실제 웹 UI·로그인 세션. **멀티 탭**: 에이전트·UI 패널·서브에이전트가 각자 탭을 갖고 (owner 격리) 내 화면을 방해하지 않고 병렬 브라우징
- **리서치** — 추가 키 없이 공개 웹 검색/읽기 (`web_search`, `web_fetch`, `web_research`) + **`research_report`**: 병렬 리서치 서브에이전트(각자 탭)가 자료를 수집·중복 제거해 출처 검증된 레포트 아티팩트로 종합
- **컴퓨터 사용** — 데스크톱 마우스·키보드·스크린샷·클립보드 (`computer_*`)
- **기억** — 로컬 장기 Memory (`~/.pawn/memory.db`)로 시간이 지날수록 개인화
- **훅** — Claude/Codex 호환 라이프사이클 훅 (Claude + Pawn 설정 merge·중복 제거)
- **연동** — 설정 → 서비스 연동으로 Google·GitHub(OAuth) 및 GitLab·AWS CodeCommit(PAT) 툴 (토큰은 로컬만)
- **확장** — MCP, Claude Code 스킬/플러그인, `CLAUDE.md` / `AGENTS.md`, 자동화, 트레이
- **서브에이전트** — 세션 내부 서브에이전트, 툴 정책·오케스트레이션, worktree 리뷰 후 적용, 병렬 브라우징용 전용 탭
- **멀티 루트** — 추가 프로젝트 루트와 실효 cwd; 패널·에이전트 툴이 루트를 인식
- **세션** — 지속 plan/thinking, 첨부 유지 편집·재생성, 복원, 시크릿 제외 백업보내기
- **사용량·예산** — 컨텍스트 미터, 지출 soft-cap, 사용량 패널
- **업데이트** — 설정/실행 시 GitHub Releases 확인 후 해당 플랫폼 설치 파일 다운로드·실행
- **라우팅** — 멀티 모델 자동 라우팅, 캐시 안정, DeepSeek/MiMo thinking + 비전 폴백
- **프로바이더 (BYOK)** — OpenAI, Anthropic, OpenRouter, DeepSeek, **OpenCode Go**, **Command Code**, **Xiaomi MiMo**, Gemini, xAI, Groq 등 키만 붙여 넣거나 커스텀 OpenAI/Claude 호환 base URL. 가능하면 OS `safeStorage`로 키 암호화 저장
- **모델 목록 동기화** — 설정 → 프로바이더 → **모델 동기화**로 `GET {baseUrl}/models` 카탈로그를 가져와 최신 유지 (프리셋 시드는 부트스트랩용)

UI: ChatGPT 스타일 레이아웃, 터미널/파일/git/diff/브라우저 패널, 라이트·다크. 언어: 영어·한국어·일본어·중국어.

### 최신 — v0.9.0

BYOK 키 암호화, 멀티 루트 마무리, 인앱 업데이트 다운로드, 시크릿 제외 백업, 브라우저 claim 격리, transcript-safe 편집/재생성, plan·thinking UI, 컨텍스트 미터·지출 한도, worktree 리뷰 적용, 서브에이전트 오케스트레이션, issue→PR 헬퍼, 자동화 편집, 웰컴 체크리스트, en/ko/ja/zh 패리티 확대.

### 개발 중 (다음)

- **멀티 탭 브라우저** — 브라우저 패널 탭 바, `browser_tab_new / list / switch / close` 도구, 팝업은 새 탭으로
- **서브에이전트 병렬 브라우징** — owner별 탭(`session:` / `subagent:` / UI), 보이는 페이지를 절대 방해하지 않는 parked 백그라운드 탭, 런 종료 시 자동 회수
- **`research_report`** — 플래너 → 병렬 리서치 워커 → 중복 제거 도시어 → 출처 검증 레포트 (아티팩트는 `<프로젝트>/artifacts/`, 프로젝트가 없으면 `~/Downloads/pawn-artifacts/`)
- **패널 라이프사이클** — 에이전트가 연 브라우저 패널은 작업이 모두 끝나면 자동 숨김 (페이지는 유지), 브라우저 탭이 0개가 되면 완전히 닫힘
- **안정성 하드닝** — 모든 fire-and-forget IPC 호출에 거부 처리 추가, 리서치 파이프라인 실패 시 처리 안 된 거부 대신 깔끔한 도구 오류 반환

---

## 프로바이더

Pawn은 벤더 키를 내장하지 않습니다. 본인 API 키(BYOK)를 사용합니다.

| 프리셋 | 설명 |
|--------|------|
| OpenAI, Anthropic, OpenRouter, Google Gemini, xAI, Groq, … | 표준 OpenAI/Claude 호환 엔드포인트 |
| DeepSeek | V4 Flash/Pro · 디스크 캐시 + thinking (`reasoning_content` 툴 루프 에코) |
| **OpenCode Go** | 오픈 코딩 모델 구독 게이트웨이 — [문서](https://opencode.ai/docs/ko/go/) · base `https://opencode.ai/zen/go/v1` |
| **Command Code** | 멀티 모델 Provider API — [문서](https://commandcode.ai/docs/provider) · base `https://api.commandcode.ai/provider/v1` |
| **Xiaomi MiMo** | OpenAI + Anthropic 경로 — [문서](https://mimo.mi.com/docs/en-US/quick-start/summary/first-api-call) · `https://api.xiaomimimo.com/v1` |

프로바이더 추가 후 **모델 동기화**(프리셋 추가 시 자동 시도)로 API 목록을 맞추세요. **Test**는 해당 프로바이더에 붙은 모델로 프로브합니다 (`gpt-4o-mini` 고정이 아님).

---

## 설치

**간편 설치 (권장):**

```bash
npx @parkjangwon/pawn
```

글로벌 CLI:

```bash
npm install -g @parkjangwon/pawn
pawn
```

**직접 다운로드:** [Releases](https://github.com/parkjangwon/pawn/releases/latest)

| 플랫폼 | 패키지 |
|--------|--------|
| macOS | `pawn-<version>-universal.dmg` (Apple Silicon + Intel). 첫 실행: 우클릭 → **열기** (미서명). |
| Windows | `pawn-<version>-x64-setup.exe` 또는 `pawn-<version>-arm64-setup.exe` |
| Linux | `pawn-<version>-x64.AppImage` / `.deb` (또는 `npm run dist:linux`) |

**요구 사항:** macOS 10.12+ / Windows 10+ / Linux · OpenAI 또는 Claude 호환 API 키 (BYOK)

실행 후: 설정에서 API 키 등록 → 프로젝트 폴더 열기 → 채팅.

---

## 에이전트를 위한 문서 (설정·유지보수)

사람은 이 페이지만 보면 됩니다. **설치·설정·유지보수를 맡길 코딩 에이전트**는 상세 가이드를 읽으세요:

| 언어 | 가이드 |
|------|--------|
| English | [docs/agent/GUIDE.md](./docs/agent/GUIDE.md) |
| 한국어 | [docs/agent/GUIDE.ko.md](./docs/agent/GUIDE.ko.md) |
| 中文 | [docs/agent/GUIDE.zh.md](./docs/agent/GUIDE.zh.md) |
| 日本語 | [docs/agent/GUIDE.ja.md](./docs/agent/GUIDE.ja.md) |

내장 툴 전체, Memory/훅/MCP 경로, `~/.pawn` 레이아웃, 컴퓨터 사용 OS 의존성, OAuth, 소스 빌드가 정리되어 있습니다.

**사용자 팁:** 이 저장소 URL을 에이전트에게 넘기고 “스킬 설치해줘”, “MCP 연결해줘”, “macOS 컴퓨터 사용 켜줘”처럼 요청하세요. 에이전트에게 `docs/agent/GUIDE.md`(또는 `GUIDE.ko.md`)를 읽게 하면 됩니다.

---

## 라이선스

MIT — [LICENSE](./LICENSE). OAuth 개인정보: [PRIVACY.md](./PRIVACY.md).

공개 웹 리서치는 [insane-search](https://github.com/fivetaku/insane-search) (MIT)를 기반으로 합니다.
