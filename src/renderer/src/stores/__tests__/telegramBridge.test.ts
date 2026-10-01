// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { useAppStore } from '../app'
import { __handleTelegramEventForTests as handle, startTelegramBridge, telegramReplyText } from '../telegramBridge'

describe('telegramReplyText', () => {
  it('returns the assistant text after the telegram message, skipping tool rows', () => {
    const text = telegramReplyText(
      [
        { role: 'user', content: '[Telegram @ada]\nolder' },
        { role: 'assistant', content: 'old answer' },
        { role: 'user', content: '[Telegram @ada]\nfix the tests' },
        { role: 'assistant', content: '[Tool: shell_exec]', toolMeta: { name: 'shell_exec' } },
        { role: 'assistant', content: 'All green.' }
      ],
      'fix the tests'
    )
    expect(text).toBe('All green.')
  })

  it('falls back to the system error when the model never answered', () => {
    expect(
      telegramReplyText(
        [
          { role: 'user', content: '[Telegram 42]\nhello' },
          { role: 'system', content: 'No usable model.' }
        ],
        'hello'
      )
    ).toBe('No usable model.')
  })
})

describe('telegram bridge data commands', () => {
  it('answers every data command instead of dropping it', async () => {
    const replies: Array<{ chatId: string; text: string }> = []
    ;(window as unknown as { api: unknown }).api = {
      telegram: {
        onEvent: () => () => {},
        listen: async () => ({ ok: true, events: [] }),
        reply: async (chatId: string, text: string) => {
          replies.push({ chatId, text })
          return { ok: true }
        },
        progress: async () => ({ ok: true }),
        bindChat: async () => ({ ok: true }),
        askPermission: async () => ({ ok: true })
      },
      db: { getUsageSummary: async () => [] }
    }
    // Empty store: every command takes the "project missing" answer, which
    // still proves the event reached a handler. Regression: /plan /changes
    // /undo /model /compact used to be dropped by the dispatch guard.
    useAppStore.setState({ initialized: true, projects: [] })
    startTelegramBridge()

    const commands = [
      'sessions',
      'chat',
      'project',
      'usage',
      'plan',
      'changes',
      'undo',
      'model',
      'compact'
    ] as const
    for (const name of commands) {
      handle({ type: 'command', name, chatId: '42', userId: '42', projectId: 'proj-1' })
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
    expect(replies).toHaveLength(commands.length)
    for (const reply of replies) {
      expect(reply.chatId).toBe('42')
      expect(reply.text.trim().length).toBeGreaterThan(0)
    }
  })
})
