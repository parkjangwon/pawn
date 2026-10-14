import { useRef, useState } from 'react'
import { emitModUi } from '../agent/mods/modUiEmit'
import Button from './Button'
import Input from './Input'
import Select from './Select'

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
  /** Slot kind stamped onto ui.press / ui.input / ui.select. */
  slot?: string
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

function emitUiEvent(
  event: 'ui.press' | 'ui.input' | 'ui.select',
  plugin: string | undefined,
  payload: Record<string, unknown>,
  slot?: string
): Promise<void> {
  return emitModUi(event, plugin, slot ? { ...payload, slot } : payload)
}

export default function ModTree({ tree, plugin, surfaceId, slot }: ModTreeProps): React.JSX.Element | null {
  if (tree == null) return null
  if (typeof tree === 'string' || typeof tree === 'number' || typeof tree === 'boolean') {
    return <span className="mod-tree-text">{String(tree)}</span>
  }
  if (Array.isArray(tree)) {
    return (
      <>
        {tree.map((child, i) => (
          <ModTree key={i} tree={child} plugin={plugin} surfaceId={surfaceId} slot={slot} />
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
        {text || kids.map((c, i) => <ModTree key={i} tree={c} plugin={plugin} surfaceId={surfaceId} slot={slot} />)}
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
      <Button
        variant="secondary"
        size="sm"
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
      </Button>
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
      <Select
        size="sm"
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
      </Select>
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
  // Enter commits, and the blur that usually follows must not send the same
  // value again (that was two ui.input events and two log lines per edit).
  const sent = useRef(defaultValue)
  const commit = (submit: boolean): void => {
    if (!submit && value === sent.current) return
    sent.current = value
    void emitUiEvent('ui.input', plugin, {
      component: 'Input',
      id,
      surfaceId,
      value,
      ...(submit ? { submit: true } : {})
    })
  }
  return (
    <Input
      size="sm"
      className="mod-tree-input"
      value={value}
      placeholder={placeholder}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => commit(false)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault()
          commit(true)
        }
      }}
    />
  )
}
