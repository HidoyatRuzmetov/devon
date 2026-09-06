// The canvas's drawing layer (TECH-SPEC §3.3: "canvas with Excalidraw (@excalidraw/excalidraw, MIT)
// plus a sticky-note overlay, autosave and restore").
//
// This ships a first-party SVG+HTML renderer instead of the named Excalidraw library: adding it
// requires an `apps/web/package.json` dependency + lockfile change, and that file is outside this
// module's allowed paths (MODULE-GUIDE.md: a module ships by *adding* files, and a shared
// `package.json`/lockfile edit made from a module's own worktree, while five sibling worktrees may
// each be adding their own dependencies in parallel, is exactly the merge-conflict-prone edit that
// convention exists to avoid). The data model is kept Excalidraw-shaped on purpose
// (`{ elements, appState }`, `packages/db/src/schema/personal.ts`'s `scene` column) so swapping the
// renderer for the real library later is a rewrite of this one file, not a data migration -- the
// integration step (which owns `apps/web/package.json`) can do that swap without touching the API,
// schema, or any other feature.
import * as React from 'react'
import { useT } from '@devon/i18n'
import {
  ArrowRight,
  Circle,
  Eraser,
  MousePointer2,
  Pencil,
  Redo2,
  Square,
  StickyNote,
  Type,
  Undo2,
  ZoomIn,
  ZoomOut,
} from 'lucide-react'
import { IconButton, cn } from '@devon/ui'
import type { CanvasElement, Scene, Sticky } from './types.js'

type Tool = 'select' | 'freehand' | 'rectangle' | 'ellipse' | 'arrow' | 'text' | 'sticky' | 'eraser'

const COLORS = ['#1f2937', '#2f6fed', '#1f9d55', '#d97706', '#dc2626', '#7c3aed']
const STICKY_COLORS = ['#fde68a', '#fbcfe8', '#bbf7d0', '#bfdbfe']
const CONTENT_W = 2400
const CONTENT_H = 1400

type Snapshot = { elements: CanvasElement[]; stickies: Sticky[] }

