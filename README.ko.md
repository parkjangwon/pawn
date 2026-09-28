# Pawn

[English](./README.md) · [中文](./README.zh.md) · [日本語](./README.ja.md)

**보드 위의 내 말.** 코딩하고, 브라우저를 보고, 컴퓨터를 직접 다루는 데스크톱 AI 에이전트. API 키는 내 것, 기기도 내 것.

Pawn은 Electron 앱입니다. OpenAI·Claude 호환 API를 붙입니다. 세션, 기억, 훅은 `~/.pawn`에 둡니다. 스킬은 필요한 것만 설치합니다.

## 하는 일

**저장소, 브라우저, 데스크톱을 한 에이전트가 봅니다.** 파일을 고치고, 셸과 git을 돌리고, 언어 서버를 따라가며, 디버거를 붙일 수 있습니다 (Node, Python, Go, C/C++/Rust). 내장 브라우저는 쿠키를 따로 가지므로 로그인된 사이트를 다룰 수 있습니다. Mac에서는 네이티브 헬퍼가 접근성 트리로 다른 앱을 조작합니다. Windows와 Linux는 마우스, 키보드, 스크린샷입니다.

**한 번 보여 주면 스킬이 됩니다.** macOS에서 Pawn 브라우저나 다른 Mac 앱의 작업을 녹화하면 `SKILL.md`가 나옵니다. 다른 입력값으로 다시 실행하거나 예약할 수 있습니다. 비밀번호, 인증 코드, 카드 번호, macOS 보안 입력칸은 기록하지 않습니다.

**출처가 있는 조사.** 공개 웹은 추가 API 키 없이 검색하고 읽습니다. 더 깊은 조사는 병렬 리서치 에이전트가 출처를 대조한 보고서를 프로젝트에 씁니다.

**이미 내는 구독으로 씁니다.** 설정에서 ChatGPT(Plus, Pro, Team, Enterprise), Claude(Pro, Max, Team, Enterprise), xAI(SuperGrok 또는 X Premium+), Antigravity(거기에 쓰는 Google 계정)로 로그인할 수 있습니다. 사용량은 그 구독에서 빠집니다. 해당 프리셋의 API 키도 그대로 쓸 수 있고, 로그아웃 중에는 그 키가 동작합니다. 갱신 토큰은 `~/.pawn`에 암호화되어 있습니다.

**이 컴퓨터 안에 있습니다.** 키는 OS 키체인이 있으면 그쪽으로 저장합니다. 장기 기억은 로컬 데이터베이스입니다. Claude Code 스킬, 플러그인, `CLAUDE.md`, 훅, MCP 설정을 있는 자리에서 읽습니다. Google, GitHub, GitLab, AWS CodeCommit은 설정에서 연결합니다.

**이어서 일합니다.** 자동 라우팅이 모델을 고르고, 프롬프트 캐시가 살아있는 동안 그 모델을 유지합니다. 긴 작업은 메모와 체크포인트를 남깁니다. 서브에이전트가 일을 나눠 갖고, git worktree에서 할 수도 있습니다. 같은 에이전트를 창 없이 `pawn-headless`로 돌릴 수 있습니다.

## 설치

```bash
npx @parkjangwon/pawn
```

또는 런처를 전역 설치합니다.

```bash
npm install -g @parkjangwon/pawn
pawn
```

**직접 받기:** [Releases](https://github.com/parkjangwon/pawn/releases/latest)

| 플랫폼 | 패키지 |
|--------|--------|
| macOS | `pawn-<version>-universal.dmg` (Apple Silicon + Intel). 처음 실행은 우클릭 → **열기**. |
| Windows | `pawn-<version>-x64-setup.exe` 또는 `pawn-<version>-arm64-setup.exe` |
| Linux | `pawn-<version>-x64` / `arm64` `.AppImage`와 `.deb` |

macOS 10.12+ / Windows 10+ / Linux. API 키는 직접 가져옵니다.

실행 후 설정에서 키를 넣고 프로젝트 폴더를 엽니다.

## 에이전트에게

여기까지가 사람용입니다. Pawn을 설치·설정·수정하는 코딩 에이전트는 가이드를 읽습니다.

| 언어 | 가이드 |
|------|--------|
| English | [docs/agent/GUIDE.md](./docs/agent/GUIDE.md) |
| 한국어 | [docs/agent/GUIDE.ko.md](./docs/agent/GUIDE.ko.md) |
| 中文 | [docs/agent/GUIDE.zh.md](./docs/agent/GUIDE.zh.md) |
| 日本語 | [docs/agent/GUIDE.ja.md](./docs/agent/GUIDE.ja.md) |

## 라이선스

MIT — [LICENSE](./LICENSE). OAuth 개인정보: [PRIVACY.md](./PRIVACY.md).

공개 웹 리서치는 [insane-search](https://github.com/fivetaku/insane-search) (MIT)를 옮긴 것입니다.
