// Small, dependency-free SVG chart primitives for the global analytics screen (TECH-SPEC §10:
// "polished visualisations"). No charting library exists in `apps/web`'s dependencies yet (TECH-SPEC
// §5 names Recharts for the product as a whole, landed by whichever epic ships the department-facing
// analytics page) -- adding one here, for one screen, would be a new workspace dependency this
// module's own scope does not otherwise need. These use only design tokens (`var(--...)` via
// Tailwind's arbitrary-value syntax, never a raw hex) so they render correctly in both themes.
import * as React from 'react'

const DONUT_COLOURS = [
  'var(--color-primary)',
  'var(--color-success)',
  'var(--color-warning)',
  'var(--color-muted-foreground)',
]

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
              strokeDashoffset={-offset}
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

export function BarChart({
  data,
  height = 140,
}: {
  data: { label: string; value: number }[]
  height?: number
}) {
  const max = Math.max(1, ...data.map((d) => d.value))
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
              style={{ height: `${Math.max(2, (d.value / max) * 100)}%` }}
            />
          </div>
          <span className="text-caption text-muted-foreground">{d.label}</span>
        </div>
      ))}
    </div>
  )
}

export function StatTile({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1 rounded-md border border-border bg-card p-4">
      <span className="text-small text-muted-foreground">{label}</span>
      <span className="text-h2 font-medium tabular-nums text-foreground">{value}</span>
    </div>
  )
}
