import { useState } from 'react'
import { getModRuntime } from '../agent/mods'
import { modEventLabel } from '../agent/mods/eventLabel'
import { useModsUiStore } from '../agent/mods/uiStore'
import i18n from '../i18n'

/** Render frozen mod UI trees from $.ui.resolve element constructors. */

export interface ModTreeNode {
  type?: string
  props?: Record<string, unknown>
}

export interface ModTreeProps {
  tree: unknown
  /** Owning plugin — required for Button/Input events. */
  plugin?: string
  /** Pane id when rendering inside an open pane. */
  surfaceId?: string
}

function isNode(v: unknown): v is ModTreeNode {
  return Boolean(v && typeof v === 'object' && ('type' in (v as object) || 'props' in (v as object)))
}

function childrenOf(props: Record<string, unknown> | undefined): unknown[] {
  if (!props) return []
  const c = props.children
  if (Array.isArray(c)) return c
  if (c != null) return [c]
  return []
}

function labelOf(props: Record<string, unknown>, kids: unknown[]): string {
  if (typeof props.text === 'string') return props.text
  if (typeof props.label === 'string') return props.label
  if (typeof props.children === 'string') return props.children
  return ''
}

async function emitUiEvent(
  event: 'ui.press' | 'ui.input' | 'ui.select',
  plugin: string | undefined,
  payload: Record<string, unknown>
): Promise<void> {
  const runtime = getModRuntime()
  await runtime
    .emit(event, { plugin: plugin || '', ...payload }, async (e) => e)
    .catch(() => {})
  const label =
    typeof payload.value === 'string' && payload.value.trim()
      ? payload.value.trim()
      : typeof payload.id === 'string'
        ? payload.id
        : modEventLabel(event)
  const text =
    event === 'ui.input'
      ? i18n.t('chat.mods.timelineInput', { label })
      : event === 'ui.select'
        ? i18n.t('chat.mods.timelineSelect', { label })
        : i18n.t('chat.mods.timelinePress', { label })
  useModsUiStore.getState().pushTimeline(plugin || 'extension', text, 'press')
  useModsUiStore.getState().invalidate()
  void runtime.emitUiRender('AbovePrompt', {}).catch(() => {})
}

export default function ModTree({ tree, plugin, surfaceId }: ModTreeProps): React.JSX.Element | null {
  if (tree == null) return null
  if (typeof tree === 'string' || typeof tree === 'number' || typeof tree === 'boolean') {
    return <span className="mod-tree-text">{String(tree)}</span>
  }
  if (Array.isArray(tree)) {
    return (
      <>
        {tree.map((child, i) => (
          <ModTree key={i} tree={child} plugin={plugin} surfaceId={surfaceId} />
        ))}
      </>
    )
  }
  if (!isNode(tree)) {
    return <span className="mod-tree-text">{JSON.stringify(tree)}</span>
  }

  const type = String(tree.type || 'Box')
  const props = tree.props || {}
  const kids = childrenOf(props)
  const text = labelOf(props, kids)
  const id = typeof props.id === 'string' ? props.id : typeof props.name === 'string' ? props.name : type

  if (type === 'Text' || type === 'Markdown' || type === 'Code') {
    return (
      <span className={`mod-tree-${type.toLowerCase()}`}>
        {text || kids.map((c, i) => <ModTree key={i} tree={c} plugin={plugin} surfaceId={surfaceId} />)}
      </span>
    )
  }
  if (type === 'Link') {
    const href = typeof props.href === 'string' ? props.href : '#'
    return (
      <a className="mod-tree-link" href={href} target="_blank" rel="noreferrer">
        {text || kids.map((c, i) => <ModTree key={i} tree={c} plugin={plugin} surfaceId={surfaceId} />) || href}
      </a>
    )
  }
  if (type === 'Button') {
    return (
      <button
        type="button"
        className="mod-tree-button"
        disabled={props.disabled === true}
        onClick={() => {
          void emitUiEvent('ui.press', plugin, {
            component: 'Button',
            id,
            surfaceId,
            value: text || id
          })
        }}
      >
        {text || kids.map((c, i) => <ModTree key={i} tree={c} plugin={plugin} surfaceId={surfaceId} />) || 'Button'}
      </button>
    )
  }
  if (type === 'Input') {
    const seeded =
      typeof props.value === 'string'
        ? props.value
        : typeof props.defaultValue === 'string'
          ? props.defaultValue
          : ''
    return (
      <ModTreeInput
        key={`${id}:${seeded}`}
        id={id}
        plugin={plugin}
        surfaceId={surfaceId}
        placeholder={typeof props.placeholder === 'string' ? props.placeholder : undefined}
        defaultValue={seeded}
      />
    )
  }
  if (type === 'Select') {
    const options = Array.isArray(props.options)
      ? props.options.map((o) => {
          if (typeof o === 'string') return { value: o, label: o }
          if (o && typeof o === 'object') {
            const row = o as { value?: unknown; label?: unknown }
            const value = String(row.value ?? row.label ?? '')
            return { value, label: String(row.label ?? value) }
          }
          return { value: String(o), label: String(o) }
        })
      : []
    return (
      <select
        className="mod-tree-select"
        defaultValue={typeof props.value === 'string' ? props.value : options[0]?.value}
        onChange={(e) => {
          void emitUiEvent('ui.select', plugin, {
            component: 'Select',
            id,
            surfaceId,
            value: e.target.value
          })
        }}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    )
  }
  return (
    <div className={`mod-tree-box mod-tree-${type.toLowerCase()}`}>
      {text}
      {kids.map((c, i) => (
        <ModTree key={i} tree={c} plugin={plugin} surfaceId={surfaceId} />
      ))}
    </div>
  )
}

function ModTreeInput({
  id,
  plugin,
  surfaceId,
  placeholder,
  defaultValue
}: {
  id: string
  plugin?: string
  surfaceId?: string
  placeholder?: string
  defaultValue: string
}): React.JSX.Element {
  const [value, setValue] = useState(defaultValue)
  return (
    <input
      className="mod-tree-input"
      value={value}
      placeholder={placeholder}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => {
        void emitUiEvent('ui.input', plugin, {
          component: 'Input',
          id,
          surfaceId,
          value
        })
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault()
          void emitUiEvent('ui.input', plugin, {
            component: 'Input',
            id,
            surfaceId,
            value,
            submit: true
          })
        }
      }}
    />
  )
}
