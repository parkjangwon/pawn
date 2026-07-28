import { create } from 'zustand'
import { useAppStore } from './app'
import { useProviderStore } from './provider'
import { executeTool, toolsToOpenAI, toolsToClaude, type ToolCall } from '../agent/tools'
import { loadProjectContext, buildSystemPrompt } from '../agent/skills'
import { selectModelForTask, estimateComplexity } from '../agent/routing'

export type SendMode = 'queue' | 'steer'

const MAX_TOOL_ROUNDS = 25

interface ChatState {
  isStreaming: boolean
  queue: Array<{ projectId: string; sessionId: string; content: string }>
  sendMessage: (projectId: string, sessionId: string, content: string, mode: SendMode) => void
  stopStreaming: () => void
}

let abortController: AbortController | null = null

const SYSTEM_PROMPT = `You are hjcode, an AI coding assistant running inside a desktop application. You help users with coding, file management, browser automation, computer control, and general tasks.

You have access to tools for:
- Reading, writing, and editing files
- Listing directories
- Executing shell commands
- Taking screenshots and controlling the computer
- Opening URLs in the browser

When the user asks you to do something, use the appropriate tools to accomplish it. You can call multiple tools in sequence. After each tool result, decide whether to call another tool or respond to the user.

Be concise in your text responses. Show your work through tool calls. When editing code, read the file first to understand the current state before making changes.`

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

    // Auto-title: set session title from first user message
    const session = useAppStore.getState().projects
      .find((p) => p.id === projectId)
      ?.sessions.find((s) => s.id === sessionId)
    if (session && session.messages.length <= 1 && session.title === 'New Session') {
      const title = content.slice(0, 40) + (content.length > 40 ? '...' : '')
      useAppStore.getState().updateSessionTitle(projectId, sessionId, title)
    }

    set({ isStreaming: true })
    agentLoop(projectId, sessionId, set, get)
  },

  stopStreaming: () => {
    abortController?.abort()
    set({ isStreaming: false })
  }
}))

async function agentLoop(
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
      content: 'No providers configured. Go to Settings > Providers to add one.',
      createdAt: Date.now()
    })
    set(() => ({ isStreaming: false }))
    processQueue(set, get)
    return
  }

  const provider = enabledProviders[0]

  abortController = new AbortController()

  // Get project path for tool execution context
  const project = useAppStore.getState().projects.find((p) => p.id === projectId)
  const projectPath = project?.path

  // Load project context (skills, CLAUDE.md, etc.)
  let systemPrompt = SYSTEM_PROMPT
  if (projectPath) {
    try {
      const ctx = await loadProjectContext(projectPath)
      systemPrompt = buildSystemPrompt(SYSTEM_PROMPT, ctx)
    } catch {
      // Skills loading failed, use base prompt
    }
  }

  // Build conversation history
  const session = useAppStore.getState().projects
    .find((p) => p.id === projectId)
    ?.sessions.find((s) => s.id === sessionId)

  const conversationMessages = (session?.messages || []).map((m) => ({
    role: m.role,
    content: m.content
  }))

  // Auto mode: select model based on task complexity
  const lastUserMsg = conversationMessages.filter((m) => m.role === 'user').pop()
  const complexity = estimateComplexity(lastUserMsg?.content || '')
  const selectedModel = selectModelForTask(complexity)
  const modelId = selectedModel?.modelId || models.find((m) => m.providerId === provider.id && m.enabled)?.modelId || 'gpt-4o'

  // Agent loop: keep calling LLM until it stops using tools
  let round = 0
  // We maintain a working message list that includes tool calls and results
  const workingMessages: Array<Record<string, unknown>> = conversationMessages.map((m) => ({
    role: m.role,
    content: m.content
  }))

  while (round < MAX_TOOL_ROUNDS) {
    if (abortController.signal.aborted) break
    round++

    // Create assistant message placeholder for streaming
    const assistantMsgId = `${Date.now()}-assistant-${round}`
    useAppStore.getState().addMessage(projectId, sessionId, {
      id: assistantMsgId,
      role: 'assistant',
      content: '',
      createdAt: Date.now()
    })

    // Call LLM
    const { text, toolCalls } = await callLLM(
      provider, modelId, workingMessages, assistantMsgId, projectId, sessionId, systemPrompt
    )

    if (abortController.signal.aborted) break

    // If no tool calls, we're done
    if (toolCalls.length === 0) {
      break
    }

    // Add assistant message with tool calls to working history
    if (provider.apiFormat === 'claude') {
      const contentBlocks: Array<Record<string, unknown>> = []
      if (text) contentBlocks.push({ type: 'text', text })
      for (const tc of toolCalls) {
        contentBlocks.push({
          type: 'tool_use',
          id: tc.id,
          name: tc.name,
          input: tc.arguments
        })
      }
      workingMessages.push({ role: 'assistant', content: contentBlocks })
    } else {
      workingMessages.push({
        role: 'assistant',
        content: text || null,
        tool_calls: toolCalls.map((tc) => ({
          id: tc.id,
          type: 'function',
          function: { name: tc.name, arguments: JSON.stringify(tc.arguments) }
        }))
      })
    }

    // Execute tools and collect results
    for (const tc of toolCalls) {
      if (abortController.signal.aborted) break

      // Show tool execution in UI
      const toolMsgId = `${Date.now()}-tool-${tc.id}`
      useAppStore.getState().addMessage(projectId, sessionId, {
        id: toolMsgId,
        role: 'system',
        content: `[Tool: ${tc.name}] ${JSON.stringify(tc.arguments).slice(0, 200)}`,
        createdAt: Date.now()
      })

      const result = await executeTool(tc, projectPath)

      // Update tool message with result
      useAppStore.getState().updateMessageContent(
        projectId, sessionId, toolMsgId,
        `[Tool: ${tc.name}] ${result.isError ? 'ERROR' : 'OK'}\n${result.content.slice(0, 500)}`
      )

      // Add tool result to working history
      if (provider.apiFormat === 'claude') {
        workingMessages.push({
          role: 'user',
          content: [{
            type: 'tool_result',
            tool_use_id: tc.id,
            content: result.content,
            is_error: result.isError || false
          }]
        })
      } else {
        workingMessages.push({
          role: 'tool',
          tool_call_id: tc.id,
          content: result.content
        })
      }
    }
  }

  // Notify completion
  window.api.notification.send('hjcode', 'Task complete')

  set(() => ({ isStreaming: false }))
  abortController = null
  processQueue(set, get)
}

