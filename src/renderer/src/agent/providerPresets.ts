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
    models: [
      model('gpt-4.1', 'GPT-4.1', 'high'),
      model('gpt-4.1-mini', 'GPT-4.1 Mini', 'mid'),
      model('gpt-4.1-nano', 'GPT-4.1 Nano', 'low'),
      model('gpt-4o', 'GPT-4o', 'mid'),
      model('gpt-4o-mini', 'GPT-4o Mini', 'low'),
      model('o4-mini', 'o4-mini (reasoning)', 'high')
    ]
  },
  {
    id: 'anthropic',
    name: 'Anthropic',
    apiFormat: 'claude',
    baseUrl: 'https://api.anthropic.com/v1',
    keyHint: 'console.anthropic.com/settings/keys',
    models: [
      model('claude-opus-4-1-20250805', 'Claude Opus 4.1', 'high'),
      model('claude-sonnet-4-5-20250929', 'Claude Sonnet 4.5', 'mid'),
      model('claude-haiku-4-5-20251001', 'Claude Haiku 4.5', 'low')
    ]
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    apiFormat: 'openai',
    baseUrl: 'https://openrouter.ai/api/v1',
    keyHint: 'openrouter.ai/keys — one key, hundreds of models',
    models: [
      model('openai/gpt-4o', 'GPT-4o (via OpenRouter)', 'mid'),
      model('anthropic/claude-sonnet-4.5', 'Claude Sonnet 4.5 (via OpenRouter)', 'mid'),
      model('deepseek/deepseek-chat', 'DeepSeek Chat (via OpenRouter)', 'mid'),
      model('meta-llama/llama-3.3-70b-instruct', 'Llama 3.3 70B (via OpenRouter)', 'mid'),
      model('google/gemini-2.0-flash-001', 'Gemini 2.0 Flash (via OpenRouter)', 'low')
    ]
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    apiFormat: 'openai',
    baseUrl: 'https://api.deepseek.com/v1',
    keyHint: 'platform.deepseek.com/api_keys',
    models: [
      model('deepseek-chat', 'DeepSeek Chat', 'mid'),
      model('deepseek-reasoner', 'DeepSeek Reasoner', 'high')
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
      model('moonshot-v1-32k', 'Moonshot v1 32K', 'mid'),
      model('moonshot-v1-128k', 'Moonshot v1 128K', 'high')
    ]
  },
  {
    id: 'dashscope',
    name: 'Alibaba Cloud Token Plan (OpenAI)',
    apiFormat: 'openai',
    baseUrl: 'https://token-plan.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1',
    keyHint: 'bailian.console.aliyun.com — Token Plan API-KEY 발급',
    models: [
      model('qwen-turbo', 'Qwen Turbo', 'low'),
      model('qwen-plus', 'Qwen Plus', 'mid'),
      model('qwen-max', 'Qwen Max', 'high')
    ]
  },
  {
    id: 'dashscope-anthropic',
    name: 'Alibaba Cloud Token Plan (Anthropic)',
    apiFormat: 'claude',
    baseUrl: 'https://token-plan.ap-southeast-1.maas.aliyuncs.com/apps/anthropic',
    keyHint: 'bailian.console.aliyun.com — Token Plan API-KEY 발급',
    models: [
      model('qwen-turbo', 'Qwen Turbo', 'low'),
      model('qwen-plus', 'Qwen Plus', 'mid'),
      model('qwen-max', 'Qwen Max', 'high')
    ]
  },
  {
    id: 'google',
    name: 'Google (Gemini)',
    apiFormat: 'openai',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    keyHint: 'aistudio.google.com/apikey',
    models: [
      model('gemini-2.0-flash', 'Gemini 2.0 Flash', 'low'),
      model('gemini-1.5-pro', 'Gemini 1.5 Pro', 'high'),
      model('gemini-1.5-flash', 'Gemini 1.5 Flash', 'low')
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
      model('mixtral-8x7b-32768', 'Mixtral 8x7B (Groq)', 'mid')
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
      model('Qwen/Qwen2.5-72B-Instruct-Turbo', 'Qwen 2.5 72B (Together)', 'mid')
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
      model('mistral-small-latest', 'Mistral Small', 'low')
    ]
  },
  {
    id: 'xai',
    name: 'xAI (Grok)',
    apiFormat: 'openai',
    baseUrl: 'https://api.x.ai/v1',
    keyHint: 'console.x.ai — API Keys',
    models: [
      model('grok-3', 'Grok 3', 'high'),
      model('grok-3-mini', 'Grok 3 Mini', 'low')
    ]
  },
  {
    id: 'perplexity',
    name: 'Perplexity',
    apiFormat: 'openai',
    baseUrl: 'https://api.perplexity.ai',
    keyHint: 'perplexity.ai/settings/api',
    models: [
      model('sonar', 'Sonar', 'mid'),
      model('sonar-pro', 'Sonar Pro', 'high')
    ]
  },
  {
    id: 'ollama',
    name: 'Ollama (local)',
    apiFormat: 'openai',
    baseUrl: 'http://localhost:11434/v1',
    keyHint: '로컬 실행 — API 키 불필요, Ollama가 떠 있어야 함',
    localNoKey: true,
    models: [
      { modelId: 'llama3.3', label: 'Llama 3.3 (local)', tier: 'mid' },
      { modelId: 'qwen2.5', label: 'Qwen 2.5 (local)', tier: 'mid' },
      { modelId: 'deepseek-r1', label: 'DeepSeek R1 (local)', tier: 'high' }
    ]
  },
  {
    id: 'lmstudio',
    name: 'LM Studio (local)',
    apiFormat: 'openai',
    baseUrl: 'http://localhost:1234/v1',
    keyHint: '로컬 실행 — API 키 불필요, LM Studio 서버가 떠 있어야 함',
    localNoKey: true,
    models: [{ modelId: 'local-model', label: 'Loaded model (local)', tier: 'mid' }]
  }
]
