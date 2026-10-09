// The org chart view (TECH-SPEC EPIC-003: "an org chart view ... that renders a department with zero
// unit heads and one with three levels equally well, keyboard navigable, PNG export"). A hand-written
// SVG tree -- no charting library -- built from the same `TreeNode[]` the list view uses, so the two
// views can never disagree about the shape of the tree. UI-OVERHAUL.md's Jakob row for this screen
// (Miro/Lucidchart org charts): unit colours, vacancies dashed, zoom/pan, click to open a side panel.
import * as React from 'react'
import { useT } from '@devon/i18n'
import { Button, IconButton, Sheet, SheetContent, unitHueClass, toast } from '@devon/ui'
import { Download, Minus, Plus, RotateCcw, X } from 'lucide-react'
import type { TreeActions, TreeNode } from './unit-tree.js'
import { RoleChips } from './unit-tree.js'
import { fullName } from './member-card.js'

const NODE_W = 244
const NODE_H = 116
const H_GAP = 28
const V_GAP = 56
const MARGIN = 32
const MIN_SCALE = 0.15
const MAX_SCALE = 2
function wrappedLines(text: string, width: number, measure: (text: string) => number): string[] {
  const lines: string[] = []
  let line = ''
  for (const word of text.trim().split(/\s+/)) {
    const candidate = line ? `${line} ${word}` : word
    if (measure(candidate) <= width) {
      line = candidate
      continue
    }
    if (line) lines.push(line)
    line = ''
    // A name can contain a long unbroken word; retain every character in both the chart and PNG.
    for (const character of Array.from(word)) {
      if (line && measure(line + character) > width) {
        lines.push(line)
        line = ''
      }
      line += character
    }
  }
  if (line) lines.push(line)
  return lines.length ? lines : ['']
}

interface Positioned extends Omit<TreeNode, 'children'> {
  x: number
  y: number
  width: number
  depth: number
  children: Positioned[]
}

