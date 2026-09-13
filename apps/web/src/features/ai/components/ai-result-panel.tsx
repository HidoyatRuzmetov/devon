// The one panel every AI affordance in the product renders (v1.1 SPEC §8 "Surfaces"). It wraps
// `@devon/ui`'s `AiPreviewPanel` -- which owns the skeleton, the Accept/Edit/Discard footer and the
// "never auto-applies" rule -- and adds the two things v1.1 requires of every AI surface and v1.0 had
// nowhere:
//
//   1. **The honesty strip.** When `meta.simulated` is true there is no API key on this deployment
//      and the answer came from `@devon/ai`'s offline simulator. An amber strip says so, and the cost
//      line is suppressed entirely rather than printing a price nobody paid (SPEC §8 "Honesty").
//   2. **The cost line in soʻm.** AI-AUDIT §5 fix 9: a ministry signs off on money, not on tokens.
//      Tokens stay, in the tooltip-sized caption after the price, because a head who wants to know
//      *why* something cost that much needs the number.
//
// It is deliberately not in `packages/ui`: the strip's copy is i18n, the price is a locale-formatted
// UZS amount, and both belong to the app. If a later merge wants it shared, it promotes cleanly --
// there is no app state in here, only props.
import * as React from 'react'
import { AiPreviewPanel, Badge, Button, Reveal, Shimmer, cn } from '@devon/ui'
import { AlertTriangle, Check, FlaskConical, Sparkles } from 'lucide-react'
import { useT, useLocale, formatUzs, formatNumber } from '@devon/i18n'
import type { RunMeta } from '../types.js'

export interface AiResultPanelProps {
  title: string
  status: 'pending' | 'ready' | 'error'
  meta?: RunMeta | undefined
  errorMessage?: string | undefined
  children?: React.ReactNode
  /**
   * Some AI surfaces have nothing to accept. The risk explainer explains a verdict the server
   * already reached; the board digest and the assignee suggestions are ranked lists where each row
   * carries its own action, and a single "Accept" over them would mean "take the first", which is
   * exactly the decision the guard rails say a person must make.
   *
   * `readOnly` renders those with one Close button instead of Accept/Edit/Discard. It is the one
   * case this wrapper does not delegate to `@devon/ui`'s `AiPreviewPanel`, whose whole contract is
   * that a generated result is always acceptable, editable and discardable -- true for a draft,
   * false for an explanation.
   */
  readOnly?: boolean | undefined
  onAccept?: (() => void) | undefined
  onEdit?: (() => void) | undefined
  onDiscard: () => void
  onRetry?: (() => void) | undefined
  acceptLabel?: string | undefined
  editLabel?: string | undefined
  className?: string | undefined
}

export function AiResultPanel({
  title,
  status,
  meta,
  errorMessage,
  children,
  readOnly,
  onAccept,
  onEdit,
  onDiscard,
  onRetry,
  acceptLabel,
  editLabel,
  className,
}: AiResultPanelProps): React.JSX.Element {
  const t = useT()
  const locale = useLocale()

  // A simulated answer has no price: the tokens were never sent anywhere. Printing "0 soʻm" would be
  // technically true and read as "free AI", which is the opposite of honest.
  const costLine =
    meta && !meta.simulated
      ? meta.cached
        ? t('ai.result.cachedLine', { tokens: formatNumber(meta.totalTokens, locale) })
        : t('ai.result.costLine', {
            cost: formatUzs(meta.costUzs, locale),
            tokens: formatNumber(meta.totalTokens, locale),
            ms: formatNumber(meta.latencyMs, locale),
          })
      : undefined

  const body = (
    <div className="flex flex-col gap-3">
      {meta?.simulated ? (
        <p
          className="flex items-start gap-2 rounded-sm border border-warning/40 bg-warning/10 px-3 py-2 text-caption text-foreground"
          role="note"
        >
          <FlaskConical className="mt-0.5 size-3.5 shrink-0 text-warning" aria-hidden="true" />
          <span className="min-w-0">
            <span className="font-medium">{t('ai.simulated.title')}</span> {t('ai.simulated.body')}
          </span>
        </p>
      ) : null}
      {children}
    </div>
  )

  if (readOnly) {
    return (
      <ReadOnlyPanel
        title={title}
        status={status}
        {...(costLine ? { costLine } : {})}
        {...(errorMessage ? { errorMessage } : {})}
        onClose={onDiscard}
        {...(onRetry ? { onRetry } : {})}
        {...(className ? { className } : {})}
      >
        {body}
      </ReadOnlyPanel>
    )
  }

  return (
    <AiPreviewPanel
      title={title}
      status={status}
      {...(costLine ? { costLine } : {})}
      {...(errorMessage ? { errorMessage } : {})}
      acceptLabel={acceptLabel ?? t('ai.result.accept')}
      editLabel={editLabel ?? t('ai.result.edit')}
      discardLabel={t('ai.result.discard')}
      retryLabel={t('ai.result.retry')}
      pendingLabel={t('ai.result.pending')}
      onAccept={onAccept ?? onDiscard}
      onEdit={onEdit ?? onDiscard}
      onDiscard={onDiscard}
      {...(onRetry ? { onRetry } : {})}
      {...(className ? { className } : {})}
    >
      {body}
    </AiPreviewPanel>
  )
}