async function callLLM(
  provider: { apiFormat: string; baseUrl: string; apiKey?: string },
  modelId: string,
  messages: Array<Record<string, unknown>>,
  assistantMsgId: string,
  projectId: string,
  sessionId: string,
  systemPrompt: string
): Promise<{ text: string; toolCalls: ToolCall[] }> {
  const isBrowser = window.api?.platform === 'browser'
  let url: string
  let body: Record<string, unknown>
  let headers: Record<string, string> = { 'Content-Type': 'application/json' }

  if (provider.apiFormat === 'claude') {
    url = `${provider.baseUrl}/messages`
    headers['x-api-key'] = provider.apiKey || ''
    headers['anthropic-version'] = '2023-06-01'
    body = {
      model: modelId,
      max_tokens: 8192,
      stream: true,
      system: [{ type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } }],
      tools: toolsToClaude(),
      messages
    }
  } else {
    url = `${provider.baseUrl}/chat/completions`
    headers['Authorization'] = `Bearer ${provider.apiKey || ''}`
    body = {
      model: modelId,
      stream: true,
      tools: toolsToOpenAI(),
      messages: [{ role: 'system', content: systemPrompt }, ...messages]
    }
  }

  let response: Response
  if (isBrowser) {
    response = await fetch('/api/proxy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, headers, body: JSON.stringify(body) }),
      signal: abortController!.signal
    })
  } else {
    response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: abortController!.signal
    })
  }

  if (!response.ok) {
    const errText = await response.text()
    throw new Error(`API ${response.status}: ${errText.slice(0, 300)}`)
  }

  // Stream and parse response
  const reader = response.body?.getReader()
  if (!reader) throw new Error('No response body')

  const decoder = new TextDecoder()
  let buffer = ''
  let fullText = ''
  const toolCalls: ToolCall[] = []
  // For accumulating tool call arguments during streaming
  const toolCallBuffers: Map<number, { id: string; name: string; args: string }> = new Map()

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

        if (provider.apiFormat === 'claude') {
          // Claude streaming events
          if (parsed.type === 'content_block_start' && parsed.content_block?.type === 'tool_use') {
            const idx = parsed.index
            toolCallBuffers.set(idx, {
              id: parsed.content_block.id,
              name: parsed.content_block.name,
              args: ''
            })
          } else if (parsed.type === 'content_block_delta') {
            if (parsed.delta?.type === 'text_delta') {
              fullText += parsed.delta.text
              useAppStore.getState().updateMessageContent(projectId, sessionId, assistantMsgId, fullText)
            } else if (parsed.delta?.type === 'input_json_delta') {
              const idx = parsed.index
              const buf = toolCallBuffers.get(idx)
              if (buf) buf.args += parsed.delta.partial_json
            }
          } else if (parsed.type === 'content_block_stop') {
            const idx = parsed.index
            const buf = toolCallBuffers.get(idx)
            if (buf) {
              try {
                toolCalls.push({ id: buf.id, name: buf.name, arguments: JSON.parse(buf.args || '{}') })
              } catch {
                toolCalls.push({ id: buf.id, name: buf.name, arguments: {} })
              }
              toolCallBuffers.delete(idx)
            }
          }
        } else {
          // OpenAI streaming
          const choice = parsed.choices?.[0]
          if (!choice) continue

          if (choice.delta?.content) {
            fullText += choice.delta.content
            useAppStore.getState().updateMessageContent(projectId, sessionId, assistantMsgId, fullText)
          }

          if (choice.delta?.tool_calls) {
            for (const tc of choice.delta.tool_calls) {
              const idx = tc.index
              if (!toolCallBuffers.has(idx)) {
                toolCallBuffers.set(idx, {
                  id: tc.id || `call_${idx}`,
                  name: tc.function?.name || '',
                  args: ''
                })
              }
              const buf = toolCallBuffers.get(idx)!
              if (tc.function?.name) buf.name = tc.function.name
              if (tc.id) buf.id = tc.id
              if (tc.function?.arguments) buf.args += tc.function.arguments
            }
          }

          if (choice.finish_reason === 'tool_calls') {
            for (const [, buf] of toolCallBuffers) {
              try {
                toolCalls.push({ id: buf.id, name: buf.name, arguments: JSON.parse(buf.args || '{}') })
              } catch {
                toolCalls.push({ id: buf.id, name: buf.name, arguments: {} })
              }
            }
            toolCallBuffers.clear()
          }
        }
      } catch {
        // skip malformed chunks
      }
    }
  }

  // Finalize any remaining tool call buffers (OpenAI without finish_reason)
  if (toolCallBuffers.size > 0 && toolCalls.length === 0) {
    for (const [, buf] of toolCallBuffers) {
      try {
        toolCalls.push({ id: buf.id, name: buf.name, arguments: JSON.parse(buf.args || '{}') })
      } catch {
        toolCalls.push({ id: buf.id, name: buf.name, arguments: {} })
      }
    }
  }

  return { text: fullText, toolCalls }
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
