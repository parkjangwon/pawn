# Pawn

[English](./README.md) · [中文](./README.zh.md) · [日本語](./README.ja.md)

**보드 위의 내 말(piece).** 코딩·브라우징·자동화·기억을 대신 수행하는 데스크톱 AI 코딩 에이전트. API 키는 내 것, 데이터는 내 기기, 규칙은 내가 정한다.

Pawn은 또 하나의 클라우드 락인 IDE가 아닙니다. OpenAI·Claude 호환 API를 붙이고, 필요한 스킬만 설치하며, 장기 메모리와 토큰은 `~/.pawn`에 둡니다. 강제 하네스 없음. 원치 않는 제품 파이프라인 없음.

### 왜 “Pawn”인가?

체스에서 폰(pawn)은 **일을 하는 말**입니다. 앞으로 나가고, 라인을 지키며, 게임이 필요로 하는 것으로 승급합니다. Pawn은 데스크톱 위의 그 유닛입니다 — 화려하게 임대하는 왕좌가 아니라, **당신이 직접 움직이는** 로컬 우선 에이전트.

---

## 무엇을 할 수 있나

- **코드** — 파일·셸·git·심볼 검색·체크, 권한 있는 에이전트 루프
- **에이전트 피지컬** — 모델 네이티브 도구(Claude 텍스트 에디터·지속형 bash, GPT `apply_patch`), 모델이 응답을 스트리밍하는 동안 먼저 시작되는 도구 실행, 실제 디버거(Node·Python·Go·C/C++/Rust), LSP 이름 변경·빠른 수정·호출 계층, 로컬 의미 기반 코드 검색, 영향받는 테스트 선별, 개발 서버·브라우저 런타임 오류 인지, 장시간 작업 지구력(출력 오프로딩·컨텍스트 정리·작업 메모·체크포인트), 다른 모델의 의견을 포함한 막힘 회복 단계, 학습된 저장소 프로필과 사용자 교정 학습
- **브라우저** — 내장 Chromium (`browser_*`)으로 실제 웹 UI·로그인 세션. **멀티 탭**: 에이전트·UI 패널·서브에이전트가 각자 탭을 갖고 (owner 격리) 내 화면을 방해하지 않고 병렬 브라우징
- **리서치** — 추가 키 없이 공개 웹 검색/읽기 (`web_search`, `web_fetch`, `web_research`) + **`research_report`**: 병렬 리서치 서브에이전트(각자 탭)가 자료를 수집·중복 제거해 출처 검증된 레포트 아티팩트로 종합
- **컴퓨터 사용** — Codex / Claude 컴퓨터 사용처럼 Mac 앱을 직접 조작: 네이티브 헬퍼로 접근성 트리 요소 조작, 앱·창·메뉴 제어, 고해상도 스크린샷·확대, 온디바이스 OCR, 한글 IME 안전 입력, 멀티 모니터, Claude 네이티브 컴퓨터 도구; Esc 두 번으로 중지 (`computer_*`; Windows/Linux는 기본 마우스·키보드)
- **녹화 & 재생** — Pawn 브라우저나 Mac 앱에서 작업을 한 번 보여 주면, 에이전트가 새 입력값으로 또는 예약 실행으로 다시 할 수 있는 스킬을 만들어 줍니다 (macOS)
- **결정 모델** — 선택 사항. 호스팅 TypeSafe Jev 또는 로컬 Ollaya로 예/아니요·하나 고르기·점수를 보정된 확률로 빠르게 판단: `decide` 도구, 셸 명령 위험도 확인, 자동 라우팅 보조
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

### 최신 — v0.15.1

**UI 다듬기 + 쉬운 Computer Use 설정**
- **더 차분하고 세련된 UI** — Pretendard 글꼴, 일관된 글자·간격·모서리 크기, 대비를 높인 중성 톤(zinc) 라이트 테마를 적용했습니다. 대문자 라벨, 강조 줄, 그라데이션과 빛 번짐은 없앴고, 입력칸은 포커스 때 빛나지 않고 테두리만 또렷해집니다
- **사용량 예산** — 세션·일일 비용 한도 입력이 숫자가 정렬된 `$` 입력칸으로 바뀌었습니다
- **한 번에 끝나는 Computer Use 설정** — 설정 → Computer Use 버튼이 헬퍼가 없으면 준비하고(개발 빌드), 손쉬운 사용·화면 기록 권한을 요청하고, 아직 켜야 할 시스템 설정 화면을 바로 엽니다. 한국어 UI는 "Computer Use", "LSP"로 표기합니다

### v0.15.0

