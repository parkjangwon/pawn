import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

interface WikiGraphProps {
  graph: WikiGraphDto
  selected: string | null
  onSelect: (slug: string) => void
}

interface SimNode {
  id: string
  title: string
  degree: number
  x: number
  y: number
  vx: number
  vy: number
  pinned: boolean
}

interface ViewTransform {
  /** Screen-space pan offset, world origin at canvas center. */
  x: number
  y: number
  /** Zoom factor; 1 fits the default world scale. */
  k: number
}

const NODE_REPULSION = 4200
const SPRING_LENGTH = 130
const SPRING_K = 0.02
const GRAVITY = 0.015
const DAMPING = 0.85
const MAX_SPEED = 10
const MIN_ZOOM = 0.25
const MAX_ZOOM = 4
const WHEEL_FACTOR = 0.0022

function cssVar(name: string, fallback: string): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return v || fallback
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + '…' : s
}

function clampZoom(k: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, k))
}

/**
 * The wiki's front door: a living force-directed map of how pages link to
 * each other. Canvas-based, no deps. Wheel or pinch zooms toward the cursor,
 * dragging empty space pans, nodes drag, double-click pins a node (empty
 * space resets the view), hover/select lights up the neighborhood.
 */
export default function WikiGraph({ graph, selected, onSelect }: WikiGraphProps): React.JSX.Element {
  const { t } = useTranslation()
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const nodesRef = useRef<SimNode[]>([])
  const posRef = useRef<Map<string, SimNode>>(new Map())
  const alphaRef = useRef(1)
  const rafRef = useRef(0)
  const hoverRef = useRef<string | null>(null)
  const dragRef = useRef<{ id: string; moved: boolean } | null>(null)
  const adjRef = useRef<Map<string, Set<string>>>(new Map())
  const viewRef = useRef<ViewTransform>({ x: 0, y: 0, k: 1 })
  const userMovedViewRef = useRef(false)
  const fitPendingRef = useRef(true)
  const pointersRef = useRef<Map<number, { x: number; y: number }>>(new Map())
  const pinchRef = useRef<{ dist: number; mid: { x: number; y: number }; view: ViewTransform } | null>(null)
  const panRef = useRef<{ x: number; y: number; view: ViewTransform } | null>(null)
  const [showEmpty, setShowEmpty] = useState(false)

  const energize = useCallback((a = 0.35): void => {
    alphaRef.current = Math.max(alphaRef.current, a)
  }, [])

  // (Re)seed simulation when graph data changes, keeping prior positions so
  // incremental refreshes rearrange instead of scrambling.
  useEffect(() => {
    setShowEmpty(graph.nodes.length === 0)
    const next = new Map<string, SimNode>()
    const n = graph.nodes.length
    const R = Math.min(340, 70 + n * 4)
    graph.nodes.forEach((node, i) => {
      const prev = posRef.current.get(node.id)
      const angle = (i / Math.max(n, 1)) * Math.PI * 2 - Math.PI / 2
      next.set(node.id, {
        id: node.id,
        title: node.title,
        degree: node.degree,
        x: prev?.x ?? Math.cos(angle) * R,
        y: prev?.y ?? Math.sin(angle) * R,
        vx: 0,
        vy: 0,
        pinned: prev?.pinned ?? false
      })
    })
    posRef.current = next
    nodesRef.current = Array.from(next.values())
    const adj = new Map<string, Set<string>>()
    for (const node of nodesRef.current) adj.set(node.id, new Set())
    for (const e of graph.edges) {
      adj.get(e.source)?.add(e.target)
      adj.get(e.target)?.add(e.source)
    }
    adjRef.current = adj
    fitPendingRef.current = true
    energize(1)
  }, [graph, energize])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const inkMuted = cssVar('--text-muted', '#888')
    const ink = cssVar('--text-primary', '#222')
    const accent = cssVar('--primary', '#f54e00')
    const line = cssVar('--border-color', '#ddd')
    const accentSoft = cssVar('--accent-subtle', 'rgba(0,0,0,0.05)')

    const dpr = Math.max(1, window.devicePixelRatio || 1)
    const resize = (): void => {
      const rect = canvas.getBoundingClientRect()
      canvas.width = Math.max(1, Math.floor(rect.width * dpr))
      canvas.height = Math.max(1, Math.floor(rect.height * dpr))
    }
    resize()
    const observer = new ResizeObserver(resize)
    observer.observe(canvas)

    const step = (): void => {
      const nodes = nodesRef.current
      const alpha = alphaRef.current
      // Large graphs need stronger repulsion and softer gravity to spread out.
      const spread = 0.7 + nodes.length / 45
      const gravity = nodes.length > 40 ? GRAVITY * 0.65 : GRAVITY
      for (let i = 0; i < nodes.length; i++) {
        const a = nodes[i]
        for (let j = i + 1; j < nodes.length; j++) {
          const b = nodes[j]
          let dx = b.x - a.x
          let dy = b.y - a.y
          let d2 = dx * dx + dy * dy
          if (d2 < 1) {
            dx = Math.random() - 0.5
            dy = Math.random() - 0.5
            d2 = dx * dx + dy * dy
          }
          const f = (NODE_REPULSION * spread * alpha) / d2
          const d = Math.sqrt(d2)
          const fx = (dx / d) * f
          const fy = (dy / d) * f
          a.vx -= fx
          a.vy -= fy
          b.vx += fx
          b.vy += fy
        }
      }
      for (const edge of graph.edges) {
        const a = posRef.current.get(edge.source)
        const b = posRef.current.get(edge.target)
        if (!a || !b) continue
        const dx = b.x - a.x
        const dy = b.y - a.y
        const d = Math.sqrt(dx * dx + dy * dy) || 1
        const f = (d - SPRING_LENGTH) * SPRING_K * alpha
        const fx = (dx / d) * f
        const fy = (dy / d) * f
        a.vx += fx
        a.vy += fy
        b.vx -= fx
        b.vy -= fy
      }
      for (const node of nodes) {
        if (dragRef.current?.id === node.id || node.pinned) {
          node.vx = 0
          node.vy = 0
          continue
        }
        node.vx -= node.x * gravity * alpha
        node.vy -= node.y * gravity * alpha
        node.vx *= DAMPING
        node.vy *= DAMPING
        const sp = Math.sqrt(node.vx * node.vx + node.vy * node.vy)
        if (sp > MAX_SPEED) {
          node.vx = (node.vx / sp) * MAX_SPEED
          node.vy = (node.vy / sp) * MAX_SPEED
        }
        node.x += node.vx
        node.y += node.vy
      }
      alphaRef.current = Math.max(0.015, alpha * 0.99)
    }

    /** Fit the node bounding box into the canvas (first render of a graph). */
    const fitView = (): void => {
      const nodes = nodesRef.current
      if (!nodes.length) return
      const w = canvas.width / dpr
      const h = canvas.height / dpr
      let minX = Infinity
      let minY = Infinity
      let maxX = -Infinity
      let maxY = -Infinity
      for (const node of nodes) {
        minX = Math.min(minX, node.x)
        maxX = Math.max(maxX, node.x)
        minY = Math.min(minY, node.y)
        maxY = Math.max(maxY, node.y)
      }
      const bw = Math.max(maxX - minX, 120) + 140
      const bh = Math.max(maxY - minY, 120) + 140
      const k = clampZoom(Math.min(w / bw, h / bh))
      // Center the bbox midpoint on the canvas center.
      viewRef.current = {
        k,
        x: -((minX + maxX) / 2) * k,
        y: -((minY + maxY) / 2) * k
      }
    }

    const draw = (): void => {
      const w = canvas.width / dpr
      const h = canvas.height / dpr
      const cx = w / 2
      const cy = h / 2
      const view = viewRef.current
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, w, h)
      ctx.save()
      ctx.translate(cx + view.x, cy + view.y)
      ctx.scale(view.k, view.k)

      const focus = dragRef.current?.id || hoverRef.current || selected
      const neighbors = focus ? adjRef.current.get(focus) : undefined

      const nodeAlpha = (id: string): number => {
        if (!focus || focus === id) return 1
        return neighbors?.has(id) ? 0.95 : 0.22
      }
      // Labels stay a constant screen size; only their opacity scales.
      const labelScale = Math.min(Math.max(view.k, 0.7), 2)
      const labelFont = 11 / labelScale

      for (const edge of graph.edges) {
        const a = posRef.current.get(edge.source)
        const b = posRef.current.get(edge.target)
        if (!a || !b) continue
        const hot = !!focus && (edge.source === focus || edge.target === focus)
        const dimmed = !!focus && !hot
        ctx.strokeStyle = hot ? accent : line
        ctx.globalAlpha = dimmed ? 0.15 : hot ? 0.9 : 0.55
        ctx.lineWidth = (hot ? 2 : 1) / view.k
        ctx.beginPath()
        ctx.moveTo(a.x, a.y)
        ctx.lineTo(b.x, b.y)
        ctx.stroke()
      }
      ctx.globalAlpha = 1

      ctx.textAlign = 'center'
      const fontFamily = getComputedStyle(canvas).fontFamily
      for (const node of nodesRef.current) {
        const r = Math.max(5 + Math.min(node.degree, 8) * 1.4, 3 / view.k)
        const x = node.x
        const y = node.y
        const a = nodeAlpha(node.id)
        const isFocus = focus === node.id

        if (isFocus) {
          ctx.beginPath()
          ctx.arc(x, y, r + 7, 0, Math.PI * 2)
          ctx.fillStyle = accentSoft
          ctx.fill()
        }
        ctx.globalAlpha = a
        ctx.beginPath()
        ctx.arc(x, y, isFocus ? r + 1.5 : r, 0, Math.PI * 2)
        ctx.fillStyle = isFocus ? accent : ink
        ctx.fill()
        ctx.globalAlpha = a * (isFocus ? 1 : view.k < 0.55 ? 0.4 : 0.75)
        ctx.fillStyle = isFocus ? ink : inkMuted
        ctx.font = (isFocus ? '600 ' : '') + labelFont + 'px ' + fontFamily
        ctx.fillText(truncate(node.title, 22), x, y + r + 6 + labelFont)
        ctx.globalAlpha = 1
      }
      ctx.restore()
    }

    const tick = (): void => {
      if (fitPendingRef.current) {
        fitView()
        fitPendingRef.current = false
      }
      // The simulation never fully sleeps: a low alpha floor keeps clusters
      // breathing; interactions re-energize it.
      if (alphaRef.current > 0.015) step()
      draw()
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)

    const toWorld = (mx: number, my: number): { x: number; y: number } => {
      const view = viewRef.current
      const cx = canvas.width / dpr / 2
      const cy = canvas.height / dpr / 2
      return { x: (mx - cx - view.x) / view.k, y: (my - cy - view.y) / view.k }
    }
    const nodeAt = (mx: number, my: number): SimNode | null => {
      const view = viewRef.current
      const p = toWorld(mx, my)
      const pad = 6 / view.k
      for (let i = nodesRef.current.length - 1; i >= 0; i--) {
        const node = nodesRef.current[i]
        const r = Math.max(5 + Math.min(node.degree, 8) * 1.4, 3 / view.k) + pad
        const dx = node.x - p.x
        const dy = node.y - p.y
        if (dx * dx + dy * dy <= r * r) return node
      }
      return null
    }
    const localPoint = (e: PointerEvent | WheelEvent | MouseEvent): { x: number; y: number } => {
      const rect = canvas.getBoundingClientRect()
      return { x: e.clientX - rect.left, y: e.clientY - rect.top }
    }

    // --- Zoom: mouse wheel and trackpad pinch (ctrl+wheel) both work. ---
    const onWheel = (e: WheelEvent): void => {
      e.preventDefault()
      const rect = canvas.getBoundingClientRect()
      const mx = e.clientX - rect.left
      const my = e.clientY - rect.top
      const view = viewRef.current
      let deltaY = e.deltaY
      if (e.deltaMode === 1) deltaY *= 16
      const k = clampZoom(view.k * Math.exp(-deltaY * WHEEL_FACTOR))
      // Keep the world point under the cursor fixed while zooming.
      view.x = mx - ((mx - view.x) / view.k) * k
      view.y = my - ((my - view.y) / view.k) * k
      view.k = k
      userMovedViewRef.current = true
    }

    const onPointerDown = (e: PointerEvent): void => {
      const { x, y } = localPoint(e)
      pointersRef.current.set(e.pointerId, { x, y })
      canvas.setPointerCapture(e.pointerId)
      if (pointersRef.current.size === 2) {
        // Pinch begins: cancel any node drag / pan.
        const pts = Array.from(pointersRef.current.values())
        dragRef.current = null
        panRef.current = null
        pinchRef.current = {
          dist: Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) || 1,
          mid: { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 },
          view: { ...viewRef.current }
        }
        return
      }
      if (pointersRef.current.size > 2) return
      const hit = nodeAt(x, y)
      if (hit) {
        dragRef.current = { id: hit.id, moved: false }
        energize(0.5)
      } else {
        // Empty space: pan the view.
        panRef.current = { x, y, view: { ...viewRef.current } }
        canvas.style.cursor = 'grabbing'
      }
    }
    const onPointerMove = (e: PointerEvent): void => {
      const { x, y } = localPoint(e)
      if (pointersRef.current.has(e.pointerId)) pointersRef.current.set(e.pointerId, { x, y })

      const pinch = pinchRef.current
      if (pinch && pointersRef.current.size >= 2) {
        const pts = Array.from(pointersRef.current.values())
        const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) || 1
        const mid = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 }
        const k = clampZoom(pinch.view.k * (dist / pinch.dist))
        // The world point under the starting midpoint follows the fingers,
        // combining zoom and pan in one gesture.
        viewRef.current.k = k
        viewRef.current.x = mid.x - (pinch.mid.x - pinch.view.x) * (k / pinch.view.k)
        viewRef.current.y = mid.y - (pinch.mid.y - pinch.view.y) * (k / pinch.view.k)
        userMovedViewRef.current = true
        return
      }
      const pan = panRef.current
      if (pan && !dragRef.current) {
        viewRef.current.x = pan.view.x + (x - pan.x)
        viewRef.current.y = pan.view.y + (y - pan.y)
        userMovedViewRef.current = true
        return
      }
      const dragging = dragRef.current
      if (dragging) {
        const node = posRef.current.get(dragging.id)
        if (node) {
          const p = toWorld(x, y)
          node.x = p.x
          node.y = p.y
          dragging.moved = true
          energize(0.3)
        }
        return
      }
      const hit = nodeAt(x, y)
      if ((hit?.id || null) !== hoverRef.current) {
        hoverRef.current = hit?.id || null
        canvas.style.cursor = hit ? 'grab' : 'default'
        energize(0.08)
      }
    }
    const onPointerUp = (e: PointerEvent): void => {
      pointersRef.current.delete(e.pointerId)
      try {
        canvas.releasePointerCapture(e.pointerId)
      } catch {
        /* already released */
      }
      if (pointersRef.current.size < 2) pinchRef.current = null
      if (pointersRef.current.size === 0) {
        canvas.style.cursor = 'default'
        const dragging = dragRef.current
        dragRef.current = null
        panRef.current = null
        // A click (press + release without moving) on a node selects it.
        if (dragging && !dragging.moved) onSelect(dragging.id)
      }
    }
    const onDoubleClick = (e: MouseEvent): void => {
      const { x, y } = localPoint(e)
      const hit = nodeAt(x, y)
      if (hit) {
        // Double-click toggles a pin so a node holds its place.
        hit.pinned = !hit.pinned
        energize(0.2)
        return
      }
      // Double-click on empty space resets zoom and pan.
      viewRef.current = { x: 0, y: 0, k: 1 }
      fitPendingRef.current = false
      energize(0.1)
    }

    canvas.addEventListener('wheel', onWheel, { passive: false })
    canvas.addEventListener('pointerdown', onPointerDown)
    canvas.addEventListener('pointermove', onPointerMove)
    canvas.addEventListener('pointerup', onPointerUp)
    canvas.addEventListener('pointercancel', onPointerUp)
    canvas.addEventListener('dblclick', onDoubleClick)

    return () => {
      cancelAnimationFrame(rafRef.current)
      observer.disconnect()
      canvas.removeEventListener('wheel', onWheel)
      canvas.removeEventListener('pointerdown', onPointerDown)
      canvas.removeEventListener('pointermove', onPointerMove)
      canvas.removeEventListener('pointerup', onPointerUp)
      canvas.removeEventListener('pointercancel', onPointerUp)
      canvas.removeEventListener('dblclick', onDoubleClick)
    }
  }, [graph, selected, onSelect, energize])

  if (showEmpty) {
    return <div className="settings-empty wiki-graph-empty">{t('settings.wikiSection.empty')}</div>
  }
  return <canvas ref={canvasRef} className="wiki-graph-canvas" />
}
