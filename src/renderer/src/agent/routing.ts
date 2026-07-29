import { useProviderStore } from '../stores/provider'
import type { ModelEntry } from '../types/provider'

// Auto mode: select the best model based on task complexity
export function selectModelForTask(taskComplexity: 'simple' | 'medium' | 'complex'): ModelEntry | null {
  const { models, routingMode, activeModelId } = useProviderStore.getState()

  // Manual mode: use the explicitly selected model
  if (routingMode === 'manual') {
    if (!activeModelId) return null
    return models.find((m) => m.id === activeModelId && m.enabled) || null
  }

  // Auto mode: pick based on tier
  const enabled = models.filter((m) => m.enabled)
  if (enabled.length === 0) return null

  const tierMap = { simple: 'low', medium: 'mid', complex: 'high' } as const
  const targetTier = tierMap[taskComplexity]

  // Try exact tier match first
  const tierMatch = enabled.find((m) => m.tier === targetTier)
  if (tierMatch) return tierMatch

  // Fallback: for simple tasks try mid, for complex try mid then low
  if (taskComplexity === 'simple') {
    return enabled.find((m) => m.tier === 'mid') || enabled[0]
  }
  if (taskComplexity === 'complex') {
    return enabled.find((m) => m.tier === 'mid') || enabled.find((m) => m.tier === 'low') || enabled[0]
  }

  return enabled[0]
}

// Heuristic: estimate task complexity from user message
export function estimateComplexity(message: string): 'simple' | 'medium' | 'complex' {
  const len = message.length
  const hasCodeBlock = message.includes('```')
  const hasFilePath = /\/[\w.-]+\.\w+/.test(message) || /[\w-]+\.\w{2,4}/.test(message)
  const hasMultiStep = /then|and also|after that|step \d/i.test(message)
  const hasAnalysis = /analyze|review|refactor|architect|debug|investigate/i.test(message)

  let score = 0
  if (len > 200) score++
  if (hasCodeBlock) score++
  if (hasFilePath) score++
  if (hasMultiStep) score++
  if (hasAnalysis) score++

  if (score >= 3) return 'complex'
  if (score >= 1) return 'medium'
  return 'simple'
}