**녹화 & 재생 + 결정 모델**
- **녹화 & 재생 (macOS)** — 워크플로를 한 번 보여 주면 재사용할 수 있는 스킬이 됩니다. 입력창의 녹화 버튼(또는 `/record`)을 누르고 Pawn 브라우저나 Mac 앱에서 작업한 뒤 멈추면(Esc 두 번도 가능) Pawn이 `SKILL.md`를 씁니다. 실행마다 바뀌는 입력값, 좌표가 아닌 화면 라벨 기준 단계, 확인 절차, 제출 전 확인 규칙이 들어갑니다. `~/.agents/skills`에 저장하고, 새 입력값으로 다시 실행(`/스킬이름`)하거나, 채팅으로 다듬거나, 자동화로 예약할 수 있습니다
- **개인정보 보호** — 비밀번호, 인증 코드, 카드 번호 칸, macOS 보안 입력칸은 기록하지 않고, Pawn 자신의 창과 에이전트의 입력은 무시하며, 녹화 중에는 화면에 빨간 표시가 뜹니다. 원본 녹화는 메모리에만 있고 스킬을 작성하면 사라집니다
- **결정 모델 (선택)** — 설정 → 결정 모델에서 채팅 모델 옆에 빠른 판단 모델("System One")을 붙입니다. **TypeSafe Jev**(호스팅, 공식 SDK) 또는 **Ollaya**(Laya, Winnow 등 공개 모델을 내 Mac에서 실행) 중에서 고릅니다. 에이전트는 선별·순위·확인에 쓰는 `decide` 도구를 얻고, 묻지 않고 실행될 셸 명령이 파괴적이거나 데이터를 밖으로 보낼 것 같으면 다시 확인을 요청하며, 자동 라우팅은 요청 난이도 판단에 쓸 수 있습니다. 모델이 느리거나 꺼져 있으면 모두 원래대로 동작합니다
- **그 외** — `save_skill` 도구, 메뉴 막대 "워크플로 녹화…", 네이티브 헬퍼 1.1.0

이전 릴리스 노트: [GitHub Releases](https://github.com/parkjangwon/pawn/releases).

---

## 프로바이더

Pawn은 벤더 키를 내장하지 않습니다. 본인 API 키(BYOK)를 사용합니다.

| 프리셋 | 설명 |
|--------|------|
| OpenAI, Anthropic, OpenRouter, Google Gemini, xAI, Groq, … | 표준 OpenAI/Claude 호환 엔드포인트 |
| **Kiro** | AWS Builder ID / IAM Identity Center 로그인, Kiro API 키(`ksk_…`), 또는 Kiro CLI / IDE 로그인(읽기 전용) · 모델 목록 실시간 동기화(Claude, GPT-5.6, 오픈 모델) · 설정에서 크레딧 확인. 비공식 프로토콜 연동이라 본인 책임하에 사용 |
| DeepSeek | V4 Flash/Pro · 디스크 캐시 + thinking (`reasoning_content` 툴 루프 에코) |
| **OpenCode Go** | 오픈 코딩 모델 구독 게이트웨이 — [문서](https://opencode.ai/docs/ko/go/) · base `https://opencode.ai/zen/go/v1` |
| **Command Code** | 멀티 모델 Provider API — [문서](https://commandcode.ai/docs/provider) · base `https://api.commandcode.ai/provider/v1` |
| **Xiaomi MiMo** | OpenAI + Anthropic 경로 — [문서](https://mimo.mi.com/docs/en-US/quick-start/summary/first-api-call) · `https://api.xiaomimimo.com/v1` |

프로바이더 추가 후 **모델 동기화**(프리셋 추가 시 자동 시도)로 API 목록을 맞추세요. **Test**는 해당 프로바이더에 붙은 모델로 프로브합니다 (`gpt-4o-mini` 고정이 아님).

### 결정 모델 (선택)

| 프로바이더 | 설명 |
|------------|------|
| **TypeSafe** (Jev) | 호스팅, 공식. [TypeSafe 콘솔](https://console.typesafe.ai)에서 받은 API 키 사용 · 공식 `@typesafe-ai/sdk`로 호출 · 요금은 TypeSafe가 입력 토큰 기준으로 청구 |
| **Ollaya** | 공개 결정 모델(Laya, Winnow, decider 등)을 내 Mac의 `http://localhost:11435`에서 실행 — [다운로드](https://ollaya.dev/download) 후 `ollaya pull laya`. 키 불필요, 데이터가 밖으로 나가지 않음 |
| 직접 입력 | TypeSafe 호환 서버(`/v1/systemone`)라면 무엇이든 |

키는 `~/.pawn/decision.json`에 암호화해 저장하고, 모든 요청에서 비밀 값을 가립니다.

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
