/**
 * Main-process strings (native dialogs, tray, app menu) in the app language.
 *
 * The renderer owns the language (Settings → Appearance, or the OS language on
 * first launch) and pushes it here on start and on every change, so native UI
 * always matches the window. Kept free of Electron imports — unit-testable.
 */

export type AppLang = 'en' | 'ko' | 'ja' | 'zh'

let current: AppLang = 'en'

export function normalizeLang(lang: string | undefined | null): AppLang {
  const base = String(lang || '').toLowerCase().slice(0, 2)
  return base === 'ko' || base === 'ja' || base === 'zh' ? base : 'en'
}

export function setAppLanguage(lang: string): AppLang {
  current = normalizeLang(lang)
  return current
}

export function appLanguage(): AppLang {
  return current
}

const STRINGS = {
  closeRunning: {
    en: { message: 'Pawn is still working', detail: 'Closing the window stops the running task. Close anyway?', cancel: 'Keep working', close: 'Close anyway' },
    ko: { message: 'Pawn이 아직 작업 중이에요', detail: '창을 닫으면 진행 중인 작업이 멈춰요. 그래도 닫을까요?', cancel: '계속 작업', close: '그래도 닫기' },
    ja: { message: 'Pawn はまだ作業中です', detail: 'ウィンドウを閉じると実行中の作業が止まります。閉じますか？', cancel: '作業を続ける', close: '閉じる' },
    zh: { message: 'Pawn 仍在工作', detail: '关闭窗口将停止正在进行的任务。仍要关闭吗？', cancel: '继续工作', close: '仍然关闭' }
  },
  menu: {
    en: { about: 'About Pawn', settings: 'Settings…', hide: 'Hide Pawn', hideOthers: 'Hide Others', showAll: 'Show All', quit: 'Quit Pawn', edit: 'Edit', undo: 'Undo', redo: 'Redo', cut: 'Cut', copy: 'Copy', paste: 'Paste', selectAll: 'Select All', view: 'View', reload: 'Reload', devtools: 'Developer Tools', resetZoom: 'Actual Size', zoomIn: 'Zoom In', zoomOut: 'Zoom Out', fullscreen: 'Toggle Full Screen', window: 'Window', minimize: 'Minimize', zoom: 'Zoom', front: 'Bring All to Front', close: 'Close Window', help: 'Help', docs: 'Pawn on GitHub' },
    ko: { about: 'Pawn에 관하여', settings: '설정…', hide: 'Pawn 가리기', hideOthers: '기타 가리기', showAll: '모두 보기', quit: 'Pawn 종료', edit: '편집', undo: '실행 취소', redo: '다시 실행', cut: '오려두기', copy: '복사하기', paste: '붙여넣기', selectAll: '전체 선택', view: '보기', reload: '새로고침', devtools: '개발자 도구', resetZoom: '실제 크기', zoomIn: '확대', zoomOut: '축소', fullscreen: '전체 화면 전환', window: '윈도우', minimize: '최소화', zoom: '확대/축소', front: '모두 앞으로 가져오기', close: '창 닫기', help: '도움말', docs: 'GitHub의 Pawn' },
    ja: { about: 'Pawn について', settings: '設定…', hide: 'Pawn を隠す', hideOthers: 'ほかを隠す', showAll: 'すべてを表示', quit: 'Pawn を終了', edit: '編集', undo: '取り消す', redo: 'やり直す', cut: 'カット', copy: 'コピー', paste: 'ペースト', selectAll: 'すべてを選択', view: '表示', reload: '再読み込み', devtools: 'デベロッパツール', resetZoom: '実際のサイズ', zoomIn: '拡大', zoomOut: '縮小', fullscreen: 'フルスクリーンにする', window: 'ウインドウ', minimize: 'しまう', zoom: '拡大/縮小', front: 'すべてを手前に移動', close: 'ウインドウを閉じる', help: 'ヘルプ', docs: 'GitHub の Pawn' },
    zh: { about: '关于 Pawn', settings: '设置…', hide: '隐藏 Pawn', hideOthers: '隐藏其他', showAll: '全部显示', quit: '退出 Pawn', edit: '编辑', undo: '撤销', redo: '重做', cut: '剪切', copy: '拷贝', paste: '粘贴', selectAll: '全选', view: '显示', reload: '重新载入', devtools: '开发者工具', resetZoom: '实际大小', zoomIn: '放大', zoomOut: '缩小', fullscreen: '切换全屏幕', window: '窗口', minimize: '最小化', zoom: '缩放', front: '前置全部窗口', close: '关闭窗口', help: '帮助', docs: 'GitHub 上的 Pawn' }
  },
  dialog: {
    en: { chooseFolder: 'Choose a folder', open: 'Open', save: 'Save', json: 'JSON file', zip: 'Zip archive', markdown: 'Markdown document' },
    ko: { chooseFolder: '폴더 선택', open: '열기', save: '저장', json: 'JSON 파일', zip: 'Zip 압축 파일', markdown: 'Markdown 문서' },
    ja: { chooseFolder: 'フォルダを選択', open: '開く', save: '保存', json: 'JSON ファイル', zip: 'Zip アーカイブ', markdown: 'Markdown 書類' },
    zh: { chooseFolder: '选择文件夹', open: '打开', save: '保存', json: 'JSON 文件', zip: 'Zip 压缩包', markdown: 'Markdown 文档' }
  }
} as const

type Group = keyof typeof STRINGS

/** Strings for one group in the current (or given) language. */
export function ui<G extends Group>(group: G, lang: AppLang = current): (typeof STRINGS)[G]['en'] {
  return STRINGS[group][lang] as (typeof STRINGS)[G]['en']
}

export const SUPPORTED_LANGS: readonly AppLang[] = ['en', 'ko', 'ja', 'zh']

/** Test helper: every group has the same keys in every language. */
export function stringTables(): Record<string, Record<AppLang, Record<string, string>>> {
  return STRINGS as unknown as Record<string, Record<AppLang, Record<string, string>>>
}
