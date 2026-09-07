import * as React from 'react'
import { Toaster as SonnerToaster, toast as sonnerToast } from 'sonner'
import { Undo2 } from 'lucide-react'
import { cn } from '../lib/cn.js'
import { useReducedMotion } from '../lib/use-reduced-motion.js'

/** DESIGN.md §8.5: 5s dwell with a progress bar, `aria-live="polite"`, hover/focus pauses the
 * timer, Esc dismisses (Sonner's own default), undo where reversible. Position: bottom-right
 * >=1024, bottom-centre at 390 (spec.md §3.1) -- `position` below is the >=1024 default; callers on
 * a route that must render the 390 layout pass `position="bottom-center"` explicitly (this package
 * ships no viewport sniffing, per its "no scope creep" rule -- apps/web owns the breakpoint switch). */
export function Toaster(props: React.ComponentProps<typeof SonnerToaster>) {
  const reduced = useReducedMotion()
  return (
    <SonnerToaster
      position="bottom-right"
      duration={TOAST_DURATION_MS}
      gap={12}
      toastOptions={{
        unstyled: false,
        classNames: {
          toast:
            'rounded-md border border-border bg-surface-3 text-foreground shadow-2 text-body ' +
            (reduced ? '' : 'data-[state=open]:animate-[devon-fade-in_220ms_var(--ease-out)]'),
          actionButton: 'bg-primary text-primary-foreground',
        },
      }}
      {...props}
    />
  )
}

/** The dwell every Devon toast gets, and the length the undo bar shrinks over. One constant so the
 * bar can never disagree with the timer that is actually running. */
export const TOAST_DURATION_MS = 5000

export interface UndoToastOptions {
  message: string
  undoLabel: string
  onUndo: () => void
  /** Overrides the 5 s default -- e.g. a bulk archive that deserves longer to think about. */
  durationMs?: number
}

/** UI-OVERHAUL.md §3 "Toast": slide up, with the undo action carrying a *shrinking progress bar* so
 * the user can see how long they still have (Gmail's convention -- Jakob's Law).
 *
 * The bar is a CSS transition on a scaled pseudo-track rather than a per-frame JS animation: a
 * toast that costs an animation frame for five seconds is the wrong trade for a confirmation. Under
 * reduced motion the bar is replaced with a static full-width rule -- the affordance ("there is a
 * window to undo this") survives, only its countdown stops moving. */
export function toastWithUndo({
  message,
  undoLabel,
  onUndo,
  durationMs = TOAST_DURATION_MS,
}: UndoToastOptions): void {
  sonnerToast.custom(
    (id) => (
      <UndoToast
        message={message}
        undoLabel={undoLabel}
        durationMs={durationMs}
        onUndo={() => {
          onUndo()
          sonnerToast.dismiss(id)
        }}
      />
    ),
    { duration: durationMs },
  )
}

function UndoToast({
  message,
  undoLabel,
  durationMs,
  onUndo,
}: {
  message: string
  undoLabel: string
  durationMs: number
  onUndo: () => void
}) {
  const reduced = useReducedMotion()
  const [started, setStarted] = React.useState(false)

  // One frame at full width, then transition to zero: a CSS transition cannot animate *from* a value
  // it was never painted at.
  React.useEffect(() => {
    const raf = requestAnimationFrame(() => setStarted(true))
    return () => cancelAnimationFrame(raf)
  }, [])

  return (
    <div className="relative flex w-full min-w-70 items-center gap-3 overflow-hidden rounded-md border border-border bg-surface-3 px-4 py-3 text-body text-foreground shadow-2">
      <span className="min-w-0 flex-1">{message}</span>
      <button
        type="button"
        onClick={onUndo}
        className={cn(
          'inline-flex shrink-0 items-center gap-1.5 rounded-sm border border-border bg-card px-2.5 py-1.5',
          'text-small font-medium text-foreground transition-colors duration-(--dur-micro)',
          'hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          'focus-visible:ring-offset-2',
        )}
      >
        <Undo2 className="size-3.5" aria-hidden="true" />
        {undoLabel}
      </button>
      <span
        aria-hidden="true"
        className="absolute inset-x-0 bottom-0 h-0.5 origin-left bg-primary"
        style={
          reduced
            ? { transform: 'scaleX(1)' }
            : {
                transform: started ? 'scaleX(0)' : 'scaleX(1)',
                transitionProperty: 'transform',
                transitionDuration: `${durationMs}ms`,
                transitionTimingFunction: 'linear',
              }
        }
      />
    </div>
  )
}

export { toast } from 'sonner'
