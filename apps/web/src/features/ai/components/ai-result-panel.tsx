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
import { AiPreviewPanel, Badge } from '@devon/ui'
import { FlaskConical } from 'lucide-react'
import { useT, useLocale, formatUzs, formatNumber } from '@devon/i18n'
import type { RunMeta } from '../types.js'

export interface AiResultPanelProps {
  title: string
  status: 'pending' | 'ready' | 'error'
  meta?: RunMeta | undefined
  errorMessage?: string | undefined
  children?: React.ReactNode
  /** Omit to hide Accept entirely -- a few surfaces (the risk explainer, the duplicate check) are
   * read-only by design, and a disabled-looking Accept on them reads as a bug. */
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
      <div className="flex flex-col gap-3">
        {meta?.simulated ? (
          <p
            className="flex items-start gap-2 rounded-sm border border-warning/40 bg-warning/10 px-3 py-2 text-caption text-foreground"
            role="note"
          >
            <FlaskConical className="mt-0.5 size-3.5 shrink-0 text-warning" aria-hidden="true" />
            <span className="min-w-0">
              <span className="font-medium">{t('ai.simulated.title')}</span>{' '}
              {t('ai.simulated.body')}
            </span>
          </p>
        ) : null}
        {children}
      </div>
    </AiPreviewPanel>
  )
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
  return (
    <Badge tone={level === 'low' ? 'warning' : 'neutral'}>
      {t(`ai.confidence.${level}`)}
    </Badge>
  )
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
