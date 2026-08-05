import { clipboard } from 'electron'

export function clipboardRead(): { text?: string; error?: string } {
  try {
    return { text: clipboard.readText() }
  } catch (err) {
    return { error: String(err) }
  }
}

export function clipboardWrite(text: string): { ok?: boolean; error?: string } {
  try {
    clipboard.writeText(String(text ?? ''))
    return { ok: true }
  } catch (err) {
    return { error: String(err) }
  }
}
