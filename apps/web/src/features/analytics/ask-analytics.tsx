// "Ask analytics" (AI wiring, TECH-SPEC §8 `nl_analytics`): a plain-language question over the
// filter bar's own grammar. This never runs a query itself -- the model returns filter-grammar text
// (`@devon/contracts`'s `parseFilterQuery` syntax, the exact same text a person could type into the
// filter bar by hand), previewed here and only applied to the real filter on Accept
// (preview-then-accept, TECH-SPEC §8's guard rail: AI output is data, never trusted as already-safe).
import * as React from 'react'
import { useT, useLocale } from '@devon/i18n'
import { AiPreviewPanel, Input, SparkleButton } from '@devon/ui'
import { useRunAiFeatureMutation } from '../ai/use-ai.js'
import { ApiError } from '../../lib/api-client.js'
import type { AnalyticsSummary } from './types.js'

function errorKey(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.code === 'validation_failed') return 'analytics.ask.errors.invalid'
    if (err.code === 'forbidden') return 'analytics.ask.errors.forbidden'
  }
  return 'analytics.ask.errors.failed'
}

export function AskAnalytics({
  summary,
  onApplyFilter,
}: {
  summary: AnalyticsSummary
  onApplyFilter: (filterText: string) => void
}) {
  const t = useT()
  const locale = useLocale()
  const [query, setQuery] = React.useState('')
  const runMutation = useRunAiFeatureMutation('nl_analytics')
  const knownUnits = React.useMemo(
    () => summary.loadPerUnit.map((u) => u.unitName).filter((n): n is string => Boolean(n)),
    [summary.loadPerUnit],
  )

  function ask() {
    const trimmed = query.trim()
    if (!trimmed) return
    runMutation.mutate({ query: trimmed, knownUnits, locale })
  }

  const data = runMutation.data?.data
  const filterText = typeof data?.['filterText'] === 'string' ? (data['filterText'] as string) : ''
  const explanation =
    typeof data?.['explanation'] === 'string' ? (data['explanation'] as string) : ''

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              ask()
            }
          }}
          placeholder={t('analytics.ask.placeholder')}
          aria-label={t('analytics.ask.placeholder')}
          className="min-w-64 flex-1"
        />
        <SparkleButton
          aria-label={t('analytics.ask.action')}
          label={t('analytics.ask.action')}
          size="sm"
          loading={runMutation.isPending}
          disabled={!query.trim()}
          onClick={ask}
        />
      </div>

      {runMutation.isPending || runMutation.isError || runMutation.data ? (
        <AiPreviewPanel
          title={t('analytics.ask.title')}
          status={runMutation.isPending ? 'pending' : runMutation.isError ? 'error' : 'ready'}
          pendingLabel={t('analytics.ask.pending')}
          {...(runMutation.error ? { errorMessage: t(errorKey(runMutation.error)) } : {})}
          acceptLabel={t('analytics.ask.apply')}
          editLabel={t('analytics.ask.edit')}
          discardLabel={t('analytics.ask.discard')}
          retryLabel={t('analytics.ask.retry')}
          onRetry={ask}
          onAccept={() => {
            onApplyFilter(filterText)
            runMutation.reset()
            setQuery('')
          }}
          onEdit={() => runMutation.reset()}
          onDiscard={() => {
            runMutation.reset()
            setQuery('')
          }}
        >
          {runMutation.data ? (
            <p className="text-body text-foreground">
              {filterText
                ? t('analytics.ask.resultWithFilter', { filter: filterText })
                : t('analytics.ask.resultNoFilter')}
              {explanation ? (
                <span className="block text-small text-muted-foreground">{explanation}</span>
              ) : null}
            </p>
          ) : null}
        </AiPreviewPanel>
      ) : null}
    </div>
  )
}
