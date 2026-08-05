# Pawn

[English](./README.md) · [中文](./README.zh.md) · [日本語](./README.ja.md)

**보드 위의 내 말(piece).** 코딩·브라우징·자동화·기억을 대신 수행하는 데스크톱 AI 코딩 에이전트. API 키는 내 것, 데이터는 내 기기, 규칙은 내가 정한다.

Pawn은 또 하나의 클라우드 락인 IDE가 아닙니다. OpenAI·Claude 호환 API를 붙이고, 필요한 스킬만 설치하며, 장기 메모리와 토큰은 `~/.pawn`에 둡니다. 강제 하네스 없음. 원치 않는 제품 파이프라인 없음.

### 왜 “Pawn”인가?

체스에서 폰(pawn)은 **일을 하는 말**입니다. 앞으로 나가고, 라인을 지키며, 게임이 필요로 하는 것으로 승급합니다. Pawn은 데스크톱 위의 그 유닛입니다 — 화려하게 임대하는 왕좌가 아니라, **당신이 직접 움직이는** 로컬 우선 에이전트.

---

## 무엇을 할 수 있나

- **코드** — 파일·셸·git·심볼 검색·체크, 권한 있는 에이전트 루프
- **브라우저** — 내장 Chromium (`browser_*`)으로 실제 웹 UI·로그인 세션
- **리서치** — 추가 키 없이 공개 웹 검색/읽기 (`web_search`, `web_fetch`, `web_research`)
- **컴퓨터 사용** — 데스크톱 마우스·키보드·스크린샷·클립보드 (`computer_*`)
- **기억** — 로컬 장기 Memory (`~/.pawn/memory.db`)로 시간이 지날수록 개인화
- **훅** — Claude/Codex 호환 라이프사이클 훅 (Claude + Pawn 설정 merge·중복 제거)
- **연동** — 설정 → 서비스 연동으로 Google·GitHub 툴 (토큰은 로컬만)
- **확장** — MCP, Claude Code 스킬/플러그인, `CLAUDE.md` / `AGENTS.md`, 자동화, 트레이
- **라우팅** — 멀티 모델 자동 라우팅, 캐시 안정, DeepSeek thinking + 비전 폴백

UI: ChatGPT 스타일 레이아웃, 터미널/파일/git/diff/브라우저 패널, 라이트·다크. 언어: 영어·한국어·일본어·중국어.

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
| macOS | `Pawn-<version>-universal.dmg` (Apple Silicon + Intel). 첫 실행: 우클릭 → **열기** (미서명). |
| Windows | `Pawn-<version>-x64-setup.exe` 또는 `…-arm64-setup.exe` |
| Linux | `.AppImage` / `.deb` (또는 `npm run dist:linux`) |

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
