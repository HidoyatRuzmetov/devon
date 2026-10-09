// SVG drawing and sticky-note overlay. Keep the existing scene/points/appState wire format:
// opening an old canvas must not require a migration or replace another in-flight save.
import * as React from 'react'
import { useT } from '@devon/i18n'
import {
  ArrowRight,
  ChevronDown,
  Circle,
  Eraser,
  GripHorizontal,
  Hand,
  MousePointer2,
  Pencil,
  Plus,
  Redo2,
  Square,
  StickyNote,
  Type,
  Undo2,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react'
import { Button, IconButton, cn } from '@devon/ui'
import type { CanvasElement, Scene, Sticky } from './types.js'

type Tool = 'select' | 'pan' | 'freehand' | 'rectangle' | 'ellipse' | 'arrow' | 'text' | 'eraser'
type Snapshot = { elements: CanvasElement[]; stickies: Sticky[] }
type Point = { x: number; y: number }
type Gesture = {
  pointerId: number
  start: Point
  before: Snapshot
  id: string | null
  captureOwner: Element
  panStart?: { left: number; top: number }
}
const COLORS = ['#1f2937', '#2f6fed', '#147d43', '#a45b04', '#dc2626', '#7c3aed']
const COLOR_NAMES = ['ink', 'blue', 'green', 'orange', 'red', 'purple']
const STICKY_COLORS = ['#fde68a', '#fbcfe8', '#bbf7d0', '#bfdbfe']
const STICKY_COLOR_NAMES = ['yellow', 'pink', 'mint', 'sky']
const CONTENT_W = 2400
const CONTENT_H = 1400

function newId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
}

export function movedElement(element: CanvasElement, dx: number, dy: number): CanvasElement {
  // Persisted freehand points are absolute, rather than relative to x/y.
  return {
    ...element,
    x: element.x + dx,
    y: element.y + dy,
    points: element.points?.map((point) => ({ x: point.x + dx, y: point.y + dy })),
  }
}

export function elementBounds(element: CanvasElement) {
  if (element.type === 'freehand' && element.points?.length) {
    let left = Infinity
    let top = Infinity
    let right = -Infinity
    let bottom = -Infinity
    for (const point of element.points) {
      left = Math.min(left, point.x)
      top = Math.min(top, point.y)
      right = Math.max(right, point.x)
      bottom = Math.max(bottom, point.y)
    }
    return { x: left, y: top, w: right - left, h: bottom - top }
  }
  return {
    x: Math.min(element.x, element.x + element.w),
    y: Math.min(element.y, element.y + element.h),
    w: Math.max(
      Math.abs(element.w),
      element.type === 'text' ? (element.text?.length ?? 1) * 10 : 0,
    ),
    h: Math.abs(element.h),
  }
}

