import { isEnoent, normalizeModifier, parseKeyCombo, run } from './platform'

function escapeOsascript(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

/** Map common key names to platform-specific tokens. */
function mapKeyName(key: string): { macCliclick?: string; macAS?: string; xdo?: string; win?: string } {
  const k = key.toLowerCase()
  const table: Record<string, { macCliclick: string; macAS: string; xdo: string; win: string }> = {
    return: { macCliclick: 'return', macAS: 'return', xdo: 'Return', win: '{ENTER}' },
    enter: { macCliclick: 'return', macAS: 'return', xdo: 'Return', win: '{ENTER}' },
    tab: { macCliclick: 'tab', macAS: 'tab', xdo: 'Tab', win: '{TAB}' },
    escape: { macCliclick: 'esc', macAS: 'escape', xdo: 'Escape', win: '{ESC}' },
    esc: { macCliclick: 'esc', macAS: 'escape', xdo: 'Escape', win: '{ESC}' },
    space: { macCliclick: 'space', macAS: 'space', xdo: 'space', win: ' ' },
    backspace: { macCliclick: 'delete', macAS: 'key code 51', xdo: 'BackSpace', win: '{BACKSPACE}' },
    delete: { macCliclick: 'fwd-delete', macAS: 'key code 117', xdo: 'Delete', win: '{DELETE}' },
    up: { macCliclick: 'arrow-up', macAS: 'key code 126', xdo: 'Up', win: '{UP}' },
    down: { macCliclick: 'arrow-down', macAS: 'key code 125', xdo: 'Down', win: '{DOWN}' },
    left: { macCliclick: 'arrow-left', macAS: 'key code 123', xdo: 'Left', win: '{LEFT}' },
    right: { macCliclick: 'arrow-right', macAS: 'key code 124', xdo: 'Right', win: '{RIGHT}' },
    home: { macCliclick: 'home', macAS: 'key code 115', xdo: 'Home', win: '{HOME}' },
    end: { macCliclick: 'end', macAS: 'key code 119', xdo: 'End', win: '{END}' },
    pageup: { macCliclick: 'page-up', macAS: 'key code 116', xdo: 'Page_Up', win: '{PGUP}' },
    pagedown: { macCliclick: 'page-down', macAS: 'key code 121', xdo: 'Page_Down', win: '{PGDN}' },
    f1: { macCliclick: 'f1', macAS: 'key code 122', xdo: 'F1', win: '{F1}' },
    f2: { macCliclick: 'f2', macAS: 'key code 120', xdo: 'F2', win: '{F2}' },
    f3: { macCliclick: 'f3', macAS: 'key code 99', xdo: 'F3', win: '{F3}' },
    f4: { macCliclick: 'f4', macAS: 'key code 118', xdo: 'F4', win: '{F4}' },
    f5: { macCliclick: 'f5', macAS: 'key code 96', xdo: 'F5', win: '{F5}' },
    f12: { macCliclick: 'f12', macAS: 'key code 111', xdo: 'F12', win: '{F12}' }
  }
  if (table[k]) return table[k]
  return {
    macCliclick: key,
    macAS: key.length === 1 ? key : key,
    xdo: key,
    win: key.length === 1 ? key : `{${key.toUpperCase()}}`
  }
}

function macUsingClause(modifiers: string[]): string {
  const parts: string[] = []
  for (const m of modifiers) {
    const n = normalizeModifier(m)
    if (n === 'command') parts.push('command down')
    else if (n === 'control') parts.push('control down')
    else if (n === 'alt') parts.push('option down')
    else if (n === 'shift') parts.push('shift down')
  }
  return parts.length ? ` using {${parts.join(', ')}}` : ''
}

function cliclickMods(modifiers: string[]): string {
  // cliclick: kd:cmd,shift then key then ku:cmd,shift
  const map: Record<string, string> = {
    command: 'cmd',
    control: 'ctrl',
    alt: 'alt',
    shift: 'shift',
    super: 'cmd'
  }
  return modifiers
    .map((m) => map[normalizeModifier(m)] || m)
    .filter(Boolean)
    .join(',')
}

export async function typeText(text: string): Promise<{ ok?: boolean; error?: string }> {
  try {
    if (!text) return { error: 'text is required' }
    if (process.platform === 'darwin') {
      try {
        // cliclick t: has issues with special chars; chunk plain text
        if (/^[\x20-\x7E\n\r\t]+$/.test(text) && text.length < 200) {
          await run('cliclick', [`t:${text.replace(/\n/g, ' ')}`])
        } else {
          throw Object.assign(new Error('use osascript'), { code: 'ENOENT' })
        }
      } catch (err) {
        if (!isEnoent(err) && !(err instanceof Error && err.message === 'use osascript')) throw err
        const escaped = escapeOsascript(text)
        await run('osascript', [
          '-e',
          `tell application "System Events" to keystroke "${escaped}"`
        ])
      }
    } else if (process.platform === 'linux') {
      await run('xdotool', ['type', '--clearmodifiers', '--', text])
    } else if (process.platform === 'win32') {
      const escaped = text
        .replace(/([+^%~(){}[\]])/g, '{$1}')
        .replace(/"/g, '`"')
      await run('powershell.exe', [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        `[void][Reflection.Assembly]::LoadWithPartialName('System.Windows.Forms'); [System.Windows.Forms.SendKeys]::SendWait("${escaped}");`
      ])
    } else return { error: 'Unsupported platform' }
    return { ok: true }
  } catch (err) {
    return { error: String(err) }
  }
}

export async function keypress(combo: string): Promise<{ ok?: boolean; error?: string }> {
  try {
    const { modifiers, key } = parseKeyCombo(combo)
    if (!key) return { error: 'key is required' }
    const mapped = mapKeyName(key)

    if (process.platform === 'darwin') {
      try {
        const mods = cliclickMods(modifiers)
        if (mods) {
          await run('cliclick', [`kd:${mods}`, `kp:${mapped.macCliclick || key}`, `ku:${mods}`])
        } else {
          await run('cliclick', [`kp:${mapped.macCliclick || key}`])
        }
      } catch (err) {
        if (!isEnoent(err)) throw err
        const using = macUsingClause(modifiers)
        const asKey = mapped.macAS || key
        let script: string
        if (asKey.startsWith('key code')) {
          script = `tell application "System Events" to ${asKey}${using}`
        } else if (asKey.length === 1 || ['return', 'tab', 'escape', 'space'].includes(asKey)) {
          const stroke =
            asKey === 'return'
              ? 'return'
              : asKey === 'tab'
                ? 'tab'
                : asKey === 'escape'
                  ? 'escape'
                  : asKey === 'space'
                    ? 'space'
                    : `"${escapeOsascript(asKey)}"`
          script = `tell application "System Events" to keystroke ${stroke}${using}`
        } else {
          script = `tell application "System Events" to keystroke "${escapeOsascript(key)}"${using}`
        }
        await run('osascript', ['-e', script])
      }
    } else if (process.platform === 'linux') {
      const modMap: Record<string, string> = {
        command: 'super',
        control: 'ctrl',
        alt: 'alt',
        shift: 'shift',
        super: 'super'
      }
      const parts = [
        ...modifiers.map((m) => modMap[normalizeModifier(m)] || m),
        mapped.xdo || key
      ]
      await run('xdotool', ['key', '--clearmodifiers', parts.join('+')])
    } else if (process.platform === 'win32') {
      const modPrefix =
        (modifiers.some((m) => normalizeModifier(m) === 'control') ? '^' : '') +
        (modifiers.some((m) => normalizeModifier(m) === 'alt') ? '%' : '') +
        (modifiers.some((m) => normalizeModifier(m) === 'shift') ? '+' : '')
      // Win key limited in SendKeys
      const body = mapped.win || key
      const send = `${modPrefix}${body}`.replace(/"/g, '`"')
      await run('powershell.exe', [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        `[System.Void][System.Reflection.Assembly]::LoadWithPartialName('System.Windows.Forms'); [System.Windows.Forms.SendKeys]::SendWait("${send}");`
      ])
    } else return { error: 'Unsupported platform' }
    return { ok: true }
  } catch (err) {
    return { error: String(err) }
  }
}
