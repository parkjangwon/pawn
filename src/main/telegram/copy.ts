import { appLanguage, type AppLang } from '../appLanguage'

/**
 * Bot-facing copy. The desktop UI is translated in the renderer locales;
 * these strings are what a paired Telegram user reads.
 */

export interface BotCommandCopy {
  /** Bot command name: lowercase letters, digits, underscores (Telegram limit). */
  command: string
  description: string
}

export interface BotCopy {
  pairing: (code: string, userId: string) => string
  paired: string
  textOnly: string
  help: string
  whoami: (userId: string) => string
  status: (listening: boolean, username?: string) => string
  newChat: string
  stopping: string
  unknown: string
  pickProject: string
  allow: string
  deny: string
  permission: (summary: string) => string
  notPaired: string
  /** Registered with setMyCommands so the client offers autocomplete. */
  commands: BotCommandCopy[]
}

const COPY: Record<AppLang, BotCopy> = {
  en: {
    pairing: (code, userId) =>
      `This bot is private.\nPairing code: ${code}\nApprove it in Pawn → Settings → Telegram.\nYour Telegram user id: ${userId}`,
    paired: 'Paired. Send a message and Pawn will run it in the project you selected.',
    textOnly: 'Send a text message. Photos and files are not read yet.',
    help:
      'Pawn on this computer.\n/new — fresh chat\n/stop — cancel the current turn\n/plan [request] — plan mode: research and propose, no changes\n/build — back to build mode (full tools)\n/sessions — recent chats\n/chat <number> — switch to a recent chat\n/tasks — task list of this chat\n/changes — files the agent changed\n/undo <number> — revert a change set\n/model — model and context fill\n/compact — shrink the context\n/project — folder the agent runs in\n/usage — spend over the last 24h\n/status — connection\n/whoami — your user id\n/help — this list\n\nAny other message runs the agent in the project chosen in Settings → Telegram. It can edit files and run commands there, with the same permission mode as the desktop app. Group chats are ignored.',
    whoami: (userId) => `Your Telegram user id is ${userId}.`,
    status: (listening, username) =>
      `${listening ? 'Listening' : 'Not listening'}${username ? ` as @${username}` : ''}.`,
    newChat: 'Started a fresh chat. The next message runs there.',
    stopping: 'Stopping the current turn.',
    unknown: 'Unknown command. /help lists what I understand.',
    pickProject: 'Pick a folder project in Pawn → Settings → Telegram. Remote turns run in that project.',
    allow: 'Allow',
    deny: 'Deny',
    permission: (summary) => `Pawn is asking to proceed:\n${summary}`,
    notPaired: 'Not paired',
    commands: [
      { command: 'new', description: 'Start a fresh chat' },
      { command: 'stop', description: 'Cancel the current turn' },
      { command: 'plan', description: 'Plan mode: propose without changes, e.g. /plan fix login' },
      { command: 'build', description: 'Back to build mode: full tools' },
      { command: 'sessions', description: 'List recent chats' },
      { command: 'chat', description: 'Switch to a recent chat, e.g. /chat 2' },
      { command: 'tasks', description: 'Show the task list of this chat' },
      { command: 'changes', description: 'Show files the agent changed' },
      { command: 'undo', description: 'Revert a change set, e.g. /undo 1' },
      { command: 'model', description: 'Show the model and context fill' },
      { command: 'compact', description: 'Shrink the chat context' },
      { command: 'project', description: 'Folder the agent runs in' },
      { command: 'usage', description: 'Spend over the last 24 hours' },
      { command: 'status', description: 'Show whether the bot is listening' },
      { command: 'whoami', description: 'Show your Telegram user id' },
      { command: 'help', description: 'Show what the bot can do' }
    ]
  },
  ko: {
    pairing: (code, userId) =>
      `이 봇은 비공개예요.\n페어링 코드: ${code}\nPawn → 설정 → Telegram에서 승인해 주세요.\n텔레그램 사용자 id: ${userId}`,
    paired: '연결됐어요. 메시지를 보내면 선택한 프로젝트에서 Pawn이 실행해요.',
    textOnly: '텍스트만 읽을 수 있어요. 사진과 파일은 아직이에요.',
    help:
      '이 컴퓨터의 Pawn이에요.\n/new — 새 채팅\n/stop — 이번 작업 취소\n/plan [요청] — 계획 모드: 조사하고 제안해요, 바꾸지 않아요\n/build — 빌드 모드 복귀 (전체 도구)\n/sessions — 최근 채팅 목록\n/chat <번호> — 최근 채팅으로 이동\n/tasks — 이 채팅의 작업 목록\n/changes — 에이전트가 고친 파일\n/undo <번호> — 변경 되돌리기\n/model — 모델과 맥락 사용량\n/compact — 맥락 줄이기\n/project — 에이전트가 실행되는 폴더\n/usage — 최근 24시간 사용량\n/status — 연결 상태\n/whoami — 내 사용자 id\n/help — 이 안내\n\n그 밖의 메시지는 설정 → Telegram에서 고른 프로젝트의 에이전트를 실행해요. 데스크톱과 같은 권한 모드로 파일을 고치고 명령을 실행할 수 있어요. 그룹 채팅은 무시해요.',
    whoami: (userId) => `텔레그램 사용자 id는 ${userId}이에요.`,
    status: (listening, username) =>
      `${listening ? '수신 중' : '꺼짐'}${username ? ` (@${username})` : ''}이에요.`,
    newChat: '새 채팅을 시작했어요. 다음 메시지부터 거기서 실행해요.',
    stopping: '진행 중인 작업을 멈춰요.',
    unknown: '모르는 명령이에요. /help로 목록을 볼 수 있어요.',
    pickProject: 'Pawn → 설정 → Telegram에서 폴더 프로젝트를 골라 주세요. 원격 작업은 그 프로젝트에서 돌아요.',
    allow: '허용',
    deny: '거절',
    permission: (summary) => `Pawn이 진행 여부를 물어봐요:\n${summary}`,
    notPaired: '페어링되지 않음',
    commands: [
      { command: 'new', description: '새 채팅을 시작해요' },
      { command: 'stop', description: '진행 중인 작업을 멈춰요' },
      { command: 'plan', description: '계획 모드로 조사하고 제안해요. 예: /plan 로그인 고치기' },
      { command: 'build', description: '빌드 모드로 복귀해요 (전체 도구)' },
      { command: 'sessions', description: '최근 채팅 목록을 보여줘요' },
      { command: 'chat', description: '최근 채팅으로 이동해요. 예: /chat 2' },
      { command: 'tasks', description: '이 채팅의 작업 목록을 보여줘요' },
      { command: 'changes', description: '에이전트가 고친 파일을 보여줘요' },
      { command: 'undo', description: '변경 세트를 되돌려요. 예: /undo 1' },
      { command: 'model', description: '모델과 맥락 사용량을 보여줘요' },
      { command: 'compact', description: '채팅 맥락을 줄여요' },
      { command: 'project', description: '에이전트가 실행되는 폴더를 보여줘요' },
      { command: 'usage', description: '최근 24시간 사용량을 보여줘요' },
      { command: 'status', description: '연결 상태를 보여줘요' },
      { command: 'whoami', description: '텔레그램 사용자 id를 보여줘요' },
      { command: 'help', description: '할 수 있는 일을 보여줘요' }
    ]
  },
  ja: {
    pairing: (code, userId) =>
      `このボットは非公開です。\nペアリングコード: ${code}\nPawn → 設定 → Telegram で承認してください。\nTelegram ユーザー id: ${userId}`,
    paired: '接続しました。メッセージを送ると、選んだプロジェクトで Pawn が動きます。',
    textOnly: 'テキストだけ読めます。写真とファイルはまだです。',
    help:
      'このコンピュータの Pawn です。\n/new — 新しいチャット\n/stop — 今のターンを止める\n/plan [依頼] — 計画モード: 調査と提案、変更はしない\n/build — ビルドモードに戻る（全ツール）\n/sessions — 最近のチャット一覧\n/chat <番号> — 最近のチャットへ切替\n/tasks — このチャットのタスク一覧\n/changes — エージェントの変更ファイル\n/undo <番号> — 変更を取り消す\n/model — モデルと文脈の使用量\n/compact — 文脈を圧縮\n/project — エージェントの作業フォルダ\n/usage — 直近 24 時間の使用量\n/status — 接続\n/whoami — ユーザー id\n/help — この一覧\n\nそれ以外のメッセージは、設定 → Telegram で選んだプロジェクトのエージェントを実行します。デスクトップと同じ権限モードでファイル編集とコマンド実行ができます。グループは無視します。',
    whoami: (userId) => `Telegram ユーザー id は ${userId} です。`,
    status: (listening, username) =>
      `${listening ? '受信中' : '停止中'}${username ? ` (@${username})` : ''}です。`,
    newChat: '新しいチャットを始めました。次のメッセージからそこで動きます。',
    stopping: '今のターンを止めます。',
    unknown: '未知のコマンドです。/help で一覧を見られます。',
    pickProject: 'Pawn → 設定 → Telegram でフォルダのプロジェクトを選んでください。リモートの作業はそのプロジェクトで動きます。',
    allow: '許可',
    deny: '拒否',
    permission: (summary) => `Pawn が確認しています:\n${summary}`,
    notPaired: '未ペアリング',
    commands: [
      { command: 'new', description: '新しいチャットを始めます' },
      { command: 'stop', description: '進行中のターンを止めます' },
      { command: 'plan', description: '計画モードで調査・提案。例: /plan ログイン修正' },
      { command: 'build', description: 'ビルドモードに戻る（全ツール）' },
      { command: 'sessions', description: '最近のチャット一覧' },
      { command: 'chat', description: '最近のチャットへ切替（例: /chat 2）' },
      { command: 'tasks', description: 'このチャットのタスク一覧' },
      { command: 'changes', description: 'エージェントの変更ファイル' },
      { command: 'undo', description: '変更セットを取り消し（例: /undo 1）' },
      { command: 'model', description: 'モデルと文脈の使用量' },
      { command: 'compact', description: '文脈を圧縮します' },
      { command: 'project', description: '作業フォルダを表示' },
      { command: 'usage', description: '直近 24 時間の使用量' },
      { command: 'status', description: '接続状態を表示' },
      { command: 'whoami', description: 'あなたの Telegram ユーザー id' },
      { command: 'help', description: 'できることを表示します' }
    ]
  },
  zh: {
    pairing: (code, userId) =>
      `这个机器人是私密的。\n配对码：${code}\n请在 Pawn → 设置 → Telegram 中批准。\nTelegram 用户 id：${userId}`,
    paired: '已连接。发消息后，Pawn 会在你选的项目里运行。',
    textOnly: '目前只能读文字。照片和文件还不行。',
    help:
      '这是这台电脑上的 Pawn。\n/new — 新聊天\n/stop — 取消当前回合\n/plan [请求] — 计划模式：调研并提案，不做修改\n/build — 切回构建模式（全部工具）\n/sessions — 最近聊天列表\n/chat <编号> — 切换到最近聊天\n/tasks — 当前聊天的任务列表\n/changes — 代理修改过的文件\n/undo <编号> — 撤销一批更改\n/model — 模型与上下文占用\n/compact — 压缩上下文\n/project — 代理运行的文件夹\n/usage — 最近 24 小时用量\n/status — 连接状态\n/whoami — 你的用户 id\n/help — 这份说明\n\n其他消息会在 设置 → Telegram 里选定的项目中运行代理。权限模式与桌面相同，可以改文件、跑命令。群聊会被忽略。',
    whoami: (userId) => `你的 Telegram 用户 id 是 ${userId}。`,
    status: (listening, username) =>
      `${listening ? '正在接收' : '未在接收'}${username ? ` (@${username})` : ''}。`,
    newChat: '已开始新的聊天。下一条消息会在那里运行。',
    stopping: '正在停止当前回合。',
    unknown: '不认识这个命令。发送 /help 查看列表。',
    pickProject: '请在 Pawn → 设置 → Telegram 里选择一个文件夹项目。远程任务会在那个项目里运行。',
    allow: '允许',
    deny: '拒绝',
    permission: (summary) => `Pawn 请求继续：\n${summary}`,
    notPaired: '尚未配对',
    commands: [
      { command: 'new', description: '开始新聊天' },
      { command: 'stop', description: '取消当前回合' },
      { command: 'plan', description: '计划模式：调研并提案。如 /plan 修复登录' },
      { command: 'build', description: '切回构建模式（全部工具）' },
      { command: 'sessions', description: '显示最近的聊天' },
      { command: 'chat', description: '切换到最近的聊天，如 /chat 2' },
      { command: 'tasks', description: '显示当前聊天的任务列表' },
      { command: 'changes', description: '显示代理修改过的文件' },
      { command: 'undo', description: '撤销更改批次，如 /undo 1' },
      { command: 'model', description: '显示模型与上下文占用' },
      { command: 'compact', description: '压缩聊天上下文' },
      { command: 'project', description: '显示代理运行的文件夹' },
      { command: 'usage', description: '最近 24 小时用量' },
      { command: 'status', description: '显示连接状态' },
      { command: 'whoami', description: '显示你的 Telegram 用户 id' },
      { command: 'help', description: '显示使用说明' }
    ]
  }
}

export function botCopy(lang: AppLang = appLanguage()): BotCopy {
  return COPY[lang]
}

/** Map a Telegram client language_code (IETF tag like "ko-KR") to a supported language. */
export function normalizeLang(code: string | undefined): AppLang | undefined {
  if (!code) return undefined
  if (code.startsWith('ko')) return 'ko'
  if (code.startsWith('ja')) return 'ja'
  if (code.startsWith('zh')) return 'zh'
  if (code.startsWith('en')) return 'en'
  return undefined
}
