/**
 * Built-in presets for well-known LLM API providers, so registering one is just
 * "pick it, paste the API key" instead of hand-typing a base URL and model ids.
 * The fully-custom path (arbitrary name / OpenAI-or-Claude wire format / base URL)
 * stays available in the UI unchanged — this is an additional shortcut, not a
 * replacement.
 *
 * Every preset speaks either the OpenAI or the Anthropic wire format at its base
 * URL; that is the same assumption the app already makes for custom providers,
 * and it happens to be true for nearly every hosted LLM API today, including the
 * ones that are not OpenAI or Anthropic themselves (they publish an
 * OpenAI-compatible `/chat/completions` endpoint specifically so existing tooling
 * works unmodified).
 */

import { guessPricing } from '../types/provider'
import type { ApiFormat, ModelTier } from '../types/provider'

export interface PresetModel {
  modelId: string
  label: string
  tier: ModelTier
}

export interface ProviderPreset {
  id: string
  name: string
  apiFormat: ApiFormat
  baseUrl: string
  /** Shown in the picker so the user knows where to get a key. */
  keyHint: string
  /** Localized variant of keyHint; wins over keyHint when present. */
  keyHintKey?: string
  /** True for a local server with no real key requirement (Ollama, LM Studio). */
  localNoKey?: boolean
  models: PresetModel[]
}

function model(modelId: string, label?: string, tierOverride?: ModelTier): PresetModel {
  const guess = guessPricing(modelId)
  return { modelId, label: label || modelId, tier: tierOverride || guess?.tier || 'mid' }
}