export function CanvasEditor({
  scene,
  stickies: initialStickies,
  onChange,
}: {
  scene: Scene
  stickies: Sticky[]
  onChange: (next: { scene: Scene; stickies: Sticky[] }) => void
}) {
  const t = useT()
  const [elements, setElements] = React.useState<CanvasElement[]>(scene.elements)
  const [stickies, setStickies] = React.useState<Sticky[]>(initialStickies)
  const current = React.useRef<Snapshot>({ elements: scene.elements, stickies: initialStickies })
  const [tool, setTool] = React.useState<Tool>('select')
  const [color, setColor] = React.useState(COLORS[0]!)
  const [strokeWidth, setStrokeWidth] = React.useState(2)
  const [zoom, setZoom] = React.useState(1)
  const [selectedId, setSelectedId] = React.useState<string | null>(null)
  const [editingTextId, setEditingTextId] = React.useState<string | null>(null)
  const [draft, setDraft] = React.useState<CanvasElement | null>(null)
  const [isDragging, setIsDragging] = React.useState(false)
  const draftRef = React.useRef<CanvasElement | null>(null)
  const gesture = React.useRef<Gesture | null>(null)
  const editGroup = React.useRef<{ id: string; recorded: boolean } | null>(null)
  const undoStack = React.useRef<Snapshot[]>([])
  const redoStack = React.useRef<Snapshot[]>([])
  const [, updateHistory] = React.useReducer((n: number) => n + 1, 0)
  const rootRef = React.useRef<HTMLDivElement>(null)
  const surfaceRef = React.useRef<HTMLDivElement>(null)
  const svgRef = React.useRef<SVGSVGElement>(null)
  const textInputRef = React.useRef<HTMLInputElement>(null)
  const hintId = React.useId()
  React.useLayoutEffect(() => {
    if (editingTextId) textInputRef.current?.focus()
  }, [editingTextId])

  const changeRef = React.useRef(onChange)
  React.useLayoutEffect(() => {
    changeRef.current = onChange
  }, [onChange])
  const debouncedSave = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingSave = React.useRef<{ scene: Scene; stickies: Sticky[] } | null>(null)
  React.useEffect(
    () => () => {
      if (debouncedSave.current) clearTimeout(debouncedSave.current)
      const pending = pendingSave.current
      pendingSave.current = null
      if (pending) changeRef.current(pending)
    },
    [],
  )

  function scheduleSave(next: Snapshot) {
    if (debouncedSave.current) clearTimeout(debouncedSave.current)
    pendingSave.current = {
      scene: { elements: next.elements, appState: scene.appState },
      stickies: next.stickies,
    }
    debouncedSave.current = setTimeout(() => {
      debouncedSave.current = null
      const pending = pendingSave.current
      pendingSave.current = null
      if (pending) changeRef.current(pending)
    }, 800)
  }

  function replace(next: Snapshot, save = true) {
    current.current = next
    setElements(next.elements)
    setStickies(next.stickies)
    if (save) scheduleSave(next)
  }

  function pushSnapshot(before = current.current) {
    undoStack.current.push(before)
    if (undoStack.current.length > 50) undoStack.current.shift()
    redoStack.current = []
    updateHistory()
  }

  function change(next: Snapshot) {
    if (JSON.stringify(next) === JSON.stringify(current.current)) return
    pushSnapshot()
    editGroup.current = null
    replace(next)
  }

  function editText(id: string, text: string, sticky = false) {
    if (editGroup.current?.id !== id) editGroup.current = { id, recorded: false }
    const state = current.current
    const old = sticky
      ? state.stickies.find((item) => item.id === id)?.text
      : state.elements.find((item) => item.id === id)?.text
    if (old === text) return
    if (!editGroup.current.recorded) {
      pushSnapshot()
      editGroup.current.recorded = true
    }
    replace(
      sticky
        ? {
            ...state,
            stickies: state.stickies.map((item) => (item.id === id ? { ...item, text } : item)),
          }
        : {
            ...state,
            elements: state.elements.map((item) => (item.id === id ? { ...item, text } : item)),
          },
    )
  }

  function history(direction: 'undo' | 'redo') {
    if (gesture.current || draftRef.current) return
    const source = direction === 'undo' ? undoStack : redoStack
    const destination = direction === 'undo' ? redoStack : undoStack
    const next = source.current.pop()
    if (!next) return
    destination.current.push(current.current)
    editGroup.current = null
    setEditingTextId(null)
    setSelectedId(null)
    replace(next)
    updateHistory()
  }

  function setDrawing(next: CanvasElement | null) {
    draftRef.current = next
    setDraft(next)
  }

  function point(clientX: number, clientY: number): Point {
    const rect = svgRef.current?.getBoundingClientRect()
    return rect
      ? {
          x: Math.max(0, Math.min(CONTENT_W, (clientX - rect.left) / zoom)),
          y: Math.max(0, Math.min(CONTENT_H, (clientY - rect.top) / zoom)),
        }
      : { x: 0, y: 0 }
  }

  function select(id: string | null) {
    setSelectedId(id)
    setTool('select')
    const element = current.current.elements.find((item) => item.id === id)
    if (element) {
      setColor(element.color)
      setStrokeWidth(element.strokeWidth)
    }
  }

  function reveal(id: string) {
    const item =
      current.current.elements.find((element) => element.id === id) ??
      current.current.stickies.find((sticky) => sticky.id === id)
    const surface = surfaceRef.current
    if (!item || !surface) return
    surface.scrollTo({
      left: Math.max(0, item.x * zoom - surface.clientWidth / 3),
      top: Math.max(0, item.y * zoom - surface.clientHeight / 3),
    })
  }

  function addElement(at?: Point) {
    const surface = surfaceRef.current
    const position = at ?? {
      x: Math.min(
        CONTENT_W - 200,
        ((surface?.scrollLeft ?? 0) + Math.min(100, (surface?.clientWidth ?? 200) / 3)) / zoom,
      ),
      y: Math.min(CONTENT_H - 100, ((surface?.scrollTop ?? 0) + 80) / zoom),
    }
    const type = tool === 'select' || tool === 'pan' || tool === 'eraser' ? 'rectangle' : tool
    const element: CanvasElement = {
      id: newId(type),
      type,
      ...position,
      w: 160,
      h: type === 'text' ? 28 : 100,
      color,
      strokeWidth,
      text: type === 'text' ? '' : undefined,
    }
    if (type === 'freehand') {
      // Keyboard drawing: arrows extend the stroke; Enter finishes, Escape cancels.
      setDrawing({ ...element, w: 0, h: 0, points: [position] })
    } else {
      change({ ...current.current, elements: [...current.current.elements, element] })
      select(element.id)
      if (type === 'text') {
        editGroup.current = null
        setEditingTextId(element.id)
      }
    }
    surface?.focus({ preventScroll: true })
  }

  function finishDrawing() {
    const next = draftRef.current
    if (!next) return
    setDrawing(null)
    gesture.current = null
    const useful =
      next.type === 'freehand'
        ? (next.points?.length ?? 0) > 1
        : Math.abs(next.w) + Math.abs(next.h) >= 3
    if (!useful) return
    change({ ...current.current, elements: [...current.current.elements, next] })
    select(next.id)
  }

  function deleteSelected(id = selectedId) {
    if (!id) return
    change({
      elements: current.current.elements.filter((item) => item.id !== id),
      stickies: current.current.stickies.filter((item) => item.id !== id),
    })
    setSelectedId(null)
    setEditingTextId(null)
  }

  function moveSelected(dx: number, dy: number, record = true) {
    const state = current.current
    const element = state.elements.find((item) => item.id === selectedId)
    const sticky = state.stickies.find((item) => item.id === selectedId)
    if (!element && !sticky) return
    const bounds = element ? elementBounds(element) : { ...sticky!, w: 160, h: 130 }
    const x = Math.max(-bounds.x, Math.min(CONTENT_W - bounds.x - bounds.w, dx))
    const y = Math.max(-bounds.y, Math.min(CONTENT_H - bounds.y - bounds.h, dy))
    if (!x && !y) return
    if (record) pushSnapshot()
    replace({
      elements: state.elements.map((item) =>
        item.id === selectedId ? movedElement(item, x, y) : item,
      ),
      stickies: state.stickies.map((item) =>
        item.id === selectedId ? { ...item, x: item.x + x, y: item.y + y } : item,
      ),
    })
    if (selectedId) reveal(selectedId)
  }

  function pointerDown(event: React.PointerEvent<SVGSVGElement>) {
    if (event.button !== 0 || !event.isPrimary || gesture.current || draftRef.current) return
    if (tool === 'pan') {
      const surface = surfaceRef.current
      if (!surface) return
      event.preventDefault()
      event.currentTarget.setPointerCapture(event.pointerId)
      surface.focus({ preventScroll: true })
      gesture.current = {
        pointerId: event.pointerId,
        start: { x: event.clientX, y: event.clientY },
        before: current.current,
        id: null,
        captureOwner: event.currentTarget,
        panStart: { left: surface.scrollLeft, top: surface.scrollTop },
      }
      setIsDragging(true)
      return
    }
    if (tool === 'select' || tool === 'eraser') {
      setSelectedId(null)
      return
    }
    const start = point(event.clientX, event.clientY)
    surfaceRef.current?.focus({ preventScroll: true })
    if (tool === 'text') {
      addElement(start)
      return
    }
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    gesture.current = {
      pointerId: event.pointerId,
      start,
      before: current.current,
      id: null,
      captureOwner: event.currentTarget,
    }
    setDrawing({
      id: newId(tool),
      type: tool,
      ...start,
      w: 0,
      h: 0,
      color,
      strokeWidth,
      points: tool === 'freehand' ? [start] : undefined,
    })
  }

  function startDrag(id: string, event: React.PointerEvent) {
    if (event.button !== 0 || !event.isPrimary || gesture.current || draftRef.current) return
    if (tool === 'eraser') {
      event.stopPropagation()
      deleteSelected(id)
      return
    }
    if (tool !== 'select') return
    event.stopPropagation()
    event.preventDefault()
    select(id)
    surfaceRef.current?.focus({ preventScroll: true })
    event.currentTarget.setPointerCapture(event.pointerId)
    gesture.current = {
      pointerId: event.pointerId,
      start: { x: event.clientX, y: event.clientY },
      before: current.current,
      id,
      captureOwner: event.currentTarget,
    }
    setIsDragging(true)
  }

  function pointerMove(event: React.PointerEvent) {
    const active = gesture.current
    if (!active || active.pointerId !== event.pointerId) return
    if (active.panStart) {
      surfaceRef.current?.scrollTo({
        left: active.panStart.left - event.clientX + active.start.x,
        top: active.panStart.top - event.clientY + active.start.y,
      })
      return
    }
    const drawing = draftRef.current
    if (drawing) {
      const end = point(event.clientX, event.clientY)
      setDrawing(
        drawing.type === 'freehand'
          ? { ...drawing, points: [...(drawing.points ?? []), end] }
          : { ...drawing, w: end.x - drawing.x, h: end.y - drawing.y },
      )
      return
    }
    const dx = (event.clientX - active.start.x) / zoom
    const dy = (event.clientY - active.start.y) / zoom
    const element = active.before.elements.find((item) => item.id === active.id)
    const sticky = active.before.stickies.find((item) => item.id === active.id)
    if (!element && !sticky) return
    const bounds = element ? elementBounds(element) : { ...sticky!, w: 160, h: 130 }
    const x = Math.max(-bounds.x, Math.min(CONTENT_W - bounds.x - bounds.w, dx))
    const y = Math.max(-bounds.y, Math.min(CONTENT_H - bounds.y - bounds.h, dy))
    replace(
      {
        elements: active.before.elements.map((item) =>
          item.id === active.id ? movedElement(item, x, y) : item,
        ),
        stickies: active.before.stickies.map((item) =>
          item.id === active.id ? { ...item, x: item.x + x, y: item.y + y } : item,
        ),
      },
      false,
    )
  }

  function pointerEnd(event: React.PointerEvent, cancel = false) {
    const active = gesture.current
    if (!active || active.pointerId !== event.pointerId) return
    gesture.current = null
    setIsDragging(false)
    if (active.panStart) {
      if (cancel) surfaceRef.current?.scrollTo(active.panStart.left, active.panStart.top)
    } else if (cancel) {
      setDrawing(null)
      replace(active.before, false)
    } else if (draftRef.current) finishDrawing()
    else if (JSON.stringify(active.before) !== JSON.stringify(current.current)) {
      pushSnapshot(active.before)
      scheduleSave(current.current)
    }
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId)
  }

  function addSticky() {
    const surface = surfaceRef.current
    const sticky: Sticky = {
      id: newId('sticky'),
      x: Math.min(CONTENT_W - 160, ((surface?.scrollLeft ?? 0) + 60) / zoom),
      y: Math.min(CONTENT_H - 130, ((surface?.scrollTop ?? 0) + 60) / zoom),
      color: STICKY_COLORS[0]!,
      text: '',
    }
    change({ ...current.current, stickies: [...current.current.stickies, sticky] })
    select(sticky.id)
  }

  const keyboardRef = React.useRef<(event: KeyboardEvent) => void>(() => undefined)
  React.useLayoutEffect(() => {
    keyboardRef.current = (event) => {
      const active = document.activeElement
      if (
        !(active instanceof HTMLElement) ||
        !rootRef.current?.contains(active) ||
        active.closest('input,textarea,select,[contenteditable="true"],[role="textbox"]')
      )
        return
      const modifier = event.ctrlKey || event.metaKey
      if (modifier && (event.key.toLowerCase() === 'z' || event.key.toLowerCase() === 'y')) {
        event.preventDefault()
        history(event.shiftKey || event.key.toLowerCase() === 'y' ? 'redo' : 'undo')
        return
      }
      if (active !== surfaceRef.current && !active.hasAttribute('data-canvas-handle')) return
      if (event.key === 'Escape') {
        if (gesture.current) {
          const cancelled = gesture.current
          if (cancelled.panStart)
            surfaceRef.current?.scrollTo(cancelled.panStart.left, cancelled.panStart.top)
          else replace(cancelled.before, false)
          gesture.current = null
          setIsDragging(false)
          if (cancelled.captureOwner.hasPointerCapture(cancelled.pointerId))
            cancelled.captureOwner.releasePointerCapture(cancelled.pointerId)
        }
        setDrawing(null)
        setSelectedId(null)
        setTool('select')
        event.preventDefault()
        return
      }
      if (event.key === 'Enter' && active === surfaceRef.current) {
        if (draftRef.current) finishDrawing()
        else if (tool !== 'select' && tool !== 'pan' && tool !== 'eraser') addElement()
        event.preventDefault()
        return
      }
      if ((event.key === 'Delete' || event.key === 'Backspace') && selectedId) {
        event.preventDefault()
        deleteSelected()
        return
      }
      const step = event.shiftKey ? 10 : 1
      const delta = (
        {
          ArrowLeft: [-step, 0],
          ArrowRight: [step, 0],
          ArrowUp: [0, -step],
          ArrowDown: [0, step],
        } as Record<string, number[]>
      )[event.key]
      if (!delta) return
      const drawing = draftRef.current
      if (drawing?.type === 'freehand' && !gesture.current) {
        const last = drawing.points?.at(-1) ?? drawing
        const end = {
          x: Math.max(0, Math.min(CONTENT_W, last.x + delta[0]!)),
          y: Math.max(0, Math.min(CONTENT_H, last.y + delta[1]!)),
        }
        setDrawing({ ...drawing, points: [...(drawing.points ?? []), end] })
        event.preventDefault()
      } else if (selectedId) {
        moveSelected(delta[0]!, delta[1]!, !event.repeat)
        event.preventDefault()
      }
    }
  })
  React.useEffect(() => {
    const handle = (event: KeyboardEvent) => keyboardRef.current(event)
    window.addEventListener('keydown', handle)
    return () => window.removeEventListener('keydown', handle)
  }, [])

  function renderShape(element: CanvasElement) {
    const common = { stroke: element.color, strokeWidth: element.strokeWidth, fill: 'transparent' }
    if (element.type === 'rectangle')
      return (
        <rect
          x={Math.min(element.x, element.x + element.w)}
          y={Math.min(element.y, element.y + element.h)}
          width={Math.abs(element.w)}
          height={Math.abs(element.h)}
          {...common}
        />
      )
    if (element.type === 'ellipse')
      return (
        <ellipse
          cx={element.x + element.w / 2}
          cy={element.y + element.h / 2}
          rx={Math.abs(element.w) / 2}
          ry={Math.abs(element.h) / 2}
          {...common}
        />
      )
    if (element.type === 'arrow' || element.type === 'line')
      return (
        <line
          x1={element.x}
          y1={element.y}
          x2={element.x + element.w}
          y2={element.y + element.h}
          stroke={element.color}
          strokeWidth={element.strokeWidth}
          markerEnd={
            element.type === 'arrow'
              ? `url(#arrowhead-${element.color.replace('#', '')})`
              : undefined
          }
        />
      )
    if (element.type === 'freehand')
      return (
        <polyline
          points={(element.points ?? []).map((p) => `${p.x},${p.y}`).join(' ')}
          stroke={element.color}
          strokeWidth={element.strokeWidth}
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )
    if (element.type === 'text' && editingTextId !== element.id)
      return (
        <text
          x={element.x}
          y={element.y + 18}
          fill={element.color}
          fontSize={16}
          style={{ userSelect: 'none' }}
        >
          {element.text || t('personal.canvas.emptyText')}
        </text>
      )
    return null
  }

  const selectedElement = elements.find((item) => item.id === selectedId)
  const selectedSticky = stickies.find((item) => item.id === selectedId)
  const selected = selectedElement ?? selectedSticky
  const uniqueColors = Array.from(
    new Set([...elements.map((element) => element.color), ...(draft ? [draft.color] : [])]),
  )
  const palette = selectedSticky ? STICKY_COLORS : COLORS
  const paletteNames = selectedSticky ? STICKY_COLOR_NAMES : COLOR_NAMES
  const activeColor = selected?.color ?? color
  const controlsDisabled = Boolean(draft) || isDragging
  function chooseColor(nextColor: string) {
    if (!selectedSticky) setColor(nextColor)
    if (selected)
      change({
        elements: current.current.elements.map((item) =>
          item.id === selectedId ? { ...item, color: nextColor } : item,
        ),
        stickies: current.current.stickies.map((item) =>
          item.id === selectedId ? { ...item, color: nextColor } : item,
        ),
      })
  }
  function objectName(item: CanvasElement | Sticky, index: number) {
    const name =
      'type' in item
        ? t(`personal.canvas.controls.type.${item.type}`)
        : t('personal.canvas.controls.type.sticky')
    return `${index + 1}. ${name}${item.text ? ` — ${item.text.slice(0, 40)}` : ''}`
  }
  const allObjects = [...elements, ...stickies]
  const inputClass =
    'min-h-9 min-w-0 rounded-sm border border-border bg-card px-2 text-small max-md:min-h-11'

  return (
    <div ref={rootRef} className="flex min-w-0 flex-col gap-2">
      <div className="flex flex-wrap items-center gap-1 rounded-md border border-border bg-card p-1.5">
        {(
          [
            ['select', MousePointer2, 'select'],
            ['pan', Hand, 'pan'],
            ['freehand', Pencil, 'pen'],
            ['rectangle', Square, 'rectangle'],
            ['ellipse', Circle, 'ellipse'],
            ['arrow', ArrowRight, 'arrow'],
            ['text', Type, 'text'],
            ['eraser', Eraser, 'eraser'],
          ] as const
        ).map(([value, Icon, name]) => (
          <IconButton
            key={value}
            aria-label={t(
              name === 'pan' ? 'personal.canvas.controls.pan' : `personal.canvas.tool.${name}`,
            )}
            aria-pressed={tool === value}
            tooltip={t(
              name === 'pan' ? 'personal.canvas.controls.pan' : `personal.canvas.tool.${name}`,
            )}
            disabled={controlsDisabled}
            onClick={() => {
              setTool(value)
              setSelectedId(null)
            }}
            className={tool === value ? 'bg-accent text-primary' : undefined}
          >
            <Icon className="size-4" aria-hidden="true" />
          </IconButton>
        ))}
        <Button size="sm" onClick={() => addElement()} disabled={controlsDisabled}>
          <Plus className="size-4" aria-hidden="true" />
          {t('personal.canvas.controls.addObject')}
        </Button>
        <IconButton
          aria-label={t('personal.canvas.addSticky')}
          tooltip={t('personal.canvas.addSticky')}
          disabled={controlsDisabled}
          onClick={addSticky}
        >
          <StickyNote className="size-4" aria-hidden="true" />
        </IconButton>
        <div className="mx-1 h-6 w-px bg-border" aria-hidden="true" />
        {palette.map((value, index) => (
          <button
            key={value}
            type="button"
            aria-label={t(`personal.canvas.controls.color.${paletteNames[index]}`)}
            aria-pressed={activeColor === value}
            disabled={controlsDisabled}
            onClick={() => chooseColor(value)}
            className={cn(
              'inline-flex size-8 items-center justify-center rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring max-md:size-11',
              controlsDisabled && 'opacity-50',
            )}
          >
            <span
              aria-hidden="true"
              className={cn(
                'size-6 rounded-full border-2',
                activeColor === value
                  ? 'border-foreground outline outline-2 outline-offset-2 outline-ring'
                  : 'border-transparent',
              )}
              style={{ backgroundColor: value }}
            />
          </button>
        ))}
        <select
          aria-label={t('personal.canvas.strokeWidth')}
          value={selectedElement?.strokeWidth ?? strokeWidth}
          disabled={controlsDisabled || Boolean(selectedSticky)}
          onChange={(event) => {
            const next = Number(event.target.value)
            setStrokeWidth(next)
            if (selectedElement)
              change({
                ...current.current,
                elements: current.current.elements.map((item) =>
                  item.id === selectedId ? { ...item, strokeWidth: next } : item,
                ),
              })
          }}
          className={inputClass}
        >
          {[1, 2, 4, 6].map((width) => (
            <option key={width} value={width}>
              {width}px
            </option>
          ))}
        </select>
        <IconButton
          aria-label={t('personal.canvas.undo')}
          tooltip={t('personal.canvas.undo')}
          disabled={controlsDisabled || undoStack.current.length === 0}
          onClick={() => history('undo')}
        >
          <Undo2 className="size-4" aria-hidden="true" />
        </IconButton>
        <IconButton
          aria-label={t('personal.canvas.redo')}
          tooltip={t('personal.canvas.redo')}
          disabled={controlsDisabled || redoStack.current.length === 0}
          onClick={() => history('redo')}
        >
          <Redo2 className="size-4" aria-hidden="true" />
        </IconButton>
        <IconButton
          aria-label={t('personal.canvas.zoomOut')}
          tooltip={t('personal.canvas.zoomOut')}
          disabled={controlsDisabled || zoom <= 0.4}
          onClick={() => setZoom((value) => Math.max(0.4, Math.round((value - 0.15) * 100) / 100))}
        >
          <ZoomOut className="size-4" aria-hidden="true" />
        </IconButton>
        <span className="min-w-12 text-center text-small tabular-nums text-muted-foreground">
          {Math.round(zoom * 100)}%
        </span>
        <IconButton
          aria-label={t('personal.canvas.zoomIn')}
          tooltip={t('personal.canvas.zoomIn')}
          disabled={controlsDisabled || zoom >= 2.5}
          onClick={() => setZoom((value) => Math.min(2.5, Math.round((value + 0.15) * 100) / 100))}
        >
          <ZoomIn className="size-4" aria-hidden="true" />
        </IconButton>
      </div>
      <div className="flex flex-wrap items-end gap-2 rounded-md border border-border bg-card p-2">
        <label className="flex min-w-0 flex-1 basis-40 flex-col gap-1 text-small text-muted-foreground">
          <span className="min-w-0 break-words">{t('personal.canvas.controls.object')}</span>
          <div className="relative min-w-0">
            <select
              value={selectedId ?? ''}
              disabled={controlsDisabled}
              onChange={(event) => {
                select(event.target.value || null)
                reveal(event.target.value)
              }}
              className={cn(
                inputClass,
                'w-full appearance-none overflow-hidden pr-8 text-ellipsis',
              )}
            >
              <option value="">{t('personal.canvas.controls.none')}</option>
              {allObjects.map((item, index) => (
                <option key={item.id} value={item.id}>
                  {objectName(item, index)}
                </option>
              ))}
            </select>
            <span
              aria-hidden="true"
              className="pointer-events-none absolute inset-y-0 right-2 flex items-center"
            >
              <ChevronDown className="size-4" />
            </span>
          </div>
        </label>
        {selected ? (
          <>
            {(['x', 'y'] as const).map((axis) => (
              <label
                key={axis}
                className="flex min-w-0 flex-col gap-1 break-words text-small text-muted-foreground"
                style={{ width: '7.5em', maxWidth: '100%' }}
              >
                {t(`personal.canvas.controls.${axis}`)}
                <input
                  type="number"
                  disabled={controlsDisabled}
                  min={0}
                  max={axis === 'x' ? CONTENT_W : CONTENT_H}
                  value={Math.round(selected[axis])}
                  className={inputClass}
                  onChange={(event) => {
                    if (event.target.value === '') return
                    const value = event.target.valueAsNumber
                    if (Number.isFinite(value))
                      moveSelected(
                        axis === 'x' ? value - selected.x : 0,
                        axis === 'y' ? value - selected.y : 0,
                      )
                  }}
                />
              </label>
            ))}
            {selectedElement?.type === 'text' ? (
              <Button
                size="sm"
                disabled={controlsDisabled}
                onClick={() => {
                  editGroup.current = null
                  setEditingTextId(selectedElement.id)
                  reveal(selectedElement.id)
                }}
              >
                {t('personal.canvas.controls.editText')}
              </Button>
            ) : null}
            <IconButton
              aria-label={t('personal.canvas.controls.deleteObject')}
              disabled={controlsDisabled}
              tooltip={t('personal.canvas.controls.deleteObject')}
              onClick={() => {
                deleteSelected()
                surfaceRef.current?.focus({ preventScroll: true })
              }}
            >
              <X className="size-4" aria-hidden="true" />
            </IconButton>
          </>
        ) : null}
      </div>
      <p id={hintId} className="text-small text-muted-foreground">
        {draft?.type === 'freehand' && !gesture.current
          ? t('personal.canvas.controls.penHint')
          : t('personal.canvas.controls.hint')}
      </p>
      {draft && !gesture.current ? (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={finishDrawing}>
            {t('personal.canvas.controls.finishDrawing')}
          </Button>
          <Button size="sm" variant="secondary" onClick={() => setDrawing(null)}>
            {t('personal.canvas.controls.cancelDrawing')}
          </Button>
        </div>
      ) : null}
      <div
        ref={surfaceRef}
        role="region"
        aria-label={t('personal.canvas.drawingSurface')}
        aria-describedby={hintId}
        // A named overflow region needs a tab stop so keyboard users can scroll and draw in it.
        // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
        tabIndex={0}
        className="relative h-[560px] w-full overflow-auto rounded-md border border-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        style={{ backgroundColor: '#ffffff' }}
      >
        <div style={{ width: CONTENT_W * zoom, height: CONTENT_H * zoom, position: 'relative' }}>
          <div
            style={{
              width: CONTENT_W,
              height: CONTENT_H,
              transform: `scale(${zoom})`,
              transformOrigin: '0 0',
              position: 'absolute',
              inset: 0,
            }}
          >
            <svg
              ref={svgRef}
              width={CONTENT_W}
              height={CONTENT_H}
              className="absolute inset-0"
              style={{
                cursor: tool === 'pan' ? 'grab' : tool === 'select' ? 'default' : 'crosshair',
                touchAction: 'none',
              }}
              onPointerDown={pointerDown}
              onPointerMove={pointerMove}
              onPointerUp={(event) => pointerEnd(event)}
              onPointerCancel={(event) => pointerEnd(event, true)}
              onLostPointerCapture={(event) => pointerEnd(event, true)}
            >
              <defs>
                {uniqueColors.map((value) => (
                  <marker
                    key={value}
                    id={`arrowhead-${value.replace('#', '')}`}
                    markerWidth="8"
                    markerHeight="8"
                    refX="6"
                    refY="4"
                    orient="auto"
                  >
                    <path d="M0,0 L8,4 L0,8 z" fill={value} />
                  </marker>
                ))}
              </defs>
              {elements.map((element) => (
                <g
                  key={element.id}
                  data-canvas-object={element.id}
                  onPointerDown={(event) => startDrag(element.id, event)}
                  onPointerMove={pointerMove}
                  onPointerUp={(event) => pointerEnd(event)}
                  onPointerCancel={(event) => pointerEnd(event, true)}
                  onLostPointerCapture={(event) => pointerEnd(event, true)}
                  onDoubleClick={() => {
                    if (element.type === 'text' && tool === 'select') {
                      editGroup.current = null
                      setEditingTextId(element.id)
                    }
                  }}
                  style={{ touchAction: 'none' }}
                >
                  {renderShape(element)}
                </g>
              ))}
              {draft ? renderShape(draft) : null}
              {selectedElement
                ? (() => {
                    const bounds = elementBounds(selectedElement)
                    return (
                      <rect
                        x={bounds.x - 4}
                        y={bounds.y - 4}
                        width={bounds.w + 8}
                        height={bounds.h + 8}
                        fill="none"
                        stroke="#2f6fed"
                        strokeDasharray="4 3"
                        strokeWidth={1.5}
                        pointerEvents="none"
                      />
                    )
                  })()
                : null}
            </svg>
            {editingTextId
              ? (() => {
                  const element = elements.find((item) => item.id === editingTextId)
                  if (!element) return null
                  return (
                    <input
                      aria-label={t('personal.canvas.drawingText')}
                      ref={textInputRef}
                      value={element.text ?? ''}
                      onChange={(event) => editText(element.id, event.target.value)}
                      onBlur={() => {
                        setEditingTextId(null)
                        editGroup.current = null
                      }}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === 'Escape') {
                          event.preventDefault()
                          event.currentTarget.blur()
                          surfaceRef.current?.focus({ preventScroll: true })
                        }
                      }}
                      style={{
                        position: 'absolute',
                        left: element.x,
                        top: element.y,
                        width: Math.max(120, element.w),
                        color: element.color,
                        backgroundColor: '#ffffff',
                      }}
                      className="rounded-sm border border-primary px-1 text-body"
                    />
                  )
                })()
              : null}
            <div className="pointer-events-none absolute inset-0">
              {stickies.map((sticky) => (
                <StickyNoteEl
                  key={sticky.id}
                  sticky={sticky}
                  selected={selectedId === sticky.id}
                  onSelect={() => select(sticky.id)}
                  onDragStart={(event) => startDrag(sticky.id, event)}
                  onDragMove={pointerMove}
                  onDragEnd={(event) => pointerEnd(event)}
                  onDragCancel={(event) => pointerEnd(event, true)}
                  onTextFocus={() => {
                    select(sticky.id)
                    editGroup.current = { id: sticky.id, recorded: false }
                  }}
                  onTextBlur={() => {
                    editGroup.current = null
                  }}
                  onTextChange={(text) => editText(sticky.id, text, true)}
                  onDelete={() => deleteSelected(sticky.id)}
                />
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function StickyNoteEl({
  sticky,
  selected,
  onSelect,
  onDragStart,
  onDragMove,
  onDragEnd,
  onDragCancel,
  onTextFocus,
  onTextBlur,
  onTextChange,
  onDelete,
}: {
  sticky: Sticky
  selected: boolean
  onSelect: () => void
  onDragStart: (event: React.PointerEvent) => void
  onDragMove: (event: React.PointerEvent) => void
  onDragEnd: (event: React.PointerEvent) => void
  onDragCancel: (event: React.PointerEvent) => void
  onTextFocus: () => void
  onTextBlur: () => void
  onTextChange: (text: string) => void
  onDelete: () => void
}) {
  const t = useT()
  const controlClass =
    'inline-flex size-6 items-center justify-center rounded-sm text-[#1f2937] hover:bg-black/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1f2937] max-md:size-11'
  return (
    <div
      className={cn(
        'pointer-events-auto absolute flex w-40 flex-col gap-1 rounded-sm p-2 shadow-2',
        selected && 'outline outline-2 outline-offset-2 outline-[#2f6fed]',
      )}
      style={{
        left: sticky.x,
        top: sticky.y,
        backgroundColor: sticky.color,
        transform: `rotate(${sticky.rotation ?? 0}deg)`,
      }}
    >
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          data-canvas-handle
          aria-label={t('personal.canvas.controls.moveSticky')}
          className={cn(controlClass, 'cursor-move')}
          style={{ touchAction: 'none' }}
          onFocus={onSelect}
          onPointerDown={onDragStart}
          onPointerMove={onDragMove}
          onPointerUp={onDragEnd}
          onPointerCancel={onDragCancel}
          onLostPointerCapture={onDragCancel}
        >
          <GripHorizontal className="size-4" aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={onDelete}
          className={controlClass}
          aria-label={t('personal.canvas.deleteSticky')}
        >
          <X className="size-3.5" aria-hidden="true" />
        </button>
      </div>
      <textarea
        aria-label={t('personal.canvas.stickyText')}
        value={sticky.text}
        onFocus={onTextFocus}
        onBlur={onTextBlur}
        onChange={(event) => onTextChange(event.target.value)}
        rows={3}
        className="w-full resize-none rounded-sm border-none bg-transparent text-small text-[#1f2937] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1f2937]"
      />
    </div>
  )
}