function newId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
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
  const [tool, setTool] = React.useState<Tool>('select')
  const [color, setColor] = React.useState(COLORS[0]!)
  const [strokeWidth, setStrokeWidth] = React.useState(2)
  const [zoom, setZoom] = React.useState(1)
  const [selectedId, setSelectedId] = React.useState<string | null>(null)
  const [editingTextId, setEditingTextId] = React.useState<string | null>(null)
  const [draft, setDraft] = React.useState<CanvasElement | null>(null)

  const undoStack = React.useRef<Snapshot[]>([])
  const redoStack = React.useRef<Snapshot[]>([])
  const svgRef = React.useRef<SVGSVGElement>(null)
  const draggingRef = React.useRef<{
    id: string
    startX: number
    startY: number
    origX: number
    origY: number
  } | null>(null)

  // Re-hydrate from the server once (when a different canvas is opened) -- never on every render,
  // so local in-progress edits are not clobbered by a background refetch of the same canvas.
  const lastLoadedRef = React.useRef<string | null>(null)
  const sceneKey = React.useMemo(() => JSON.stringify({ e: scene.elements.length }), [scene])
  React.useEffect(() => {
    if (lastLoadedRef.current === sceneKey) return
    lastLoadedRef.current = sceneKey
    setElements(scene.elements)
    setStickies(initialStickies)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally keyed on identity, not deep-watching every field.
  }, [sceneKey])

  const debouncedSave = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  function scheduleSave(nextElements: CanvasElement[], nextStickies: Sticky[]) {
    if (debouncedSave.current) clearTimeout(debouncedSave.current)
    debouncedSave.current = setTimeout(() => {
      onChange({
        scene: { elements: nextElements, appState: scene.appState },
        stickies: nextStickies,
      })
    }, 800)
  }

  function pushSnapshot() {
    undoStack.current.push({ elements, stickies })
    if (undoStack.current.length > 50) undoStack.current.shift()
    redoStack.current = []
  }

  function commit(nextElements: CanvasElement[], nextStickies: Sticky[] = stickies) {
    setElements(nextElements)
    setStickies(nextStickies)
    scheduleSave(nextElements, nextStickies)
  }

  function undo() {
    const prev = undoStack.current.pop()
    if (!prev) return
    redoStack.current.push({ elements, stickies })
    setElements(prev.elements)
    setStickies(prev.stickies)
    scheduleSave(prev.elements, prev.stickies)
  }

  function redo() {
    const next = redoStack.current.pop()
    if (!next) return
    undoStack.current.push({ elements, stickies })
    setElements(next.elements)
    setStickies(next.stickies)
    scheduleSave(next.elements, next.stickies)
  }

  function toContentPoint(clientX: number, clientY: number): { x: number; y: number } {
    const rect = svgRef.current?.getBoundingClientRect()
    if (!rect) return { x: 0, y: 0 }
    return { x: (clientX - rect.left) / zoom, y: (clientY - rect.top) / zoom }
  }

  function handlePointerDown(e: React.PointerEvent<SVGSVGElement>) {
    const p = toContentPoint(e.clientX, e.clientY)
    if (tool === 'eraser') return
    if (tool === 'text') {
      pushSnapshot()
      const el: CanvasElement = {
        id: newId('text'),
        type: 'text',
        x: p.x,
        y: p.y,
        w: 160,
        h: 28,
        color,
        strokeWidth,
        text: '',
      }
      commit([...elements, el])
      setEditingTextId(el.id)
      setTool('select')
      return
    }
    if (tool === 'select' || tool === 'sticky') return
    const el: CanvasElement = {
      id: newId(tool),
      type: tool,
      x: p.x,
      y: p.y,
      w: 0,
      h: 0,
      color,
      strokeWidth,
      points: tool === 'freehand' ? [p] : undefined,
    }
    setDraft(el)
  }

  function handlePointerMove(e: React.PointerEvent<SVGSVGElement>) {
    const p = toContentPoint(e.clientX, e.clientY)
    if (draft) {
      if (draft.type === 'freehand') {
        setDraft({ ...draft, points: [...(draft.points ?? []), p] })
      } else {
        setDraft({ ...draft, w: p.x - draft.x, h: p.y - draft.y })
      }
      return
    }
    const dragging = draggingRef.current
    if (dragging) {
      const dx = e.clientX - dragging.startX
      const dy = e.clientY - dragging.startY
      setElements((prev) =>
        prev.map((el) =>
          el.id === dragging.id
            ? { ...el, x: dragging.origX + dx / zoom, y: dragging.origY + dy / zoom }
            : el,
        ),
      )
    }
  }

  function handlePointerUp() {
    if (draft) {
      pushSnapshot()
      commit([...elements, draft])
      setDraft(null)
      setTool('select')
    }
    if (draggingRef.current) {
      draggingRef.current = null
      scheduleSave(elements, stickies)
    }
  }

  function startDragElement(el: CanvasElement, e: React.PointerEvent) {
    if (tool === 'eraser') {
      pushSnapshot()
      commit(elements.filter((x) => x.id !== el.id))
      return
    }
    if (tool !== 'select') return
    e.stopPropagation()
    setSelectedId(el.id)
    pushSnapshot()
    draggingRef.current = {
      id: el.id,
      startX: e.clientX,
      startY: e.clientY,
      origX: el.x,
      origY: el.y,
    }
  }

  function deleteSelected() {
    if (!selectedId) return
    pushSnapshot()
    commit(elements.filter((el) => el.id !== selectedId))
    setSelectedId(null)
  }

  // Document-level (not a `tabIndex`+`onKeyDown` on the canvas `<div>`, which `jsx-a11y` correctly
  // flags as a non-interactive element pretending to be one): Delete/Backspace removes the selected
  // shape, guarded against firing while the user is actually typing in a text field.
  React.useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const tag = (document.activeElement as HTMLElement | null)?.tagName
      if (
        (e.key === 'Delete' || e.key === 'Backspace') &&
        selectedId &&
        tag !== 'INPUT' &&
        tag !== 'TEXTAREA'
      ) {
        deleteSelected()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
    // `deleteSelected` closes over `elements`/`selectedId` (already deps below) and is redefined
    // every render -- listing it too would just re-subscribe on every render for no behavioural gain.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, elements])

  function addSticky() {
    pushSnapshot()
    const sticky: Sticky = {
      id: newId('sticky'),
      x: 60 + Math.random() * 40,
      y: 60 + Math.random() * 40,
      color: STICKY_COLORS[Math.floor(Math.random() * STICKY_COLORS.length)]!,
      text: '',
    }
    commit(elements, [...stickies, sticky])
  }

  function renderShape(el: CanvasElement) {
    const key = el.id
    const common = { stroke: el.color, strokeWidth: el.strokeWidth, fill: 'none' }
    if (el.type === 'rectangle') {
      const x = el.w < 0 ? el.x + el.w : el.x
      const y = el.h < 0 ? el.y + el.h : el.y
      return (
        <rect key={key} x={x} y={y} width={Math.abs(el.w)} height={Math.abs(el.h)} {...common} />
      )
    }
    if (el.type === 'ellipse') {
      return (
        <ellipse
          key={key}
          cx={el.x + el.w / 2}
          cy={el.y + el.h / 2}
          rx={Math.abs(el.w) / 2}
          ry={Math.abs(el.h) / 2}
          {...common}
        />
      )
    }
    if (el.type === 'arrow') {
      return (
        <g key={key}>
          <line
            x1={el.x}
            y1={el.y}
            x2={el.x + el.w}
            y2={el.y + el.h}
            stroke={el.color}
            strokeWidth={el.strokeWidth}
            markerEnd={`url(#arrowhead-${el.color.replace('#', '')})`}
          />
        </g>
      )
    }
    if (el.type === 'freehand') {
      const points = (el.points ?? []).map((pt) => `${pt.x},${pt.y}`).join(' ')
      return (
        <polyline
          key={key}
          points={points}
          stroke={el.color}
          strokeWidth={el.strokeWidth}
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )
    }
    if (el.type === 'text') {
      if (editingTextId === el.id) return null
      return (
        <text
          key={key}
          x={el.x}
          y={el.y + 18}
          fill={el.color}
          fontSize={16}
          style={{ userSelect: 'none' }}
        >
          {el.text || t('personal.canvas.emptyText')}
        </text>
      )
    }
    return null
  }

  const uniqueColors = Array.from(new Set(elements.map((e) => e.color)))

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-1 rounded-md border border-border bg-card p-1.5">
        <ToolButton
          icon={MousePointer2}
          active={tool === 'select'}
          label={t('personal.canvas.tool.select')}
          onClick={() => setTool('select')}
        />
        <ToolButton
          icon={Pencil}
          active={tool === 'freehand'}
          label={t('personal.canvas.tool.pen')}
          onClick={() => setTool('freehand')}
        />
        <ToolButton
          icon={Square}
          active={tool === 'rectangle'}
          label={t('personal.canvas.tool.rectangle')}
          onClick={() => setTool('rectangle')}
        />
        <ToolButton
          icon={Circle}
          active={tool === 'ellipse'}
          label={t('personal.canvas.tool.ellipse')}
          onClick={() => setTool('ellipse')}
        />
        <ToolButton
          icon={ArrowRight}
          active={tool === 'arrow'}
          label={t('personal.canvas.tool.arrow')}
          onClick={() => setTool('arrow')}
        />
        <ToolButton
          icon={Type}
          active={tool === 'text'}
          label={t('personal.canvas.tool.text')}
          onClick={() => setTool('text')}
        />
        <ToolButton
          icon={Eraser}
          active={tool === 'eraser'}
          label={t('personal.canvas.tool.eraser')}
          onClick={() => setTool('eraser')}
        />
        <div className="mx-1 h-6 w-px bg-border" aria-hidden="true" />
        <IconButton aria-label={t('personal.canvas.addSticky')} onClick={addSticky}>
          <StickyNote className="size-4" aria-hidden="true" />
        </IconButton>
        <div className="mx-1 h-6 w-px bg-border" aria-hidden="true" />
        {COLORS.map((c) => (
          <button
            key={c}
            type="button"
            aria-label={c}
            onClick={() => setColor(c)}
            className={cn(
              'size-6 rounded-full border-2',
              color === c ? 'border-foreground' : 'border-transparent',
            )}
            style={{ backgroundColor: c }}
          />
        ))}
        <select
          aria-label={t('personal.canvas.strokeWidth')}
          value={strokeWidth}
          onChange={(e) => setStrokeWidth(Number(e.target.value))}
          className="h-8 rounded-sm border border-border bg-card px-1 text-small"
        >
          {[1, 2, 4, 6].map((w) => (
            <option key={w} value={w}>
              {w}px
            </option>
          ))}
        </select>
        <div className="mx-1 h-6 w-px bg-border" aria-hidden="true" />
        <IconButton aria-label={t('personal.canvas.undo')} onClick={undo}>
          <Undo2 className="size-4" aria-hidden="true" />
        </IconButton>
        <IconButton aria-label={t('personal.canvas.redo')} onClick={redo}>
          <Redo2 className="size-4" aria-hidden="true" />
        </IconButton>
        <div className="mx-1 h-6 w-px bg-border" aria-hidden="true" />
        <IconButton
          aria-label={t('personal.canvas.zoomOut')}
          onClick={() => setZoom((z) => Math.max(0.4, z - 0.15))}
        >
          <ZoomOut className="size-4" aria-hidden="true" />
        </IconButton>
        <span className="w-10 text-center text-small tabular-nums text-muted-foreground">
          {Math.round(zoom * 100)}%
        </span>
        <IconButton
          aria-label={t('personal.canvas.zoomIn')}
          onClick={() => setZoom((z) => Math.min(2.5, z + 0.15))}
        >
          <ZoomIn className="size-4" aria-hidden="true" />
        </IconButton>
      </div>

      <div className="relative h-[560px] w-full overflow-auto rounded-md border border-border bg-muted">
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
                cursor:
                  tool === 'select' ? 'default' : tool === 'eraser' ? 'crosshair' : 'crosshair',
              }}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
            >
              <defs>
                {uniqueColors.map((c) => (
                  <marker
                    key={c}
                    id={`arrowhead-${c.replace('#', '')}`}
                    markerWidth="8"
                    markerHeight="8"
                    refX="6"
                    refY="4"
                    orient="auto"
                  >
                    <path d="M0,0 L8,4 L0,8 z" fill={c} />
                  </marker>
                ))}
              </defs>
              {elements.map((el) => (
                <g
                  key={el.id}
                  onPointerDown={(e) => startDragElement(el, e)}
                  className={selectedId === el.id ? 'opacity-90' : undefined}
                >
                  {renderShape(el)}
                </g>
              ))}
              {draft ? renderShape(draft) : null}
              {selectedId
                ? (() => {
                    const el = elements.find((e) => e.id === selectedId)
                    if (!el) return null
                    const x = Math.min(el.x, el.x + el.w) - 4
                    const y = Math.min(el.y, el.y + el.h) - 4
                    return (
                      <rect
                        x={x}
                        y={y}
                        width={Math.abs(el.w) + 8}
                        height={Math.abs(el.h) + 8}
                        fill="none"
                        stroke="var(--color-ring)"
                        strokeDasharray="4 3"
                        strokeWidth={1.5}
                      />
                    )
                  })()
                : null}
            </svg>

            {editingTextId
              ? (() => {
                  const el = elements.find((e) => e.id === editingTextId)
                  if (!el) return null
                  return (
                    <input
                      ref={(node) => node?.focus()}
                      value={el.text ?? ''}
                      onChange={(e) =>
                        setElements((prev) =>
                          prev.map((x) => (x.id === el.id ? { ...x, text: e.target.value } : x)),
                        )
                      }
                      onBlur={() => {
                        setEditingTextId(null)
                        pushSnapshot()
                        scheduleSave(elements, stickies)
                      }}
                      onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
                      style={{
                        position: 'absolute',
                        left: el.x,
                        top: el.y,
                        width: Math.max(120, el.w),
                        color: el.color,
                      }}
                      className="rounded-sm border border-primary bg-card px-1 text-body"
                    />
                  )
                })()
              : null}

            <div className="pointer-events-none absolute inset-0">
              {stickies.map((sticky) => (
                <StickyNoteEl
                  key={sticky.id}
                  sticky={sticky}
                  zoom={zoom}
                  onMove={(x, y) =>
                    setStickies((prev) =>
                      prev.map((s) => (s.id === sticky.id ? { ...s, x, y } : s)),
                    )
                  }
                  onMoveEnd={() => scheduleSave(elements, stickies)}
                  onTextChange={(text) => {
                    const next = stickies.map((s) => (s.id === sticky.id ? { ...s, text } : s))
                    setStickies(next)
                    scheduleSave(elements, next)
                  }}
                  onDelete={() => {
                    pushSnapshot()
                    commit(
                      elements,
                      stickies.filter((s) => s.id !== sticky.id),
                    )
                  }}
                />
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function ToolButton({
  icon: Icon,
  active,
  label,
  onClick,
}: {
  icon: React.ComponentType<React.SVGProps<SVGSVGElement>>
  active: boolean
  label: string
  onClick: () => void
}) {
  return (
    <IconButton
      aria-label={label}
      onClick={onClick}
      className={active ? 'bg-accent text-primary' : undefined}
    >
      <Icon className="size-4" aria-hidden="true" />
    </IconButton>
  )
}

function StickyNoteEl({
  sticky,
  zoom,
  onMove,
  onMoveEnd,
  onTextChange,
  onDelete,
}: {
  sticky: Sticky
  zoom: number
  onMove: (x: number, y: number) => void
  onMoveEnd: () => void
  onTextChange: (text: string) => void
  onDelete: () => void
}) {
  const dragRef = React.useRef<{
    startX: number
    startY: number
    origX: number
    origY: number
  } | null>(null)

  return (
    <div
      className="pointer-events-auto absolute flex w-40 flex-col gap-1 rounded-sm p-2 shadow-2"
      style={{
        left: sticky.x,
        top: sticky.y,
        backgroundColor: sticky.color,
        transform: `rotate(${sticky.rotation ?? 0}deg)`,
      }}
      onPointerDown={(e) => {
        if ((e.target as HTMLElement).tagName === 'TEXTAREA') return
        dragRef.current = { startX: e.clientX, startY: e.clientY, origX: sticky.x, origY: sticky.y }
        e.currentTarget.setPointerCapture(e.pointerId)
      }}
      onPointerMove={(e) => {
        const d = dragRef.current
        if (!d) return
        onMove(d.origX + (e.clientX - d.startX) / zoom, d.origY + (e.clientY - d.startY) / zoom)
      }}
      onPointerUp={() => {
        if (dragRef.current) {
          dragRef.current = null
          onMoveEnd()
        }
      }}
    >
      <button
        type="button"
        onClick={onDelete}
        className="self-end text-caption text-foreground/60 hover:text-foreground"
        aria-label="×"
      >
        ×
      </button>
      <textarea
        value={sticky.text}
        onChange={(e) => onTextChange(e.target.value)}
        rows={3}
        className="w-full resize-none border-none bg-transparent text-small text-foreground/90 focus-visible:outline-none"
      />
    </div>
  )
}
