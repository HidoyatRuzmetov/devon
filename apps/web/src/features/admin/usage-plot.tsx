import { useT } from '@devon/i18n'
import * as React from 'react'
import { type UsageMetric, type usageBuckets } from './usage-series.js'
import { UsageCurves, departmentColor } from './usage-curves.js'
import { usageAxisTicks } from './usage-axis.js'

type Bucket = ReturnType<typeof usageBuckets>[number]
export type PlotDepartment = { id: string; name: string; colorIndex: number }

export function UsagePlot({
  buckets,
  departments,
  visible,
  metric,
  locale,
  bucketLabel,
}: {
  buckets: Bucket[]
  departments: PlotDepartment[]
  visible: PlotDepartment[]
  metric: UsageMetric
  locale: string
  bucketLabel: (bucket: Bucket, full: boolean) => string
}) {
  const t = useT()
  const plot = React.useRef<HTMLDivElement>(null)
  const [width, setWidth] = React.useState(720)
  const [cursor, setCursor] = React.useState<number | null>(null)
  React.useEffect(() => {
    const node = plot.current
    if (!node || typeof ResizeObserver === 'undefined') return
    const resize = new ResizeObserver(([entry]) => {
      if (entry) setWidth(entry.contentRect.width)
    })
    resize.observe(node)
    return () => resize.disconnect()
  }, [])
  const compact = new Intl.NumberFormat(locale, { notation: 'compact', maximumFractionDigits: 1 })
  const number = new Intl.NumberFormat(locale)
  const getSum = (bucket: Bucket) =>
    visible.reduce((sum, dept) => sum + (bucket.values.get(dept.id)?.[metric] ?? 0), 0)
  const max = Math.max(1, ...buckets.map(getSum))
  const magnitude = 10 ** Math.floor(Math.log10(max))
  const ceiling = ([1, 2, 4, 5, 8, 10].find((n) => n * magnitude >= max) ?? 10) * magnitude
  const ticks = ceiling < 4 ? [0, ceiling] : [0, ceiling / 2, ceiling]
  const count = buckets.length
  const axis = React.useMemo(() => usageAxisTicks(buckets, width, locale), [buckets, width, locale])
  const active = cursor === null ? null : Math.min(count - 1, cursor)
  const bucket = active === null ? null : buckets[active]
  return (
    <div className="usage-plot-frame">
      <div className="usage-scale" aria-hidden="true">
        {ticks.map((tick) => (
          <span key={tick} style={{ bottom: (tick / ceiling) * 100 + '%' }}>
            {compact.format(tick)}
          </span>
        ))}
      </div>
      <div
        className="usage-plot"
        ref={plot}
        tabIndex={0}
        role="slider"
        aria-label={t('admin.usage.explore')}
        aria-valuemin={1}
        aria-valuemax={count}
        aria-valuenow={(active ?? count - 1) + 1}
        aria-valuetext={
          bucketLabel(buckets[active ?? count - 1]!, true) +
          ' · ' +
          number.format(getSum(buckets[active ?? count - 1]!))
        }
        onFocus={() => setCursor((current) => current ?? count - 1)}
        onBlur={() => setCursor(null)}
        onPointerMove={(event) => {
          const rect = event.currentTarget.getBoundingClientRect()
          setCursor(
            Math.max(
              0,
              Math.min(count - 1, Math.floor(((event.clientX - rect.left) * count) / rect.width)),
            ),
          )
        }}
        onPointerLeave={() => {
          if (document.activeElement !== plot.current) setCursor(null)
        }}
        onKeyDown={(event) => {
          const base = active ?? count - 1
          const keys: Record<string, number | null> = {
            ArrowLeft: Math.max(0, base - 1),
            ArrowRight: Math.min(count - 1, base + 1),
            ArrowDown: Math.max(0, base - 1),
            ArrowUp: Math.min(count - 1, base + 1),
            Home: 0,
            End: count - 1,
            Escape: null,
          }
          if (!(event.key in keys)) return
          event.preventDefault()
          setCursor(keys[event.key] ?? null)
        }}
      >
        {ticks.map((tick) => (
          <div
            key={tick}
            className="usage-gridline"
            style={{ bottom: (tick / ceiling) * 100 + '%' }}
          />
        ))}
        <UsageCurves
          buckets={buckets}
          departments={departments}
          visible={visible}
          metric={metric}
          ceiling={ceiling}
        />
        {bucket && active !== null && (
          <div
            className="usage-crosshair"
            aria-hidden="true"
            style={{ left: ((active + 0.5) / count) * 100 + '%' }}
          >
            <i style={{ bottom: (getSum(bucket) / ceiling) * 100 + '%' }} />
          </div>
        )}
        {bucket && active !== null && (
          <div
            className="usage-tip"
            role="status"
            style={{
              left:
                (active + 0.5) / count < 0.5
                  ? 'min(' + ((active + 0.5) / count) * 100 + '%, max(0px, 100% - 14rem))'
                  : undefined,
              right:
                (active + 0.5) / count >= 0.5
                  ? 'min(' + ((count - active - 0.5) / count) * 100 + '%, max(0px, 100% - 14rem))'
                  : undefined,
            }}
          >
            <strong>{bucketLabel(bucket, true)}</strong>
            {visible.map((dept) => (
              <div key={dept.id} className="usage-tip-row">
                <i style={{ backgroundColor: departmentColor(dept.colorIndex) }} />
                <span>{dept.name}</span>
                <b>{number.format(bucket.values.get(dept.id)?.[metric] ?? 0)}</b>
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="usage-labels" aria-hidden="true">
        {axis.map(({ position, label }) => (
          <span
            key={position}
            style={{
              left: `clamp(${label.length * 3.5}px, ${position * 100}%, calc(100% - ${label.length * 3.5}px))`,
              transform: 'translateX(-50%)',
            }}
          >
            {label}
          </span>
        ))}
      </div>
    </div>
  )
}
