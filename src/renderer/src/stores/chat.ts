import { create } from 'zustand'
import { useAppStore } from './app'
import { useProviderStore } from './provider'

export type SendMode = 'queue' | 'steer'

interface ChatState {
  isStreaming: boolean
  queue: Array<{ projectId: string; sessionId: string; content: string }>
  sendMessage: (projectId: string, sessionId: string, content: string, mode: SendMode) => void
  stopStreaming: () => void
}

let abortController: AbortController | null = null

// Stable system prompt for cache hits - never changes within a session
const SYSTEM_PROMPT = `You are hjcode, an AI coding assistant running inside a desktop application. You help users with coding, file management, browser automation, and general tasks. You have access to tools for file system operations, shell commands, computer control, and browser automation. Be concise, accurate, and helpful.`

export const useChatStore = create<ChatState>((set, get) => ({
  isStreaming: false,
  queue: [],

  sendMessage: (projectId, sessionId, content, mode) => {
    const state = get()

    if (mode === 'queue' && state.isStreaming) {
      set({ queue: [...state.queue, { projectId, sessionId, content }] })
      useAppStore.getState().addMessage(projectId, sessionId, {
        id: `${Date.now()}-user`,
        role: 'user',
        content,
        createdAt: Date.now()
      })
      return
    }

    if (mode === 'steer' && state.isStreaming) {
      abortController?.abort()
    }

    useAppStore.getState().addMessage(projectId, sessionId, {
      id: `${Date.now()}-user`,
      role: 'user',
      content,
      createdAt: Date.now()
    })

    set({ isStreaming: true })
    streamResponse(projectId, sessionId, set, get)
  },

  stopStreaming: () => {
    abortController?.abort()
    set({ isStreaming: false })
  }
}))

async function streamResponse(
  projectId: string,
  sessionId: string,
  set: (fn: (s: ChatState) => Partial<ChatState>) => void,
  get: () => ChatState
): Promise<void> {
  const { providers, models } = useProviderStore.getState()
  const enabledProviders = providers.filter((p) => p.enabled)

  if (enabledProviders.length === 0) {
    useAppStore.getState().addMessage(projectId, sessionId, {
      id: `${Date.now()}-err`,
      role: 'assistant',
      content: 'No providers configured. Add a provider in Settings.',
      createdAt: Date.now()
    })
    set(() => ({ isStreaming: false }))
    processQueue(set, get)
    return
  }

  const provider = enabledProviders[0]
  const model = models.find((m) => m.providerId === provider.id && m.enabled)
  const modelId = model?.modelId || 'gpt-4o'

  abortController = new AbortController()

  const assistantMsgId = `${Date.now()}-assistant`
  useAppStore.getState().addMessage(projectId, sessionId, {
    id: assistantMsgId,
    role: 'assistant',
    content: '',
    createdAt: Date.now()
  })

  try {
    const session = useAppStore.getState().projects
      .find((p) => p.id === projectId)
      ?.sessions.find((s) => s.id === sessionId)

    const historyMessages = (session?.messages || [])
      .filter((m) => m.id !== assistantMsgId)
      .map((m) => ({ role: m.role, content: m.content }))

    let url: string
    let body: Record<string, unknown>
    let headers: Record<string, string> = { 'Content-Type': 'application/json' }

    if (provider.apiFormat === 'claude') {
      url = `${provider.baseUrl}/messages`
      headers['x-api-key'] = provider.apiKey || ''
      headers['anthropic-version'] = '2023-06-01'

      // Claude cache control: mark system prompt for caching
      body = {
        model: modelId,
        max_tokens: 8192,
        stream: true,
        system: [
          {
            type: 'text',
            text: SYSTEM_PROMPT,
            cache_control: { type: 'ephemeral' }
          }
        ],
        messages: historyMessages
      }
    } else {
      // OpenAI format - stable system prompt first for prefix cache
      url = `${provider.baseUrl}/chat/completions`
      headers['Authorization'] = `Bearer ${provider.apiKey || ''}`

      body = {
        model: modelId,
        stream: true,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          ...historyMessages
        ]
      }
    }

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: abortController.signal
    })

    if (!response.ok) {
      const errText = await response.text()
      throw new Error(`API ${response.status}: ${errText.slice(0, 200)}`)
    }

    const reader = response.body?.getReader()
    if (!reader) throw new Error('No response body')

    const decoder = new TextDecoder()
    let buffer = ''
    let fullContent = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue
        const data = line.slice(6).trim()
        if (data === '[DONE]') continue

        try {
          const parsed = JSON.parse(data)
          let delta = ''

          if (provider.apiFormat === 'claude') {
            if (parsed.type === 'content_block_delta') {
              delta = parsed.delta?.text || ''
            }
          } else {
            delta = parsed.choices?.[0]?.delta?.content || ''
          }

          if (delta) {
            fullContent += delta
            useAppStore.getState().updateMessageContent(projectId, sessionId, assistantMsgId, fullContent)
          }
        } catch {
          // skip malformed SSE chunks
        }
      }
    }

    // Notify on completion
    if (fullContent.length > 0) {
      window.api.notification.send('hjcode', 'Response complete')
    }
  } catch (err: unknown) {
    if (err instanceof Error && err.name === 'AbortError') {
      // user stopped streaming
    } else {
      const errMsg = err instanceof Error ? err.message : 'Unknown error'
      useAppStore.getState().updateMessageContent(
        projectId, sessionId, assistantMsgId,
        `[Error] ${errMsg}`
      )
    }
  } finally {
    set(() => ({ isStreaming: false }))
    abortController = null
    processQueue(set, get)
  }
}

function processQueue(
  set: (fn: (s: ChatState) => Partial<ChatState>) => void,
  get: () => ChatState
): void {
  const { queue } = get()
  if (queue.length === 0) return

  const next = queue[0]
  set((s) => ({ queue: s.queue.slice(1) }))

  setTimeout(() => {
    get().sendMessage(next.projectId, next.sessionId, next.content, 'queue')
  }, 100)
}
