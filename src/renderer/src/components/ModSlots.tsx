import { useShallow } from 'zustand/react/shallow'
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
