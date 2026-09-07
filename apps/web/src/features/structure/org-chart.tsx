// The org chart view (TECH-SPEC EPIC-003: "an org chart view ... that renders a department with zero
// unit heads and one with three levels equally well, keyboard navigable, PNG export"). A hand-written
// SVG tree -- no charting library -- built from the same `TreeNode[]` the list view uses, so the two
// views can never disagree about the shape of the tree. UI-OVERHAUL.md's Jakob row for this screen
// (Miro/Lucidchart org charts): unit colours, vacancies dashed, zoom/pan, click to open a side panel.
import * as React from 'react'
import { useT } from '@devon/i18n'
import { Button, IconButton, Sheet, SheetContent, unitHueClass } from '@devon/ui'
import { Download, Minus, Plus, RotateCcw, X } from 'lucide-react'
import type { TreeActions, TreeNode } from './unit-tree.js'
import { RoleChips } from './unit-tree.js'
import { fullName } from './member-card.js'

const NODE_W = 188
const NODE_H = 88
const H_GAP = 28
const V_GAP = 56
const MARGIN = 32
const MIN_SCALE = 0.4
const MAX_SCALE = 2

interface Positioned extends Omit<TreeNode, 'children'> {
  x: number
  y: number
  width: number
  depth: number
  children: Positioned[]
}

function layout(roots: TreeNode[]): {
  nodes: Positioned[]
  width: number
  height: number
  maxDepth: number
} {
  const flat: Positioned[] = []
  let maxDepth = 0

  function widthOf(node: TreeNode): number {
    if (node.children.length === 0) return NODE_W
    const childWidths = node.children.map(widthOf)
    const total = childWidths.reduce((a, b) => a + b, 0) + H_GAP * (node.children.length - 1)
    return Math.max(NODE_W, total)
  }

  function place(node: TreeNode, depth: number, leftEdge: number): Positioned {
    maxDepth = Math.max(maxDepth, depth)
    const width = widthOf(node)
    let x: number
    const children: Positioned[] = []
    if (node.children.length === 0) {
      x = leftEdge + width / 2
    } else {
      let cursor = leftEdge
      for (const child of node.children) {
        const placedChild = place(child, depth + 1, cursor)
        children.push(placedChild)
        cursor += placedChild.width + H_GAP
      }
      const first = children[0]!
      const last = children[children.length - 1]!
      x = (first.x + last.x) / 2
    }
    const positioned: Positioned = {
      ...node,
      children,
      x,
      y: depth * (NODE_H + V_GAP),
      width,
      depth,
    }
    flat.push(positioned)
    return positioned
  }

  let cursor = 0
  for (const root of roots) {
    const placed = place(root, 0, cursor)
    cursor += placed.width + H_GAP
  }

  const totalWidth = Math.max(cursor - H_GAP, NODE_W)
  return {
    nodes: flat,
    width: totalWidth + MARGIN * 2,
    height: (maxDepth + 1) * (NODE_H + V_GAP) - V_GAP + MARGIN * 2,
    maxDepth,
  }
}

function unitFillVar(node: TreeNode): string {
  return node.colour
    ? `var(--color-unit-${node.colour})`
    : `var(--color-${unitHueClass(node.id).replace('bg-', '')})`
}

/** Where a node sits in the tree, root first -- the side panel's breadcrumb. */
function pathTo(nodes: Positioned[], id: string): Positioned[] {
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const chain: Positioned[] = []
  let current = byId.get(id) ?? null
  while (current) {
    chain.unshift(current)
    current = current.parentUnitId ? (byId.get(current.parentUnitId) ?? null) : null
  }
  return chain
}

