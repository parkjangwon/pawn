<img width="1728" height="1117" alt="image" src="https://github.com/user-attachments/assets/63c97c68-3a84-4da4-9c6f-7b23280b57ed" />

# Pawn

[English](./README.md) · [한국어](./README.ko.md) · [日本語](./README.ja.md)

**棋盘上自己的那枚棋子。** 写代码、看浏览器、操作电脑的桌面 AI 代理。API 密钥是你的，机器也是你的。

Pawn 是 Electron 应用。接任何 OpenAI 或 Claude 兼容 API。会话、记忆和钩子放在 `~/.pawn`。技能只装你需要的。

## 它做什么

**一个代理看仓库、浏览器和桌面。** 它改文件，跑 shell 和 git，跟着语言服务器走，也能挂上真调试器（Node、Python、Go、C/C++/Rust）。内置浏览器有自己的 Cookie，所以能碰已登录的网站。在 Mac 上，原生助手用辅助功能树操作其他应用。Windows 和 Linux 提供鼠标、键盘和截图。

**演示一次，就成技能。** 在 macOS 上录下你在 Pawn 浏览器或其他 Mac 应用里的操作，会得到一份 `SKILL.md`。可以换输入再跑，或放进日程。密码、验证码、卡号和 macOS 安全输入框不会被记录。

**带出处的调查。** 公开网页不需要另一把 API 密钥就能搜索和阅读。更深的调查由并行研究代理写成核对过引用的报告，放进项目里。

**用你已经在付的订阅。** 可以在设置里登录 ChatGPT（Plus、Pro、Team、Enterprise）、Claude（Pro、Max、Team、Enterprise）、xAI（SuperGrok 或 X Premium+）和 Antigravity（你在那里用的 Google 账号）。用量从该订阅扣除。对应预设上的 API 密钥仍然可用，退出登录时由它来跑。刷新令牌加密保存在 `~/.pawn`。

**留在这台电脑上。** 系统钥匙串可用时，密钥存在那里。长期记忆是本地数据库。Claude Code 的技能、插件、`CLAUDE.md`、钩子和 MCP 配置从原来的位置读取。需要时在设置里连接 Google、GitHub、GitLab 和 AWS CodeCommit。

**能接着做。** 自动路由选模型，并在提示缓存还热的时候留在那个模型上。长任务留下笔记和检查点。子代理可以分走一块工作，包括在 git worktree 里做。同一个代理可以用 `pawn-headless` 在没有窗口时运行。

## 安装

```bash
npx @parkjangwon/pawn
```

或全局安装启动器：

```bash
npm install -g @parkjangwon/pawn
pawn
```

**手动下载：** [Releases](https://github.com/parkjangwon/pawn/releases/latest)

| 平台 | 安装包 |
|------|--------|
| macOS | `pawn-<version>-universal.dmg`（Apple Silicon + Intel）。首次打开：右键 → **打开**。 |
| Windows | `pawn-<version>-x64-setup.exe` 或 `pawn-<version>-arm64-setup.exe` |
| Linux | `pawn-<version>-x64` / `arm64` 的 `.AppImage` 和 `.deb` |

macOS 10.12+ / Windows 10+ / Linux。API 密钥自己带。

启动后在设置里填入密钥，并打开项目文件夹。

## 给代理

到这里是给人看的。负责安装、配置或修改 Pawn 的编码代理去读指南：

| 语言 | 指南 |
|------|------|
| English | [docs/agent/GUIDE.md](./docs/agent/GUIDE.md) |
| 한국어 | [docs/agent/GUIDE.ko.md](./docs/agent/GUIDE.ko.md) |
| 中文 | [docs/agent/GUIDE.zh.md](./docs/agent/GUIDE.zh.md) |
| 日本語 | [docs/agent/GUIDE.ja.md](./docs/agent/GUIDE.ja.md) |

## 许可证

MIT — [LICENSE](./LICENSE)。OAuth 隐私：[PRIVACY.md](./PRIVACY.md)。

公开网页研究改编自 [insane-search](https://github.com/fivetaku/insane-search)（MIT）。
