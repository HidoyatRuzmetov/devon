// The org chart view (TECH-SPEC EPIC-003: "an org chart view ... that renders a department with zero
// unit heads and one with three levels equally well, keyboard navigable, PNG export"). A hand-written
// SVG tree -- no charting library -- built from the same `TreeNode[]` the list view uses, so the two
// views can never disagree about the shape of the tree.
import * as React from 'react'
import { useT } from '@devon/i18n'
import { Button, unitHueClass } from '@devon/ui'
import { Download } from 'lucide-react'
import type { MembersById, RolesByUnit } from './api.js'
import type { TreeNode } from './unit-tree.js'
import { fullName } from './member-card.js'

const NODE_W = 188
const NODE_H = 88
const H_GAP = 28
const V_GAP = 56
const MARGIN = 32

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

export function OrgChart({
  roots,
  rolesByUnit,
  membersById,
  departmentName,
}: {
  roots: TreeNode[]
  rolesByUnit: RolesByUnit
  membersById: MembersById
  departmentName: string
}) {
  const t = useT()
  const svgRef = React.useRef<SVGSVGElement>(null)
  const { nodes, width, height } = React.useMemo(() => layout(roots), [roots])
  const [focusedId, setFocusedId] = React.useState<string | null>(nodes[0]?.id ?? null)

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

  return (
    <div className="flex flex-col gap-3">
      <div className="flex justify-end">
        <Button variant="secondary" size="sm" onClick={exportPng}>
          <Download className="size-4" aria-hidden="true" />
          {t('structure.units.chart.exportPng')}
        </Button>
      </div>
      <p className="sr-only" id="org-chart-keyboard-hint">
        {t('structure.units.chart.keyboardHint')}
      </p>
      <div className="overflow-auto rounded-md border border-border bg-card p-4">
        <svg
          ref={svgRef}
          role="tree"
          aria-describedby="org-chart-keyboard-hint"
          width={width}
          height={height}
          viewBox={`0 0 ${width} ${height}`}
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
            const roles = rolesByUnit.get(node.id) ?? []
            const head = roles.find((r) => r.role === 'head')
            const headMember = head ? membersById.get(head.userId) : undefined
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
                onClick={() => setFocusedId(node.id)}
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
                  <text x={16} y={48} className="fill-muted-foreground text-caption">
                    {t('structure.units.chart.noHead')}
                  </text>
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
  )
}