function layout(
  roots: TreeNode[],
  textScale: number,
  logicalNodeHeight: number,
): {
  nodes: Positioned[]
  width: number
  height: number
  maxDepth: number
} {
  const flat: Positioned[] = []
  let maxDepth = 0
  const nodeWidth = NODE_W * textScale
  const nodeHeight = logicalNodeHeight * textScale
  const horizontalGap = H_GAP * textScale
  const verticalGap = V_GAP * textScale

  function widthOf(node: TreeNode): number {
    if (node.children.length === 0) return nodeWidth
    const childWidths = node.children.map(widthOf)
    const total =
      childWidths.reduce((a, b) => a + b, 0) + horizontalGap * (node.children.length - 1)
    return Math.max(nodeWidth, total)
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
        cursor += placedChild.width + horizontalGap
      }
      const first = children[0]!
      const last = children[children.length - 1]!
      x = (first.x + last.x) / 2
    }
    const positioned: Positioned = {
      ...node,
      children,
      x,
      y: depth * (nodeHeight + verticalGap),
      width,
      depth,
    }
    flat.push(positioned)
    return positioned
  }

  let cursor = 0
  for (const root of roots) {
    const placed = place(root, 0, cursor)
    cursor += placed.width + horizontalGap
  }

  const totalWidth = Math.max(cursor - horizontalGap, nodeWidth)
  return {
    nodes: flat,
    width: totalWidth + MARGIN * 2,
    height: (maxDepth + 1) * (nodeHeight + verticalGap) - verticalGap + MARGIN * 2,
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
  const fontMetricRef = React.useRef<HTMLSpanElement>(null)
  const [fontMetrics, setFontMetrics] = React.useState({
    scale: 1,
    small: 13,
    caption: 12,
    family: 'Arial, sans-serif',
    glyphWidth: 0,
  })
  const textScale = fontMetrics.scale
  React.useLayoutEffect(() => {
    const metric = fontMetricRef.current
    if (!metric) return
    const measure = () => {
      const styles = getComputedStyle(metric)
      const small = Number.parseFloat(styles.fontSize)
      const caption = Number.parseFloat(getComputedStyle(metric.firstElementChild!).fontSize)
      const next = {
        scale: Math.max(1, small / 13, caption / 12),
        small,
        caption,
        family: styles.fontFamily,
        glyphWidth: metric.getBoundingClientRect().width,
      }
      setFontMetrics((current) =>
        Object.keys(next).every(
          (key) => current[key as keyof typeof current] === next[key as keyof typeof next],
        )
          ? current
          : next,
      )
    }
    measure()
    // Independent intrinsic glyphs respond to font-only enlargement without observing chart
    // geometry, whose own writes must not become a ResizeObserver feedback loop.
    const observer = new ResizeObserver(measure)
    observer.observe(metric)
    observer.observe(metric.firstElementChild!)
    return () => observer.disconnect()
  }, [])
  const chartRoots = React.useMemo<TreeNode[]>(
    () => [
      {
        id: 'department-root',
        parentUnitId: null,
        name: departmentName,
        colour: null,
        sort: 0,
        path: '',
        version: 1,
        children: roots.map((root) => ({ ...root, parentUnitId: 'department-root' })),
      },
    ],
    [roots, departmentName],
  )
  const nodeLabels = React.useMemo(() => {
    const canvas = document.createElement('canvas')
    const context = canvas.getContext('2d')
    const measure = (text: string, kind: 'small' | 'caption') => {
      const size = fontMetrics[kind] / fontMetrics.scale
      const weight = kind === 'small' ? 600 : 400
      if (!context) return Array.from(text).length * size
      context.font = `${weight} ${size}px ${fontMetrics.family}`
      const actual = context.measureText(text).width
      // Export uses a portable Arial fallback. Reserve enough width for both rendered fonts.
      context.font = `${weight} ${size}px Arial, sans-serif`
      return Math.max(actual, context.measureText(text).width)
    }
    const labels = new Map<string, { name: string[]; head: string[] }>()
    const stack = [...chartRoots]
    let extraTitleHeight = 0
    let extraHeadHeight = 0
    while (stack.length) {
      const node = stack.pop()!
      const head = (actions.rolesByUnit.get(node.id) ?? []).find((role) => role.role === 'head')
      const member =
        node.id === 'department-root'
          ? [...actions.membersById.values()].find((member) => member.membershipRole === 'head')
          : head
            ? actions.membersById.get(head.userId)
            : undefined
      const name = wrappedLines(node.name, NODE_W - 32, (text) => measure(text, 'small'))
      const headName = member
        ? wrappedLines(fullName(member), NODE_W - 56, (text) => measure(text, 'caption'))
        : []
      extraTitleHeight = Math.max(extraTitleHeight, Math.max(0, name.length - 2) * 18)
      extraHeadHeight = Math.max(extraHeadHeight, Math.max(0, headName.length - 1) * 18)
      labels.set(node.id, { name, head: headName })
      stack.push(...node.children)
    }
    return { labels, extraTitleHeight, extraHeadHeight }
  }, [chartRoots, actions.rolesByUnit, actions.membersById, fontMetrics])
  const logicalNodeHeight = NODE_H + nodeLabels.extraTitleHeight + nodeLabels.extraHeadHeight
  const { nodes, width, height } = React.useMemo(
    () => layout(chartRoots, textScale, logicalNodeHeight),
    [chartRoots, textScale, logicalNodeHeight],
  )
  const smallTextStyle = { fontSize: `calc(var(--text-small) / ${textScale})` }
  const captionTextStyle = { fontSize: `calc(var(--text-caption) / ${textScale})` }
  const [exporting, setExporting] = React.useState(false)
  const [focusedId, setFocusedId] = React.useState<string | null>('department-root')
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
    if (focusedId && svgRef.current?.contains(document.activeElement)) {
      const node = nodeRefs.current.get(focusedId)
      node?.focus()
      node?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    }
  }, [focusedId])
  React.useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) return
    const fit = () => {
      setZoom(Math.max(MIN_SCALE, Math.min(1, (viewport.clientWidth - 32) / width)))
      setPan({ x: 0, y: 0 })
    }
    fit()
    const observer = new ResizeObserver(fit)
    observer.observe(viewport)
    return () => observer.disconnect()
  }, [width])

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
    setZoom(
      Math.max(MIN_SCALE, Math.min(1, ((viewportRef.current?.clientWidth ?? width) - 32) / width)),
    )
    setPan({ x: 0, y: 0 })
  }

  const onWheel = (e: React.WheelEvent) => {
    if (!e.ctrlKey && !e.metaKey) return
    e.preventDefault()
    zoomBy(e.deltaY < 0 ? 1.08 : 0.93)
  }

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0 || (e.target as Element).closest('[role=treeitem]')) return
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
    setExporting(true)
    const scale = Math.min(2, 8192 / Math.max(width, height))
    // External SVG images cannot resolve our CSS classes/variables. Inline their computed paint
    // and typography; export the full tree independently of viewport zoom and pan.
    const clone = svg.cloneNode(true) as SVGSVGElement
    const originals = [svg, ...svg.querySelectorAll('*')]
    const copies = [clone, ...clone.querySelectorAll('*')]
    originals.forEach((element, index) => {
      const styles = getComputedStyle(element)
      const copy = copies[index] as SVGElement
      for (const property of [
        'fill',
        'stroke',
        'stroke-width',
        'font-size',
        'font-weight',
        'opacity',
      ]) {
        copy.style.setProperty(property, styles.getPropertyValue(property))
      }
      copy.style.fontFamily = 'Arial, sans-serif'
    })
    const serialized = new XMLSerializer().serializeToString(clone)
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
      if (!ctx) throw new Error('Canvas unavailable')
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
    } catch {
      toast.error(t('structure.units.chart.exportError'))
    } finally {
      setExporting(false)
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
      <span
        ref={fontMetricRef}
        aria-hidden="true"
        className="pointer-events-none fixed invisible font-semibold text-small"
        style={{ width: 'max-content', height: 'auto' }}
      >
        M<span className="font-normal text-caption">M</span>
      </span>
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
        <div className="inline-flex shrink-0 items-center gap-1 rounded-md border border-border bg-card p-0.5">
          <IconButton
            aria-label={t('structure.units.chart.zoomOut')}
            onClick={() => zoomBy(1 / 1.2)}
            disabled={zoom <= MIN_SCALE}
          >
            <Minus className="size-4" aria-hidden="true" />
          </IconButton>
          <span className="min-w-[3em] text-center text-caption tabular-nums text-muted-foreground">
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
        <Button variant="secondary" size="sm" onClick={exportPng} disabled={exporting}>
          <Download className="size-4" aria-hidden="true" />
          {t('structure.units.chart.exportPng')}
        </Button>
      </div>
      <p className="text-small text-muted-foreground" id="org-chart-keyboard-hint">
        {t('structure.units.chart.keyboardHint')}
      </p>
      <div
        ref={viewportRef}
        className="relative h-[min(70vh,640px)] touch-none overflow-auto rounded-md border border-border bg-card"
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
            aria-label={departmentName}
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
                if (focusedId !== 'department-root') setPanelUnitId(focusedId)
              }
            }}
          >
            <rect x={0} y={0} width={width} height={height} fill="var(--color-card)" />
            {/* Fixed SVG transforms keep connectors aligned and exportable at every zoom level. */}
            {nodes.map((node) =>
              node.children.map((child) => (
                <path
                  key={`${node.id}-${child.id}`}
                  d={`M ${node.x + MARGIN} ${node.y + logicalNodeHeight * textScale + MARGIN} V ${node.y + (logicalNodeHeight + V_GAP / 2) * textScale + MARGIN} H ${child.x + MARGIN} V ${child.y + MARGIN}`}
                  fill="none"
                  stroke="var(--color-muted-foreground)"
                  strokeWidth={1.5}
                />
              )),
            )}
            {nodes.map((node) => {
              const isDepartment = node.id === 'department-root'
              const roles = actions.rolesByUnit.get(node.id) ?? []
              const head = roles.find((r) => r.role === 'head')
              const headMember = isDepartment
                ? [...actions.membersById.values()].find((m) => m.membershipRole === 'head')
                : head
                  ? actions.membersById.get(head.userId)
                  : undefined
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
                  aria-level={node.depth + 1}
                  tabIndex={isFocused ? 0 : -1}
                  transform={`translate(${node.x - (NODE_W * textScale) / 2 + MARGIN} ${node.y + MARGIN}) scale(${textScale})`}
                  onFocus={() => setFocusedId(node.id)}
                  onClick={() => {
                    setFocusedId(node.id)
                    if (!isDepartment) setPanelUnitId(node.id)
                  }}
                  style={{ cursor: 'pointer', outline: 'none' }}
                >
                  <title>
                    {node.name}
                    {headMember ? ` — ${fullName(headMember)}` : ''}
                  </title>
                  <rect
                    width={NODE_W}
                    height={logicalNodeHeight}
                    rx={10}
                    fill="var(--color-card)"
                    stroke={isFocused ? 'var(--color-ring)' : 'var(--color-border)'}
                    strokeWidth={isFocused ? 2 : 1}
                  />
                  <rect
                    x={0}
                    y={0}
                    width={6}
                    height={logicalNodeHeight}
                    rx={3}
                    fill={unitFillVar(node)}
                  />
                  <text
                    x={16}
                    y={24}
                    className="fill-foreground text-small"
                    style={{ ...smallTextStyle, fontWeight: 600 }}
                  >
                    {nodeLabels.labels.get(node.id)!.name.map((line, index) => (
                      <tspan key={index} x={16} dy={index ? 18 : 0}>
                        {line}
                      </tspan>
                    ))}
                  </text>
                  {headMember ? (
                    <>
                      <circle
                        cx={24}
                        cy={70 + nodeLabels.extraTitleHeight}
                        r={11}
                        fill={unitFillVar(node)}
                      />
                      <text
                        x={24}
                        y={74 + nodeLabels.extraTitleHeight}
                        textAnchor="middle"
                        className="fill-white text-caption"
                        style={captionTextStyle}
                      >
                        {headMember
                          ? `${headMember.givenName.charAt(0)}${headMember.familyName.charAt(0)}`.toUpperCase()
                          : '?'}
                      </text>
                      <text
                        x={40}
                        y={64 + nodeLabels.extraTitleHeight}
                        className="fill-foreground text-caption"
                        style={captionTextStyle}
                      >
                        {nodeLabels.labels.get(node.id)!.head.map((line, index) => (
                          <tspan key={index} x={40} dy={index ? 18 : 0}>
                            {line}
                          </tspan>
                        ))}
                      </text>
                      <text
                        x={40}
                        y={82 + nodeLabels.extraTitleHeight + nodeLabels.extraHeadHeight}
                        className="fill-muted-foreground text-caption"
                        style={captionTextStyle}
                      >
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
                        cy={70 + nodeLabels.extraTitleHeight}
                        r={11}
                        fill="none"
                        stroke="var(--color-illustration-muted)"
                        strokeWidth={2}
                        strokeDasharray="3 3"
                      />
                      <text
                        x={40}
                        y={74 + nodeLabels.extraTitleHeight}
                        className="fill-muted-foreground text-caption"
                        style={captionTextStyle}
                      >
                        {t('structure.units.chart.noHead')}
                      </text>
                    </>
                  )}
                  <text
                    x={16}
                    y={logicalNodeHeight - 10}
                    className="fill-muted-foreground text-caption"
                    style={captionTextStyle}
                  >
                    {t('structure.units.chart.memberCount', {
                      count: isDepartment
                        ? actions.membersById.size
                        : (actions.memberCountByUnit.get(node.id) ?? 0),
                    })}
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
          onCloseAutoFocus={(event) => {
            event.preventDefault()
            nodeRefs.current.get(focusedId ?? 'department-root')?.focus()
          }}
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
