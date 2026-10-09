import * as React from 'react'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import { useT } from '@devon/i18n'
import { cn } from '../lib/cn.js'

export const Dialog = DialogPrimitive.Root
export const DialogTrigger = DialogPrimitive.Trigger
export const DialogClose = DialogPrimitive.Close

export const DialogOverlay = React.forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn(
      // UI-OVERHAUL.md §3 "Dialog": the backdrop *blurs* the page behind it as it fades, so the
      // dialog reads as being in front of the work rather than pasted over it.
      'fixed inset-0 z-50 bg-foreground/30 backdrop-blur-[3px]',
      'data-[state=open]:animate-[devon-fade-in_220ms_var(--ease-out)]',
      'data-[state=closed]:animate-[devon-fade-out_140ms_var(--ease-in)]',
      className,
    )}
    {...props}
  />
))
DialogOverlay.displayName = 'DialogOverlay'

export interface DialogContentProps extends React.ComponentPropsWithoutRef<
  typeof DialogPrimitive.Content
> {
  /** Every dialog needs a title for screen readers (WCAG). Pass `hideTitle` only when the visible
   * heading inside `children` already serves that role via `aria-labelledby` wiring done by the
   * caller -- default is to render it (visually or as `sr-only` via className on DialogTitle). */
  title: string
  showClose?: boolean
  /** The CommandPalette needs an accessible name (WCAG) without a visible heading -- its structure
   * starts directly with the search input (spec.md §5). */
  titleHidden?: boolean
}

export const DialogContent = React.forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Content>,
  DialogContentProps
>(({ className, title, showClose = true, titleHidden = false, children, ...props }, ref) => {
  const t = useT()
  return (
    <DialogPrimitive.Portal>
      <DialogOverlay />
      <DialogPrimitive.Content
        ref={ref}
        className={cn(
          'fixed left-1/2 top-1/2 z-50 w-full max-w-120 -translate-x-1/2 -translate-y-1/2',
          'max-h-[calc(100dvh-2rem)] overflow-y-auto',
          'rounded-lg border border-border bg-surface-3 p-6 shadow-3',
          'data-[state=open]:animate-[devon-dialog-in_220ms_var(--ease-out)]',
          'data-[state=closed]:animate-[devon-fade-out_140ms_var(--ease-in)]',
          className,
        )}
        {...props}
      >
        <DialogPrimitive.Title
          className={
            titleHidden
              ? 'sr-only'
              : cn('break-words text-h3 text-foreground', showClose && 'pr-10')
          }
        >
          {title}
        </DialogPrimitive.Title>
        {children}
        {showClose ? (
          <DialogPrimitive.Close
            className={cn(
              'absolute right-4 top-4 inline-flex size-9 max-md:size-11 items-center justify-center rounded-sm',
              'text-muted-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2',
              'focus-visible:ring-ring focus-visible:ring-offset-2',
            )}
            aria-label={t('shell.shortcuts.close')}
          >
            <X className="size-4" aria-hidden="true" />
          </DialogPrimitive.Close>
        ) : null}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  )
})
DialogContent.displayName = 'DialogContent'

export const DialogDescription = DialogPrimitive.Description
