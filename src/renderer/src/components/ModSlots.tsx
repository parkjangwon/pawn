import { memo, useEffect, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import {
  EMPTY_DECOR,
  cachedMessageDecor,
  messageDecorations,
  type MessageDecor
} from '../agent/mods/messageRender'
import { eventMatchesShortcut, shortcutAllowsTyping } from '../agent/mods/shortcuts'
import { eventMatchesCombo, useKeybindingsStore } from '../stores/keybindings'
import { pressModSlot } from '../agent/mods/modUiEmit'
import { useModsUiStore } from '../agent/mods/uiStore'
import type { ModSlotKind, ModSlotView } from '../agent/mods/types'
import ModTree from './ModTree'
import './ModSlots.css'

/** Settings key for a mod page: `${plugin}\0${id}`. */
export function modSettingsKey(slot: Pick<ModSlotView, 'plugin' | 'id'>): string {
  return `${slot.plugin}\0${slot.id}`
}

function useSlots(...kinds: ModSlotKind[]): ModSlotView[] {
  return useModsUiStore(useShallow((s) => s.slots.filter((slot) => kinds.includes(slot.slot))))
}

/** Collapsible mod sections at the bottom of the left sidebar. */
export function ModSidebarSlots(): React.JSX.Element | null {
  const slots = useSlots('sidebar', 'panel')
  const toggle = useModsUiStore((s) => s.toggleSidebar)
  if (slots.length === 0) return null
  return (
    <div className="mod-slot-sidebar-list">
      {slots.map((slot) => (
        <section
          key={`${slot.plugin}/${slot.slot}/${slot.id}`}
          className="mod-slot-sidebar"
          data-plugin={slot.plugin}
        >
          <button
            type="button"
            className="mod-slot-sidebar-title"
            aria-expanded={!slot.collapsed}
            title={`${slot.title} (${slot.plugin})`}
            onClick={() => toggle(slot.plugin, slot.id)}
          >
            <span className="mod-slot-caret" aria-hidden>
              {slot.collapsed ? '▸' : '▾'}
            </span>
            <span className="mod-slot-sidebar-name">{slot.title}</span>
          </button>
          {!slot.collapsed && slot.tree != null && (
            <div className="mod-slot-sidebar-body">
              <ModTree tree={slot.tree} plugin={slot.plugin} slot="sidebar" />
            </div>
          )}
        </section>
      ))}
    </div>
  )
}

/** Mod buttons in the chat header's right group. */
export function ModHeaderSlots(): React.JSX.Element | null {
  const slots = useSlots('header')
  if (slots.length === 0) return null
  return (
    <div className="chat-header-action-group mod-slot-header-group">
      {slots.map((slot) => (
        <button
          key={`${slot.plugin}/${slot.id}`}
          type="button"
          className="chat-header-btn mod-slot-header"
          title={`${slot.title} (${slot.plugin})`}
          onClick={() => void pressModSlot(slot.plugin, slot.id, 'header')}
        >
          {slot.label || slot.id}
        </button>
      ))}
    </div>
  )
}

/** Mod buttons in the composer toolbar row. Hidden on the empty home screen. */
export function ModToolbarSlots({ hidden }: { hidden?: boolean }): React.JSX.Element | null {
  const slots = useSlots('toolbar')
  if (hidden || slots.length === 0) return null
  return (
    <div className="mod-slot-toolbar-group">
      {slots.map((slot) => (
        <button
          key={`${slot.plugin}/${slot.id}`}
          type="button"
          className="mod-slot-toolbar"
          title={`${slot.title} (${slot.plugin})`}
          onClick={() => void pressModSlot(slot.plugin, slot.id, 'toolbar')}
        >
          {slot.label || slot.id}
        </button>
      ))}
    </div>
  )
}

/** Mod status items: a row in the sidebar footer, above Settings (the app has no visible status bar). */
export function ModStatusbarSlots(): React.JSX.Element | null {
  const slots = useSlots('statusbar')
  if (slots.length === 0) return null
  return (
    <div className="mod-slot-status-row" aria-label="Mod status">
      {slots.map((slot) =>
        slot.tree != null ? (
          <span
            key={`${slot.plugin}/${slot.id}`}
            className="mod-slot-status"
            title={`${slot.title} (${slot.plugin})`}
          >
            <ModTree tree={slot.tree} plugin={slot.plugin} slot="statusbar" />
          </span>
        ) : (
          <button
            key={`${slot.plugin}/${slot.id}`}
            type="button"
            className="mod-slot-status mod-slot-status-btn"
            title={`${slot.title} (${slot.plugin})`}
            onClick={() => void pressModSlot(slot.plugin, slot.id, 'statusbar')}
          >
            {slot.text ?? slot.title}
          </button>
        )
      )}
    </div>
  )
}

/** "Mods" group in the Settings nav: one entry per mod page. */
export function ModSettingsNav(): React.JSX.Element | null {
  const slots = useSlots('settings')
  const active = useModsUiStore((s) => s.activeSettingsKey)
  const setActive = useModsUiStore((s) => s.setActiveSettingsKey)
  if (slots.length === 0) return null
  return (
    <div className="settings-nav-group mod-slot-settings-nav">
      <div className="settings-nav-label">{'Mods'}</div>
      {slots.map((slot) => {
        const key = modSettingsKey(slot)
        return (
          <button
            key={key}
            type="button"
            className={`settings-nav-item ${active === key ? 'active' : ''}`}
            onClick={() => setActive(key)}
          >
            <span className="mod-slot-settings-name">{slot.title}</span>
            <small className="mod-slot-settings-plugin">{slot.plugin}</small>
          </button>
        )
      })}
    </div>
  )
}

/** Body of the selected mod settings page, or null. */
export function ModSettingsPage(): React.JSX.Element | null {
  const slot = useModsUiStore(
    (s) => s.slots.find((x) => x.slot === 'settings' && modSettingsKey(x) === s.activeSettingsKey) || null
  )
  if (!slot) return null
  return (
    <div className="settings-section mod-slot-settings-page" data-plugin={slot.plugin}>
      <h2>{slot.title}</h2>
      <p className="mod-slot-settings-owner">{slot.plugin}</p>
      <div className="mod-slot-settings-body">
        <ModTree tree={slot.tree} plugin={slot.plugin} slot="settings" />
      </div>
    </div>
  )
}

/** Command palette entries from mods (`$.slot.palette`). */
export function useModPaletteSlots(): ModSlotView[] {
  return useSlots('palette')
}

/**
 * Global keydown for `$.slot.shortcut`. App keybindings always win: a chord
 * the app owns never reaches a mod, even if the user rebinds after the mod
 * registered (registration itself already refuses conflicts).
 */
export function ModShortcutListener(): null {
  const slots = useSlots('shortcut')
  useEffect(() => {
    if (slots.length === 0) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.defaultPrevented || e.isComposing) return
      const bindings = useKeybindingsStore.getState().bindings
      for (const combo of Object.values(bindings)) {
        if (combo && eventMatchesCombo(combo, e)) return
      }
      const target = e.target as HTMLElement | null
      const typing =
        !!target &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
      for (const slot of slots) {
        if (!slot.keys) continue
        if (typing && !shortcutAllowsTyping(slot.keys)) continue
        if (!eventMatchesShortcut(slot.keys, e)) continue
        e.preventDefault()
        void pressModSlot(slot.plugin, slot.id, 'shortcut', { keys: slot.keys })
        return
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [slots])
  return null
}

/** Badges, actions and blocks a mod added to one finished message. */
export const ModMessageDecor = memo(function ModMessageDecor({
  messageId,
  role,
  text,
  sessionId
}: {
  messageId: string
  role: string
  text: string
  sessionId: string
}): React.JSX.Element | null {
  const generation = useModsUiStore((s) => s.renderGeneration)
  const runtimeGeneration = useModsUiStore((s) => s.runtimeGeneration)
  const input = { messageId, role, text, sessionId, generation, runtimeGeneration }
  const [decor, setDecor] = useState<MessageDecor>(() => cachedMessageDecor(input) || EMPTY_DECOR)
  useEffect(() => {
    let alive = true
    void messageDecorations({ messageId, role, text, sessionId, generation, runtimeGeneration }).then(
      (d) => {
        if (alive) setDecor(d)
      }
    )
    return () => {
      alive = false
    }
  }, [messageId, role, text, sessionId, generation, runtimeGeneration])
  if (decor === EMPTY_DECOR) return null
  const { badges, actions, blocks } = decor
  if (!badges.length && !actions.length && !blocks.length) return null
  return (
    <div className="mod-msg-decor" data-testid="mod-message-decor">
      {badges.length > 0 && (
        <div className="mod-msg-badges">
          {badges.map((b) => (
            <span
              key={`${b.plugin}/${b.id}`}
              className={`mod-msg-badge${b.tone ? ` tone-${b.tone}` : ''}`}
              title={`${b.text} (${b.plugin})`}
              data-plugin={b.plugin}
            >
              {b.text}
            </span>
          ))}
        </div>
      )}
      {blocks.map((b) => (
        <div key={`${b.plugin}/${b.id}`} className="mod-msg-block" data-plugin={b.plugin}>
          <ModTree tree={b.tree} plugin={b.plugin} slot="message" />
        </div>
      ))}
      {actions.length > 0 && (
        <div className="mod-msg-actions">
          {actions.map((a) => (
            <button
              key={`${a.plugin}/${a.id}`}
              type="button"
              className="message-action-btn mod-msg-action"
              title={`${a.label} (${a.plugin})`}
              onClick={() =>
                void pressModSlot(a.plugin, a.id, 'message', { messageId, sessionId, role })
              }
            >
              {a.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
})