export function OrgChart({
  roots,
  actions,
  departmentName,
}: {
  roots: TreeNode[]
  actions: TreeActions
  departmentName: string
}) {
  const t = useT()
  const svgRef = React.useRef<SVGSVGElement>(null)
  const viewportRef = React.useRef<HTMLDivElement>(null)
  const { nodes, width, height } = React.useMemo(() => layout(roots), [roots])
  const [focusedId, setFocusedId] = React.useState<string | null>(nodes[0]?.id ?? null)
  const [panelUnitId, setPanelUnitId] = React.useState<string | null>(null)
  const [zoom, setZoom] = React.useState(1)
  const [pan, setPan] = React.useState({ x: 0, y: 0 })
  const panState = React.useRef<{
    startX: number
    startY: number
    panX: number
    panY: number
  } | null>(null)

  const nodeRefs = React.useRef(new Map<string, SVGGElement>())
  React.useEffect(() => {
    if (focusedId) nodeRefs.current.get(focusedId)?.focus()
  }, [focusedId])

  const byId = React.useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes])
  const byParentDepth = React.useMemo(() => {
    // Same-depth siblings under the same parent, ordered by x -- what Left/Right move between.
    const map = new Map<string, Positioned[]>()
    for (const n of nodes) {
      const key = `${n.parentUnitId ?? 'root'}:${n.depth}`
      const list = map.get(key) ?? []
      list.push(n)
      map.set(key, list)
    }
    for (const list of map.values()) list.sort((a, b) => a.x - b.x)
    return map
  }, [nodes])

  const move = (dir: 'left' | 'right' | 'up' | 'down') => {
    if (!focusedId) return
    const current = byId.get(focusedId)
    if (!current) return
    if (dir === 'up') {
      if (current.parentUnitId) setFocusedId(current.parentUnitId)
      return
    }
    if (dir === 'down') {
      const first = current.children[0]
      if (first) setFocusedId(first.id)
      return
    }
    const siblings = byParentDepth.get(`${current.parentUnitId ?? 'root'}:${current.depth}`) ?? []
    const at = siblings.findIndex((s) => s.id === current.id)
    const next = dir === 'right' ? siblings[at + 1] : siblings[at - 1]
    if (next) setFocusedId(next.id)
  }

  const clampZoom = (v: number) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, v))
  const zoomBy = (factor: number) => setZoom((z) => clampZoom(Math.round(z * factor * 100) / 100))
  const resetView = () => {
    setZoom(1)
    setPan({ x: 0, y: 0 })
  }

  const onWheel = (e: React.WheelEvent) => {
    if (!e.ctrlKey && !e.metaKey) return
    e.preventDefault()
    zoomBy(e.deltaY < 0 ? 1.08 : 0.93)
  }

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return
    panState.current = { startX: e.clientX, startY: e.clientY, panX: pan.x, panY: pan.y }
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  }
  const onPointerMove = (e: React.PointerEvent) => {
    if (!panState.current) return
    const dx = e.clientX - panState.current.startX
    const dy = e.clientY - panState.current.startY
    setPan({ x: panState.current.panX + dx, y: panState.current.panY + dy })
  }
  const onPointerUp = () => {
    panState.current = null
  }

  const exportPng = async () => {
    const svg = svgRef.current
    if (!svg) return
    const scale = 2
    const serialized = new XMLSerializer().serializeToString(svg)
    const svgBlob = new Blob([serialized], { type: 'image/svg+xml;charset=utf-8' })
    const url = URL.createObjectURL(svgBlob)
    try {
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const image = new Image()
        image.onload = () => resolve(image)
        image.onerror = reject
        image.src = url
      })
      const canvas = document.createElement('canvas')
      canvas.width = width * scale
      canvas.height = height * scale
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
      const pngUrl = canvas.toDataURL('image/png')
      const a = document.createElement('a')
      a.href = pngUrl
      a.download = `${departmentName || 'structure'}.png`
      document.body.appendChild(a)
      a.click()
      a.remove()
    } finally {
      URL.revokeObjectURL(url)
    }
  }

  const panelUnit = panelUnitId ? byId.get(panelUnitId) : undefined
  const panelBreadcrumb = panelUnitId ? pathTo(nodes, panelUnitId) : []
  const panelRoles = panelUnitId ? (actions.rolesByUnit.get(panelUnitId) ?? []) : []
  const panelHead = panelRoles.find((r) => r.role === 'head')
  const panelHeadMember = panelHead ? actions.membersById.get(panelHead.userId) : undefined

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <div className="inline-flex items-center gap-1 rounded-md border border-border bg-card p-0.5">
          <IconButton
            aria-label={t('structure.units.chart.zoomOut')}
            onClick={() => zoomBy(1 / 1.2)}
            disabled={zoom <= MIN_SCALE}
          >
            <Minus className="size-4" aria-hidden="true" />
          </IconButton>
          <span className="w-12 text-center text-caption tabular-nums text-muted-foreground">
            {Math.round(zoom * 100)}%
          </span>
          <IconButton
            aria-label={t('structure.units.chart.zoomIn')}
            onClick={() => zoomBy(1.2)}
            disabled={zoom >= MAX_SCALE}
          >
            <Plus className="size-4" aria-hidden="true" />
          </IconButton>
          <IconButton aria-label={t('structure.units.chart.resetView')} onClick={resetView}>
            <RotateCcw className="size-4" aria-hidden="true" />
          </IconButton>
        </div>
        <Button variant="secondary" size="sm" onClick={exportPng}>
          <Download className="size-4" aria-hidden="true" />
          {t('structure.units.chart.exportPng')}
        </Button>
      </div>
      <p className="sr-only" id="org-chart-keyboard-hint">
        {t('structure.units.chart.keyboardHint')}
      </p>
      <div
        ref={viewportRef}
        className="relative h-[min(70vh,640px)] touch-none overflow-hidden rounded-md border border-border bg-card"
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerUp}
        style={{ cursor: panState.current ? 'grabbing' : 'grab' }}
      >
        <div
          className="size-full transition-transform duration-(--dur-micro) ease-out"
          style={{
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
            transformOrigin: '0 0',
          }}
        >
          <svg
            ref={svgRef}
            role="tree"
            aria-describedby="org-chart-keyboard-hint"
            width={width}
            height={height}
            viewBox={`0 0 ${width} ${height}`}
            className="m-4"
            onKeyDown={(e) => {
              if (e.key === 'ArrowLeft') {
                e.preventDefault()
                move('left')
              }
              if (e.key === 'ArrowRight') {
                e.preventDefault()
                move('right')
              }
              if (e.key === 'ArrowUp') {
                e.preventDefault()
                move('up')
              }
              if (e.key === 'ArrowDown') {
                e.preventDefault()
                move('down')
              }
              if (e.key === 'Enter' && focusedId) {
                e.preventDefault()
                setPanelUnitId(focusedId)
              }
            }}
          >
            <rect x={0} y={0} width={width} height={height} fill="var(--color-card)" />
            {nodes.map((node) =>
              node.children.map((child) => (
                <path
                  key={`${node.id}-${child.id}`}
                  d={`M ${node.x + MARGIN} ${node.y + NODE_H + MARGIN} V ${node.y + NODE_H + V_GAP / 2 + MARGIN} H ${child.x + MARGIN} V ${child.y + MARGIN}`}
                  fill="none"
                  stroke="var(--color-border)"
                  strokeWidth={1.5}
                />
              )),
            )}
            {nodes.map((node) => {
              const roles = actions.rolesByUnit.get(node.id) ?? []
              const head = roles.find((r) => r.role === 'head')
              const headMember = head ? actions.membersById.get(head.userId) : undefined
              const isFocused = node.id === focusedId
              return (
                <g
                  key={node.id}
                  ref={(el) => {
                    if (el) nodeRefs.current.set(node.id, el)
                    else nodeRefs.current.delete(node.id)
                  }}
                  role="treeitem"
                  aria-label={node.name}
                  aria-selected={isFocused}
                  tabIndex={isFocused ? 0 : -1}
                  transform={`translate(${node.x - NODE_W / 2 + MARGIN}, ${node.y + MARGIN})`}
                  onFocus={() => setFocusedId(node.id)}
                  onClick={() => {
                    setFocusedId(node.id)
                    setPanelUnitId(node.id)
                  }}
                  style={{ cursor: 'pointer', outline: 'none' }}
                >
                  <rect
                    width={NODE_W}
                    height={NODE_H}
                    rx={10}
                    fill="var(--color-card)"
                    stroke={isFocused ? 'var(--color-ring)' : 'var(--color-border)'}
                    strokeWidth={isFocused ? 2 : 1}
                  />
                  <rect x={0} y={0} width={6} height={NODE_H} rx={3} fill={unitFillVar(node)} />
                  <text
                    x={16}
                    y={24}
                    className="fill-foreground text-body"
                    style={{ fontWeight: 600 }}
                  >
                    {node.name.length > 22 ? `${node.name.slice(0, 21)}…` : node.name}
                  </text>
                  {head ? (
                    <>
                      <circle cx={24} cy={48} r={11} fill={unitFillVar(node)} />
                      <text x={24} y={52} textAnchor="middle" className="fill-white text-caption">
                        {headMember
                          ? `${headMember.givenName.charAt(0)}${headMember.familyName.charAt(0)}`.toUpperCase()
                          : '?'}
                      </text>
                      <text x={40} y={44} className="fill-foreground text-caption">
                        {headMember ? fullName(headMember) : head.userId}
                      </text>
                      <text x={40} y={58} className="fill-muted-foreground text-caption">
                        {t('structure.units.chart.headBadge')}
                      </text>
                    </>
                  ) : (
                    <>
                      {/* A vacant head slot draws the same way an unfilled position does on a Miro/
                          Lucidchart org chart -- a dashed placeholder, never just muted text, so the
                          gap in the org reads at a glance. */}
                      <circle
                        cx={24}
                        cy={48}
                        r={11}
                        fill="none"
                        stroke="var(--color-illustration-muted)"
                        strokeWidth={2}
                        strokeDasharray="3 3"
                      />
                      <text x={40} y={52} className="fill-muted-foreground text-caption">
                        {t('structure.units.chart.noHead')}
                      </text>
                    </>
                  )}
                  <text x={16} y={NODE_H - 10} className="fill-muted-foreground text-caption">
                    {t('structure.units.chart.memberCount', { count: roles.length })}
                  </text>
                </g>
              )
            })}
          </svg>
        </div>
      </div>

      <Sheet
        direction="right"
        open={panelUnitId !== null}
        onOpenChange={(open) => !open && setPanelUnitId(null)}
      >
        <SheetContent
          title={panelUnit?.name ?? ''}
          side="right"
          className="flex flex-col gap-5 overflow-y-auto p-5"
        >
          {panelUnit ? (
            <>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  {panelBreadcrumb.length > 1 ? (
                    <p className="truncate text-caption text-muted-foreground">
                      {panelBreadcrumb
                        .slice(0, -1)
                        .map((n) => n.name)
                        .join(' / ')}
                    </p>
                  ) : null}
                  <div className="flex items-center gap-2">
                    <span
                      aria-hidden="true"
                      className="size-3 shrink-0 rounded-full"
                      style={{ backgroundColor: unitFillVar(panelUnit) }}
                    />
                    <h2 className="text-h3 text-foreground">{panelUnit.name}</h2>
                  </div>
                </div>
                <IconButton
                  aria-label={t('structure.units.chart.closePanel')}
                  onClick={() => setPanelUnitId(null)}
                >
                  <X className="size-4" aria-hidden="true" />
                </IconButton>
              </div>

              <p className="text-small text-muted-foreground">
                {t('structure.units.chart.memberCount', { count: panelRoles.length })}
              </p>

              {panelHead ? (
                <p className="text-small text-foreground">
                  {t('structure.units.chart.headBadge')}:{' '}
                  {panelHeadMember ? fullName(panelHeadMember) : panelHead.userId}
                </p>
              ) : (
                <p className="text-small text-muted-foreground">
                  {t('structure.units.chart.noHead')}
                </p>
              )}

              <div className="flex flex-col gap-2">
                <span className="text-eyebrow uppercase tracking-(--text-eyebrow--letter-spacing) text-muted-foreground">
                  {t('structure.roles.assign')}
                </span>
                <RoleChips unit={panelUnit} actions={actions} indent={false} />
              </div>
            </>
          ) : null}
        </SheetContent>
      </Sheet>
    </div>
  )
}