/**
 * The read-only shell: the same frame and the same skeleton as `AiPreviewPanel`, with one Close
 * button where its Accept/Edit/Discard row would be. Small enough to be worth writing twice rather
 * than pushing an `actions` escape hatch into a `packages/ui` primitive whose entire point is that
 * an AI result is never applied without a person pressing Accept.
 */
function ReadOnlyPanel({
  title,
  status,
  children,
  costLine,
  errorMessage,
  onClose,
  onRetry,
  className,
}: {
  title: string
  status: 'pending' | 'ready' | 'error'
  children: React.ReactNode
  costLine?: string | undefined
  errorMessage?: string | undefined
  onClose: () => void
  onRetry?: (() => void) | undefined
  className?: string | undefined
}): React.JSX.Element {
  const t = useT()
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
        <PanelBody status={status} errorMessage={errorMessage}>
          {children}
        </PanelBody>
      </div>

      <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-border bg-card px-4 py-3">
        {costLine ? (
          <span className="text-caption tabular-nums text-muted-foreground">{costLine}</span>
        ) : (
          <span />
        )}
        <div className="flex flex-wrap items-center gap-2">
          {status === 'error' && onRetry ? (
            <Button size="sm" variant="secondary" onClick={onRetry}>
              {t('ai.result.retry')}
            </Button>
          ) : null}
          <Button data-primary size="sm" onClick={onClose}>
            <Check className="size-3.5" aria-hidden="true" />
            {t('ai.result.close')}
          </Button>
        </div>
      </footer>
    </Reveal>
  )
}

/** The three states, as early returns -- see `previews.tsx` on the hard-coded-text heuristic. */
function PanelBody({
  status,
  errorMessage,
  children,
}: {
  status: 'pending' | 'ready' | 'error'
  errorMessage?: string | undefined
  children: React.ReactNode
}): React.JSX.Element {
  const t = useT()
  if (status === 'pending') {
    return (
      <div role="status" aria-live="polite" className="flex flex-col gap-2">
        <span className="sr-only">{t('ai.result.pending')}</span>
        <Shimmer className="h-4 w-full" />
        <Shimmer className="h-4 w-[88%]" />
        <Shimmer className="h-4 w-[64%]" />
      </div>
    )
  }
  if (status === 'error') {
    return (
      <div role="alert" className="flex items-start gap-2">
        <AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden="true" />
        <p className="min-w-0 text-body text-foreground">{errorMessage}</p>
      </div>
    )
  }
  return <div className="min-w-0 text-body text-foreground">{children}</div>
}

/** Confidence, as a chip rather than a number: "medium" is a hint to check, not a measurement.
 * Used by every preview that guesses (quick-add, analytics, assignee suggestions). */
export function ConfidenceChip({
  level,
}: {
  level: 'high' | 'medium' | 'low'
}): React.JSX.Element | null {
  const t = useT()
  // A high-confidence field needs no chip at all: chrome on every row is chrome nobody reads.
  if (level === 'high') return null
  return <Badge tone={level === 'low' ? 'warning' : 'neutral'}>{t(`ai.confidence.${level}`)}</Badge>
}

/** One labelled row of a parsed result. The label column is fixed so a column of them reads as a
 * table without being one -- DESIGN.md's "properties read as a list, not a form". */
export function FieldRow({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 py-1.5">
      <span className="w-28 shrink-0 text-caption text-muted-foreground">{label}</span>
      <span className="flex min-w-0 flex-1 flex-wrap items-center gap-2 text-body text-foreground">
        {children}
      </span>
    </div>
  )
}

/** The "nothing was found / nothing to do" line inside a preview. Not a `StateView`: this sits
 * inside an already-framed panel, and a second frame around it reads as an error. */
export function PreviewNote({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <p className="text-small text-muted-foreground">{children}</p>
}
