import * as React from 'react'
import { AlertTriangle, Check, Pencil, Sparkles, X } from 'lucide-react'
import { cn } from '../lib/cn.js'
import { Button } from './button.js'
import { Shimmer } from '../motion/shimmer.js'
import { Reveal } from '../motion/reveal.js'
import { Collapsible } from '../motion/collapsible.js'

export interface AiPreviewPanelProps {
  /** What this preview is, e.g. "Vazifa tavsifi taklifi". */
  title: string
  /** Pending → a streaming-feel skeleton; ready → the `children` slot; error → `errorMessage`. */
  status: 'pending' | 'ready' | 'error'
  /** The generated result. Rendered only when `status === 'ready'`. */
  children?: React.ReactNode
  /** One line under the result: tokens and latency, or a budget line. TECH-SPEC §8 requires the cost
   * of every run to be visible -- an AI feature whose price is hidden is not one a ministry can
   * sign off. */
  costLine?: string
  errorMessage?: string
  /** Labels -- this package holds no message catalogue of its own for feature copy. */
  acceptLabel: string
  editLabel: string
  discardLabel: string
  retryLabel?: string
  /** Shown while pending, e.g. "Tayyorlanmoqda…". Announced politely, so a screen-reader user knows
   * something is happening without the panel stealing focus. */
  pendingLabel: string
  onAccept: () => void
  onEdit: () => void
  onDiscard: () => void
  onRetry?: () => void
  className?: string
}

/** UI-OVERHAUL.md §2 "AI helpers": the preview panel every AI feature in the product shows before
 * anything is written. Pure UI -- it fetches nothing and knows no feature: the data hook
 * (`useRunAiFeatureMutation`) and the feature descriptors (`FEATURE_FORMS`) stay in
 * `apps/web/src/features/ai`, and this panel is handed their output.
 *
 * The rule it exists to enforce (TECH-SPEC §8): **the user always sees a preview and accepts.**
 * There is no `autoApply` prop and no way to render this panel without all three of Accept, Edit and
 * Discard -- a generated result never lands in the user's work behind their back. */
export function AiPreviewPanel({
  title,
  status,
  children,
  costLine,
  errorMessage,
  acceptLabel,
  editLabel,
  discardLabel,
  retryLabel,
  pendingLabel,
  onAccept,
  onEdit,
  onDiscard,
  onRetry,
  className,
}: AiPreviewPanelProps): React.JSX.Element {
  return (
    <Reveal
      className={cn(
        'flex flex-col overflow-hidden rounded-md border border-primary/30 bg-surface-2 shadow-1',
        className,
      )}
    >
      <header className="flex items-center gap-2 border-b border-border px-4 py-2.5">
        <Sparkles className="size-4 shrink-0 text-primary" aria-hidden="true" />
        <h3 className="min-w-0 flex-1 truncate text-small font-medium text-foreground">{title}</h3>
      </header>

      <div className="px-4 py-4">
        {status === 'pending' ? (
          // A "streaming feel": three lines of shimmer at decreasing width, the shape text arrives
          // in. Not a spinner -- spec.md §5's rule -- and not a fake token-by-token reveal, which
          // would imply a streaming transport this panel does not have.
          <div role="status" aria-live="polite" className="flex flex-col gap-2">
            <span className="sr-only">{pendingLabel}</span>
            <Shimmer className="h-4 w-full" />
            <Shimmer className="h-4 w-[88%]" />
            <Shimmer className="h-4 w-[64%]" />
          </div>
        ) : status === 'error' ? (
          <div role="alert" className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden="true" />
            <p className="min-w-0 text-body text-foreground">{errorMessage}</p>
          </div>
        ) : (
          <div className="min-w-0 text-body text-foreground">{children}</div>
        )}
      </div>

      <Collapsible open={status !== 'pending'}>
        <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-border bg-card px-4 py-3">
          {costLine ? (
            <span className="text-caption tabular-nums text-muted-foreground">{costLine}</span>
          ) : (
            <span />
          )}
          <div className="flex flex-wrap items-center gap-2">
            {status === 'error' ? (
              <>
                {onRetry && retryLabel ? (
                  <Button size="sm" variant="secondary" onClick={onRetry}>
                    {retryLabel}
                  </Button>
                ) : null}
                <Button size="sm" variant="ghost" onClick={onDiscard}>
                  <X className="size-3.5" aria-hidden="true" />
                  {discardLabel}
                </Button>
              </>
            ) : (
              <>
                <Button size="sm" variant="ghost" onClick={onDiscard}>
                  <X className="size-3.5" aria-hidden="true" />
                  {discardLabel}
                </Button>
                <Button size="sm" variant="secondary" onClick={onEdit}>
                  <Pencil className="size-3.5" aria-hidden="true" />
                  {editLabel}
                </Button>
                <Button data-primary size="sm" onClick={onAccept}>
                  <Check className="size-3.5" aria-hidden="true" />
                  {acceptLabel}
                </Button>
              </>
            )}
          </div>
        </footer>
      </Collapsible>
    </Reveal>
  )
}
