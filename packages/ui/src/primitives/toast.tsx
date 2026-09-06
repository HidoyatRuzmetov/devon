import * as React from 'react'
import { Toaster as SonnerToaster, toast as sonnerToast } from 'sonner'
import { Button } from './button.js'
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
      duration={5000}
      gap={12}
      toastOptions={{
        unstyled: false,
        classNames: {
          toast:
            'rounded-md border border-border bg-card text-foreground shadow-2 text-body ' +
            (reduced ? '' : 'data-[state=open]:animate-[devon-fade-in_220ms_var(--ease-out)]'),
          actionButton: 'bg-primary text-primary-foreground',
        },
      }}
      {...props}
    />
  )
}

export interface UndoToastOptions {
  message: string
  undoLabel: string
  onUndo: () => void
}

/** The one toast pattern this epic actually needs (spec.md §14 NIT-11: "the Toast component's undo
 * variant should carry a story and a unit test now"). Every other call site uses `toast(message)`
 * directly from `sonner`. */
export function toastWithUndo({ message, undoLabel, onUndo }: UndoToastOptions): void {
  sonnerToast(message, {
    action: (
      <Button size="sm" variant="secondary" onClick={onUndo}>
        {undoLabel}
      </Button>
    ),
  })
}

export { toast } from 'sonner'
