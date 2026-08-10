/**
 * Settings page metadata: section registry + shared types.
 * Extracted from Settings.tsx so the state hook and the view can both import
 * them without a runtime cycle.
 */

export type SettingsSection =
  | 'appearance'
  | 'providers'
  | 'models'
  | 'agent'
  | 'memory'
  | 'hooks'
  | 'subagents'
  | 'plugins'
  | 'mcp'
  | 'connections'
  | 'system'
  | 'shortcuts'
  | 'data'
  | 'usage'
export type SettingsSkillScope = 'all' | 'project' | 'device' | 'builtin'
export type SourceSignalId =
  | 'project-claude'
  | 'project-rules'
  | 'project-plugins'
  | 'user-claude'
  | 'user-skills'
  | 'user-agents'
  | 'user-agents-skills'
export type SettingsDeleteTarget =
  | { type: 'provider'; id: string; name: string }
  | { type: 'model'; id: string; name: string }

export interface SourceSignal {
  id: SourceSignalId
  path: string
  detected: boolean
  details?: string
}

export interface SettingsProps {
  onSidebarWidthChange: (width: number) => void
  canGoBack: boolean
  canGoForward: boolean
  onGoBack: () => void
  onGoForward: () => void
}

export const SECTIONS: { id: SettingsSection; labelKey: string; groupKey: string; icon: string }[] = [
  { id: 'appearance', labelKey: 'settings.appearance', groupKey: 'settings.groups.general', icon: 'M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z' },
  { id: 'providers', labelKey: 'settings.providers', groupKey: 'settings.groups.general', icon: 'M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z' },
  { id: 'models', labelKey: 'settings.models', groupKey: 'settings.groups.general', icon: 'M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z' },
  // Coding: split former mega “Agent” page into focused sections
  { id: 'agent', labelKey: 'settings.agent', groupKey: 'settings.groups.coding', icon: 'M13 10V3L4 14h7v7l9-11h-7z' },
  { id: 'memory', labelKey: 'settings.memory', groupKey: 'settings.groups.coding', icon: 'M12 2a7 7 0 017 7c0 2.38-1.19 4.47-3 5.74V17a2 2 0 01-2 2h-4a2 2 0 01-2-2v-2.26C6.19 13.47 5 11.38 5 9a7 7 0 017-7zm-1 18h2v2h-2v-2z' },
  { id: 'hooks', labelKey: 'settings.hooks', groupKey: 'settings.groups.coding', icon: 'M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71' },
  { id: 'subagents', labelKey: 'settings.subagents', groupKey: 'settings.groups.coding', icon: 'M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2M9 11a4 4 0 100-8 4 4 0 000 8zM23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75' },
  { id: 'plugins', labelKey: 'settings.plugins', groupKey: 'settings.groups.integration', icon: 'M11 4a2 2 0 114 0v1a1 1 0 001 1h3a1 1 0 011 1v3a1 1 0 01-1 1h-1a2 2 0 100 4h1a1 1 0 011 1v3a1 1 0 01-1 1h-3a1 1 0 01-1-1v-1a2 2 0 10-4 0v1a1 1 0 01-1 1H7a1 1 0 01-1-1v-3a1 1 0 00-1-1H4a2 2 0 110-4h1a1 1 0 001-1V7a1 1 0 011-1h3a1 1 0 001-1V4z' },
  { id: 'mcp', labelKey: 'settings.mcp', groupKey: 'settings.groups.integration', icon: 'M20 7H4a2 2 0 00-2 2v1a2 2 0 002 2h16a2 2 0 002-2V9a2 2 0 00-2-2zM6 11h.01M20 15H4a2 2 0 00-2 2v1a2 2 0 002 2h16a2 2 0 002-2v-1a2 2 0 00-2-2zM6 19h.01' },
  { id: 'connections', labelKey: 'settings.connections', groupKey: 'settings.groups.integration', icon: 'M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1' },
  { id: 'system', labelKey: 'settings.system', groupKey: 'settings.groups.system', icon: 'M18 10h-1.26A8 8 0 109 20h9a5 5 0 000-10z' },
  { id: 'shortcuts', labelKey: 'settings.shortcuts', groupKey: 'settings.groups.system', icon: 'M20 4H4a2 2 0 00-2 2v12a2 2 0 002 2h16a2 2 0 002-2V6a2 2 0 00-2-2zM7 8h10M7 12h4' },
  { id: 'data', labelKey: 'settings.data', groupKey: 'settings.groups.general', icon: 'M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4' },
  {
    id: 'usage',
    labelKey: 'settings.usage',
    groupKey: 'settings.groups.general',
    icon: 'M3 3v18h18M7 14l3-3 3 2 5-6'
  },
]
