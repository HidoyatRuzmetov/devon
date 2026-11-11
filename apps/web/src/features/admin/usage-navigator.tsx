import { useT } from '@devon/i18n'
import * as React from 'react'
import { clampDay, isoDay, type DayRange } from './usage-series.js'

type Drag = { part: 'from' | 'to' | 'window'; x: number; range: DayRange; id: number }

export function UsageNavigator({
  domain,
  range,
  path,
  onChange,
}: {
  domain: DayRange
  range: DayRange
  path: string
  onChange: (range: DayRange) => void
}) {
  const t = useT()
  const track = React.useRef<HTMLDivElement>(null)
  const drag = React.useRef<Drag | null>(null)
  const size = domain.to - domain.from + 1
  const position = (day: number) => ((day - domain.from) * 100) / size + '%'
  function move(part: Drag['part'], original: DayRange, delta: number) {
    if (part === 'window') {
      const offset = clampDay(delta, domain.from - original.from, domain.to - original.to)
      onChange({ from: original.from + offset, to: original.to + offset })
    } else if (part === 'from') {
      onChange({ ...original, from: clampDay(original.from + delta, domain.from, original.to) })
    } else onChange({ ...original, to: clampDay(original.to + delta, original.from, domain.to) })
  }
  function start(event: React.PointerEvent<HTMLDivElement>) {
    if (!event.isPrimary || event.button !== 0 || !track.current) return
    const hit = (event.target as Element).closest<HTMLElement>('[data-handle]')
    let part = hit?.dataset['handle'] as Drag['part'] | undefined
    let next = range
    if (!part) {
      const rect = track.current.getBoundingClientRect()
      const at = clampDay(
        domain.from + Math.floor(((event.clientX - rect.left) * size) / rect.width),
        domain.from,
        domain.to,
      )
      part = Math.abs(at - range.from) < Math.abs(at - range.to) ? 'from' : 'to'
      next =
        part === 'from'
          ? { ...range, from: Math.min(range.to, at) }
          : { ...range, to: Math.max(range.from, at) }
      onChange(next)
    }
    drag.current = { part, x: event.clientX, range: next, id: event.pointerId }
    event.currentTarget.setPointerCapture(event.pointerId)
  }
  function handle(part: 'from' | 'to') {
    const startSide = part === 'from'
    const min = startSide ? domain.from : range.from
    const max = startSide ? range.to : domain.to
    return (
      <button
        type="button"
        role="slider"
        data-handle={part}
        className={'usage-handle usage-' + part}
        style={{ left: position(range[part] + (startSide ? 0 : 1)) }}
        aria-label={t(startSide ? 'admin.usage.start' : 'admin.usage.end')}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={range[part]}
        aria-valuetext={isoDay(range[part])}
        onKeyDown={(event) => {
          const step = event.shiftKey ? 7 : 1
          const offsets: Record<string, number> = {
            ArrowLeft: -step,
            ArrowDown: -step,
            ArrowRight: step,
            ArrowUp: step,
            PageUp: 7,
            PageDown: -7,
            Home: min - range[part],
            End: max - range[part],
          }
          const delta = offsets[event.key]
          if (delta === undefined) return
          event.preventDefault()
          move(part, range, delta)
        }}
      >
        <span aria-hidden="true" />
      </button>
    )
  }
  return (
    <div className="usage-navigator">
      <div
        ref={track}
        className="usage-track"
        onPointerDown={start}
        onPointerMove={(event) => {
          const active = drag.current
          if (!active || active.id !== event.pointerId || !track.current) return
          move(
            active.part,
            active.range,
            Math.round(
              ((event.clientX - active.x) * size) / track.current.getBoundingClientRect().width,
            ),
          )
        }}
        onLostPointerCapture={() => {
          drag.current = null
        }}
        onPointerCancel={() => {
          drag.current = null
        }}
        onPointerUp={() => {
          drag.current = null
        }}
      >
        <svg viewBox="0 0 1000 40" preserveAspectRatio="none" aria-hidden="true">
          <path d={path} />
        </svg>
        <div
          className="usage-window"
          data-handle="window"
          style={{
            left: position(range.from),
            width: ((range.to - range.from + 1) * 100) / size + '%',
          }}
        />
        {handle('from')}
        {handle('to')}
      </div>
    </div>
  )
}