export const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    id: 'openai',
    name: 'OpenAI',
    apiFormat: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    keyHint: 'platform.openai.com/api-keys',
    // https://developers.openai.com/api/docs/models (2026-08)
    models: [
      model('gpt-5.6-sol', 'GPT-5.6 Sol', 'high'),
      model('gpt-5.6-terra', 'GPT-5.6 Terra', 'mid'),
      model('gpt-5.6-luna', 'GPT-5.6 Luna', 'low')
    ]
  },
  {
    id: 'anthropic',
    name: 'Anthropic',
    apiFormat: 'claude',
    baseUrl: 'https://api.anthropic.com/v1',
    keyHint: 'console.anthropic.com/settings/keys',
    // https://platform.claude.com/docs/en/about-claude/models/overview (2026-08)
    models: [
      model('claude-fable-5', 'Claude Fable 5', 'high'),
      model('claude-opus-5', 'Claude Opus 5', 'high'),
      model('claude-sonnet-5', 'Claude Sonnet 5', 'mid'),
      model('claude-haiku-4-5', 'Claude Haiku 4.5', 'low')
    ]
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    apiFormat: 'openai',
    baseUrl: 'https://openrouter.ai/api/v1',
    keyHint: 'openrouter.ai/keys — one key, hundreds of models',
    models: [
      model('openai/gpt-5.6-terra', 'GPT-5.6 Terra (via OpenRouter)', 'mid'),
      model('anthropic/claude-sonnet-5', 'Claude Sonnet 5 (via OpenRouter)', 'mid'),
      model('google/gemini-3.6-flash', 'Gemini 3.6 Flash (via OpenRouter)', 'mid'),
      model('google/gemini-2.5-pro', 'Gemini 2.5 Pro (via OpenRouter)', 'high'),
      model('deepseek/deepseek-v4-flash', 'DeepSeek V4 Flash (via OpenRouter)', 'mid'),
      model('x-ai/grok-4.5', 'Grok 4.5 (via OpenRouter)', 'high')
    ]
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    apiFormat: 'openai',
    // Official OpenAI-compatible endpoint (Chat Completions + tools + thinking).
    // https://api-docs.deepseek.com/  base also supports Anthropic path at /anthropic
    baseUrl: 'https://api.deepseek.com',
    keyHint: 'platform.deepseek.com/api_keys',
    // Pricing: https://api-docs.deepseek.com/quick_start/pricing/ (2026-08)
    // Flash: $0.14/$0.28 · hit $0.0028 | Pro: $0.435/$0.87 · hit $0.003625 (per 1M)
    // Disk context cache is automatic — keep system/preamble prefix stable.
    // Thinking + tools: must echo reasoning_content (see deepseekCompat.ts).
    // Auto effort: simple→non-think, medium→low/high, complex→high/max.
    models: [
      model('deepseek-v4-flash', 'DeepSeek V4 Flash (agent default)', 'mid'),
      model('deepseek-v4-pro', 'DeepSeek V4 Pro (hard tasks)', 'high')
    ]
  },
  {
    id: 'moonshot',
    name: 'Moonshot AI (Kimi)',
    apiFormat: 'openai',
    baseUrl: 'https://api.moonshot.cn/v1',
    keyHint: 'platform.moonshot.cn/console/api-keys',
    models: [
      model('kimi-k2-0711-preview', 'Kimi K2', 'mid'),
      model('moonshot-v1-128k', 'Moonshot v1 128K', 'high'),
      model('moonshot-v1-32k', 'Moonshot v1 32K', 'mid')
    ]
  },
  {
    id: 'dashscope',
    name: 'Alibaba Cloud Token Plan (OpenAI)',
    apiFormat: 'openai',
    baseUrl: 'https://token-plan.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1',
    keyHint: 'bailian.console.aliyun.com',
    keyHintKey: 'settings.providerSection.hintBailian',
    models: [
      model('qwen-max', 'Qwen Max', 'high'),
      model('qwen-plus', 'Qwen Plus', 'mid'),
      model('qwen-turbo', 'Qwen Turbo', 'low')
    ]
  },
  {
    id: 'dashscope-anthropic',
    name: 'Alibaba Cloud Token Plan (Anthropic)',
    apiFormat: 'claude',
    baseUrl: 'https://token-plan.ap-southeast-1.maas.aliyuncs.com/apps/anthropic',
    keyHint: 'bailian.console.aliyun.com',
    keyHintKey: 'settings.providerSection.hintBailian',
    models: [
      model('qwen-max', 'Qwen Max', 'high'),
      model('qwen-plus', 'Qwen Plus', 'mid'),
      model('qwen-turbo', 'Qwen Turbo', 'low')
    ]
  },
  {
    id: 'google',
    name: 'Google (Gemini)',
    apiFormat: 'openai',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    keyHint: 'aistudio.google.com/apikey',
    // Chat/agent models only (not image-gen, Live, TTS, embeddings).
    // https://ai.google.dev/gemini-api/docs/models (2026-08)
    models: [
      model('gemini-3.1-pro-preview', 'Gemini 3.1 Pro (preview)', 'high'),
      model('gemini-3.6-flash', 'Gemini 3.6 Flash', 'mid'),
      model('gemini-3.5-flash', 'Gemini 3.5 Flash', 'mid'),
      model('gemini-3.5-flash-lite', 'Gemini 3.5 Flash-Lite', 'low'),
      model('gemini-2.5-pro', 'Gemini 2.5 Pro', 'high'),
      model('gemini-2.5-flash', 'Gemini 2.5 Flash', 'mid'),
      model('gemini-2.5-flash-lite', 'Gemini 2.5 Flash-Lite', 'low')
    ]
  },
  {
    id: 'groq',
    name: 'Groq',
    apiFormat: 'openai',
    baseUrl: 'https://api.groq.com/openai/v1',
    keyHint: 'console.groq.com/keys — very low latency inference',
    models: [
      model('llama-3.3-70b-versatile', 'Llama 3.3 70B (Groq)', 'mid'),
      model('llama-3.1-8b-instant', 'Llama 3.1 8B (Groq)', 'low'),
      model('qwen/qwen3-32b', 'Qwen3 32B (Groq)', 'mid')
    ]
  },
  {
    id: 'together',
    name: 'Together AI',
    apiFormat: 'openai',
    baseUrl: 'https://api.together.xyz/v1',
    keyHint: 'api.together.ai/settings/api-keys',
    models: [
      model('meta-llama/Llama-3.3-70B-Instruct-Turbo', 'Llama 3.3 70B (Together)', 'mid'),
      model('deepseek-ai/DeepSeek-V3', 'DeepSeek V3 (Together)', 'mid'),
      model('Qwen/Qwen3-235B-A22B-Instruct-Turbo', 'Qwen3 235B (Together)', 'high')
    ]
  },
  {
    id: 'mistral',
    name: 'Mistral AI',
    apiFormat: 'openai',
    baseUrl: 'https://api.mistral.ai/v1',
    keyHint: 'console.mistral.ai/api-keys',
    models: [
      model('mistral-large-latest', 'Mistral Large', 'high'),
      model('mistral-medium-latest', 'Mistral Medium', 'mid'),
      model('mistral-small-latest', 'Mistral Small', 'low'),
      model('codestral-latest', 'Codestral', 'mid')
    ]
  },
  {
    id: 'xai',
    name: 'xAI (Grok)',
    apiFormat: 'openai',
    baseUrl: 'https://api.x.ai/v1',
    keyHint: 'console.x.ai — API Keys',
    // https://docs.x.ai/developers/models (2026-08)
    models: [
      model('grok-4.5', 'Grok 4.5', 'high'),
      model('grok-4.3', 'Grok 4.3', 'mid'),
      model('grok-build-0.1', 'Grok Build', 'mid')
    ]
  },
  {
    id: 'perplexity',
    name: 'Perplexity',
    apiFormat: 'openai',
    baseUrl: 'https://api.perplexity.ai',
    keyHint: 'perplexity.ai/settings/api',
    models: [
      model('sonar-pro', 'Sonar Pro', 'high'),
      model('sonar', 'Sonar', 'mid'),
      model('sonar-reasoning-pro', 'Sonar Reasoning Pro', 'high')
    ]
  },
  {
    id: 'ollama',
    name: 'Ollama (local)',
    apiFormat: 'openai',
    baseUrl: 'http://localhost:11434/v1',
    keyHint: 'Ollama',
    keyHintKey: 'settings.providerSection.hintOllama',
    localNoKey: true,
    models: [
      { modelId: 'llama3.3', label: 'Llama 3.3 (local)', tier: 'mid' },
      { modelId: 'qwen3', label: 'Qwen3 (local)', tier: 'mid' },
      { modelId: 'deepseek-r1', label: 'DeepSeek R1 (local)', tier: 'high' }
    ]
  },
  {
    id: 'lmstudio',
    name: 'LM Studio (local)',
    apiFormat: 'openai',
    baseUrl: 'http://localhost:1234/v1',
    keyHint: 'LM Studio',
    keyHintKey: 'settings.providerSection.hintLmStudio',
    localNoKey: true,
    models: [{ modelId: 'local-model', label: 'Loaded model (local)', tier: 'mid' }]
  }
]
