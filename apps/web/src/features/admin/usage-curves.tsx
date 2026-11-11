import * as React from 'react'
import { useReducedMotion } from '@devon/ui'
import { stackUsageAreas } from './usage-area.js'
import { type UsageMetric, type usageBuckets } from './usage-series.js'

type Department = { id: string; colorIndex: number }
const palette = [
  'primary',
  'unit-5',
  'unit-2',
  'unit-7',
  'unit-4',
  'unit-8',
  'unit-6',
  'unit-3',
  'unit-1',
]
export const departmentColor = (i: number) => `var(--color-${palette[i % palette.length]})`
const coord = (value: number) => Number(value.toFixed(3))
type Edge = { points: number[]; slopes: number[] }
function boundary(upper: number[], lower: Edge): Edge {
  const thickness = upper.map((v, i) => v - lower.points[i]!)
  // Compute tangents from each band's thickness before stacking. This keeps even a thin
  // band above zero across a steep rise or a day with no usage in several departments.
  const slopes = thickness.map((v, i) => {
    if (i === 0 || i === thickness.length - 1) return lower.slopes[i]!
    const before = v - thickness[i - 1]!,
      after = thickness[i + 1]! - v
    return lower.slopes[i]! + (before * after > 0 ? (2 * before * after) / (before + after) : 0)
  })
  return { points: upper, slopes }
}
function curve(edge: Edge, reverse = false) {
  const last = edge.points.length - 1
  const dx = 1000 / last
  const dir = reverse ? -1 : 1
  let i = reverse ? last : 0
  let path = coord(i * dx) + ',' + coord(edge.points[i]!)
  for (let n = 0; n < last; n++, i += dir) {
    const j = i + dir
    path +=
      'C' +
      coord((i + dir / 3) * dx) +
      ',' +
      coord(edge.points[i]! + (dir * edge.slopes[i]!) / 3) +
      ' ' +
      coord((j - dir / 3) * dx) +
      ',' +
      coord(edge.points[j]! - (dir * edge.slopes[j]!) / 3) +
      ' ' +
      coord(j * dx) +
      ',' +
      coord(edge.points[j]!)
  }
  return path
}
function SmoothPath({
  d,
  initial,
  ...props
}: { d: string; initial: string } & React.SVGProps<SVGPathElement>) {
  const element = React.useRef<SVGPathElement>(null)
  const previous = React.useRef(initial)
  const motion = React.useRef<Animation | null>(null)
  const reduced = useReducedMotion()
  React.useLayoutEffect(() => {
    const node = element.current
    if (!node) return
    const from = motion.current
      ? getComputedStyle(node).getPropertyValue('d')
      : `path('${previous.current}')`
    motion.current?.cancel()
    motion.current = null
    if (
      !reduced &&
      previous.current !== d &&
      node.animate &&
      CSS.supports('d', "path('M0,0 L1,1')")
    ) {
      const animation = node.animate([{ d: from }, { d: `path('${d}')` }], {
        duration: 230,
        easing: 'cubic-bezier(.22,.7,.25,1)',
      })
      motion.current = animation
      animation.onfinish = () => {
        if (motion.current === animation) motion.current = null
      }
    }
    previous.current = d
  }, [d, reduced])
  React.useEffect(() => () => motion.current?.cancel(), [])
  return <path ref={element} d={d} {...props} />
}

export function UsageCurves({
  buckets,
  departments,
  visible,
  metric,
  ceiling,
}: {
  buckets: ReturnType<typeof usageBuckets>
  departments: Department[]
  visible: Department[]
  metric: UsageMetric
  ceiling: number
}) {
  const gradient = React.useId().replaceAll(':', '')
  const shapes = React.useMemo(() => {
    const active = stackUsageAreas(buckets, visible, metric, ceiling)
    if (!active.length) return []
    const zeros = active[0]!.top.map(() => 100)
    let lower: Edge = { points: zeros, slopes: zeros.map(() => 0) }
    const flat = 'M' + curve(lower)
    const flatArea = flat + 'L' + curve(lower, true) + 'Z'
    const byId = new Map(active.map((layer) => [layer.id, layer.top]))
    return departments.map((dept) => {
      const values = byId.get(dept.id)
      const top = values ? boundary(values, lower) : lower
      const line = 'M' + curve(top)
      const result = {
        ...dept,
        line,
        area: line + 'L' + curve(lower, true) + 'Z',
        flat,
        flatArea,
        shown: !!values && values.some((v, i) => v < lower.points[i]! - 0.00001),
      }
      lower = top
      return result
    })
  }, [buckets, departments, visible, metric, ceiling])
  return (
    <svg
      className="usage-curves"
      viewBox="0 0 1000 100"
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <defs>
        {shapes.map((dept, i) => (
          <linearGradient
            key={dept.id}
            id={gradient + '-' + i}
            x1="0"
            x2="0"
            y1="0"
            y2="1"
            gradientUnits="objectBoundingBox"
          >
            <stop offset="0%" stopColor={departmentColor(dept.colorIndex)} stopOpacity=".64" />
            <stop offset="100%" stopColor={departmentColor(dept.colorIndex)} stopOpacity=".32" />
          </linearGradient>
        ))}
      </defs>
      {shapes.map((dept, i) => (
        <SmoothPath
          key={dept.id}
          data-usage-area={dept.id}
          d={dept.area}
          initial={dept.flatArea}
          fill={`url(#${gradient}-${i})`}
        />
      ))}
      {shapes.map((dept) => (
        <SmoothPath
          key={dept.id}
          data-usage-line={dept.id}
          d={dept.line}
          initial={dept.flat}
          stroke={departmentColor(dept.colorIndex)}
          opacity={dept.shown ? 1 : 0}
          vectorEffect="non-scaling-stroke"
          strokeWidth="2"
          fill="none"
        />
      ))}
    </svg>
  )
}
