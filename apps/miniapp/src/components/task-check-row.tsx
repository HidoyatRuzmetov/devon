// One row of the private "Bugun" list: the whole row *is* the checkbox.
//
// Why this exists instead of `@devon/ui`'s `Checkbox` plus a `<label htmlFor>`. That primitive is a
// Radix root, which renders a `<button role="checkbox">` — and a `<button>` is not a labelable
// element, so `<label for>` gives it neither an accessible name nor a second tap target; outside a
// `<form>` Radix does not render its hidden companion input either, so the association never happens
// at all. Verified in the browser before this file existed: the box announced itself as an unnamed
// checkbox, and tapping the task's own text did nothing. On a phone that leaves a 20 px target on a
// screen whose entire purpose is ticking things off.
//
// So the row is one `<button role="checkbox" aria-checked>`: one tab stop, Space and Enter for free,
// the task's title as its accessible name, and a target the full width of the sheet. The box inside
// is decoration (`aria-hidden`) that reuses the same `AnimatedCheck` the primitive draws, and the
// same coin-sized `Celebrate` burst fires from it on completion (DESIGN.md §2.5's second celebration
// moment). If `@devon/ui` ever grows a labelled, full-row checkbox, this is the thing to delete.
import * as React from 'react'
import { AnimatedCheck, Celebrate, cn } from '@devon/ui'
import { rowSurface } from './bits.js'

export function TaskCheckRow({
  title,
  done,
  onToggle,
}: {
  title: string
  done: boolean
  /** Called with the value the row should take, never with a toggle of unknown provenance. */
  onToggle: (next: boolean) => void
}): React.ReactElement {
  const [burst, setBurst] = React.useState(false)
  const wasDone = React.useRef(done)

  React.useEffect(() => {
    if (done && !wasDone.current) setBurst(true)
    wasDone.current = done
  }, [done])

  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={done}
      onClick={() => onToggle(!done)}
      className={cn(rowSurface, 'flex min-h-11 items-start gap-3 py-2.5')}
    >
      <span
        aria-hidden="true"
        className={cn(
          'border-border text-primary-foreground relative mt-0.5 inline-flex size-5 shrink-0',
          'items-center justify-center rounded-sm border',
          'transition-colors duration-(--dur-micro) ease-out',
          done ? 'border-primary bg-primary' : 'bg-card',
        )}
      >
        <AnimatedCheck checked={done} className="size-3.5" />
        <Celebrate play={burst} onDone={() => setBurst(false)} />
      </span>
      <span
        className={cn(
          'min-w-0 flex-1 text-[14px] leading-5',
          // The catalogue's "text strikes through" half of the done moment.
          done ? 'text-muted-foreground line-through' : 'text-foreground',
        )}
      >
        {title}
      </span>
    </button>
  )
}
