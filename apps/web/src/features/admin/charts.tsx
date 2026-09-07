// Small, dependency-free SVG chart primitives for the global analytics screen (TECH-SPEC §10:
// "polished visualisations"). No charting library exists in `apps/web`'s dependencies yet (TECH-SPEC
// §5 names Recharts for the product as a whole, landed by whichever epic ships the department-facing
// analytics page) -- adding one here, for one screen, would be a new workspace dependency this
// module's own scope does not otherwise need. These use only design tokens (`var(--...)` via
// Tailwind's arbitrary-value syntax, never a raw hex) so they render correctly in both themes.
import * as React from 'react'
import { cn, useReducedMotion } from '@devon/ui'

const STATUS_DOT_TONE: Record<'ok' | 'degraded' | 'down' | 'not_configured', string> = {
  ok: 'bg-success',
  degraded: 'bg-warning',
  down: 'bg-destructive',
  not_configured: 'bg-muted-foreground',
}

/** UI-OVERHAUL.md §2 "Admin console ... health page with live status dots": a heartbeat pulse on a
 * healthy check (Vercel/Supabase's own status-page convention), a still dot otherwise -- a degraded
 * or down service is not something to animate attention away from. `prefers-reduced-motion` drops
 * the pulse ring; the coloured dot alone still carries the status. */
export function StatusDot({
  status,
  className,
}: {
  status: 'ok' | 'degraded' | 'down' | 'not_configured'
  className?: string
}) {
  const reduced = useReducedMotion()
  const tone = STATUS_DOT_TONE[status]
  return (
    <span className={cn('relative inline-flex size-2.5 shrink-0', className)} aria-hidden="true">
      {status === 'ok' && !reduced ? (
        <span
          className={cn(
            'absolute inline-flex size-full animate-ping rounded-full opacity-60',
            tone,
          )}
        />
      ) : null}
      <span className={cn('relative inline-flex size-2.5 rounded-full', tone)} />
    </span>
  )
}

const DONUT_COLOURS = [
  'var(--color-primary)',
  'var(--color-success)',
  'var(--color-warning)',
  'var(--color-muted-foreground)',
]

/** UI-OVERHAUL.md §3 "Charts": draw-in on mount. Each segment's arc sweeps in from a hidden
 * `strokeDashoffset` (rather than growing `strokeDasharray` itself, which most browsers cannot
 * transition smoothly) to its real position one frame after mount. Reduced motion renders every
 * arc already in place. */
export function DonutChart({
  segments,
  size = 120,
}: {
  segments: { label: string; value: number }[]
  size?: number
}) {
  const total = segments.reduce((sum, s) => sum + s.value, 0)
  const radius = size / 2
  const stroke = radius * 0.32
  const innerRadius = radius - stroke / 2
  const circumference = 2 * Math.PI * innerRadius
  const reduced = useReducedMotion()
  const [drawn, setDrawn] = React.useState(reduced)
  React.useEffect(() => {
    if (reduced) return
    const id = requestAnimationFrame(() => setDrawn(true))
    return () => cancelAnimationFrame(id)
  }, [reduced])

  let offset = 0
  return (
    <svg
      viewBox={`0 0 ${size} ${size}`}
      width={size}
      height={size}
      role="img"
      aria-label={segments.map((s) => `${s.label}: ${s.value}`).join(', ')}
    >
      {total === 0 ? (
        <circle
          cx={radius}
          cy={radius}
          r={innerRadius}
          fill="none"
          stroke="var(--color-border)"
          strokeWidth={stroke}
        />
      ) : (
        segments.map((s, i) => {
          const fraction = s.value / total
          const dash = fraction * circumference
          const circle = (
            <circle
              key={s.label}
              cx={radius}
              cy={radius}
              r={innerRadius}
              fill="none"
              stroke={DONUT_COLOURS[i % DONUT_COLOURS.length]}
              strokeWidth={stroke}
              strokeDasharray={`${dash} ${circumference - dash}`}
              strokeDashoffset={drawn ? -offset : circumference}
              style={{ transition: 'stroke-dashoffset var(--dur-standard) var(--ease-out)' }}
              transform={`rotate(-90 ${radius} ${radius})`}
            />
          )
          offset += dash
          return circle
        })
      )}
      <text
        x={radius}
        y={radius}
        textAnchor="middle"
        dominantBaseline="central"
        className="fill-foreground"
        style={{ font: '600 20px inherit' }}
      >
        {total}
      </text>
    </svg>
  )
}

export function ChartLegend({ segments }: { segments: { label: string; value: number }[] }) {
  return (
    <ul className="flex flex-col gap-1.5">
      {segments.map((s, i) => (
        <li key={s.label} className="flex items-center gap-2 text-small text-foreground">
          <span
            aria-hidden="true"
            className="size-2.5 rounded-full"
            style={{ backgroundColor: DONUT_COLOURS[i % DONUT_COLOURS.length] }}
          />
          <span className="flex-1">{s.label}</span>
          <span className="font-medium tabular-nums">{s.value}</span>
        </li>
      ))}
    </ul>
  )
}

/** UI-OVERHAUL.md §3 "Charts": draw-in on mount, once. Every bar starts at 0 % and transitions to
 * its real height one animation frame after mount -- the CSS `transition-[height]` these bars
 * already carried only fired on a later *value* change (a re-fetch), never on the chart's own
 * first paint, since React sets that first `style.height` directly with nothing to transition
 * from. Reduced motion skips the 0 % frame entirely and renders at the final height immediately. */
export function BarChart({
  data,
  height = 140,
}: {
  data: { label: string; value: number }[]
  height?: number
}) {
  const max = Math.max(1, ...data.map((d) => d.value))
  const reduced = useReducedMotion()
  const [drawn, setDrawn] = React.useState(reduced)
  React.useEffect(() => {
    if (reduced) return
    const id = requestAnimationFrame(() => setDrawn(true))
    return () => cancelAnimationFrame(id)
  }, [reduced])
  return (
    <div
      className="flex items-end gap-2"
      style={{ height }}
      role="img"
      aria-label={data.map((d) => `${d.label}: ${d.value}`).join(', ')}
    >
      {data.map((d) => (
        <div key={d.label} className="flex flex-1 flex-col items-center gap-1.5">
          <div className="flex w-full flex-1 items-end">
            <div
              className="w-full rounded-t-sm bg-primary transition-[height] duration-(--dur-standard) ease-out"
              style={{ height: drawn ? `${Math.max(2, (d.value / max) * 100)}%` : '0%' }}
            />
          </div>
          <span className="text-caption text-muted-foreground">{d.label}</span>
        </div>
      ))}
    </div>
  )
}

/** For a tile whose value is not a number (a status word, a badge) -- `KpiTile` (`@devon/ui`) covers
 * every numeric counter; this is its non-numeric sibling, styled to match. */
export function StatTile({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1 rounded-md border border-border bg-surface-2 p-4 shadow-1">
      <span className="text-eyebrow uppercase tracking-(--text-eyebrow--letter-spacing) text-muted-foreground">
        {label}
      </span>
      <span className="font-display text-h1 text-foreground">{value}</span>
    </div>
  )
}
