// The AI screen (TECH-SPEC §8: "Settings page with budget, flags and usage"). One route (`/ai`),
// tabbed internally (MODULE-GUIDE.md: routes are exact-path only) -- Overview (budget gauge + per-
// feature flags, head-editable), Usage (recent traces), Assistant (`assistant-panel.tsx`'s preview-
// then-accept panel).
import * as React from 'react'
import { useT, useLocale, formatDate, formatTime, formatUzs } from '@devon/i18n'
import { Badge, Button, StateView, cn, toast } from '@devon/ui'
import { BarChart3, Gauge, Sparkles } from 'lucide-react'
import { useDepartment, useSession } from '../../lib/session.js'
import { AssistantPanel } from './assistant-panel.js'
import { Checkbox } from './components/form-controls.js'
import { useAiSettingsQuery, useAiUsageQuery, usePatchAiSettingsMutation } from './use-ai.js'
import { AI_FEATURE_IDS, featureLabelKey, type AiFeatureId, type Trace } from './types.js'

type TabId = 'overview' | 'usage' | 'assistant'

const TABS: {
  id: TabId
  labelKey: string
  icon: React.ComponentType<React.SVGProps<SVGSVGElement>>
}[] = [
  { id: 'overview', labelKey: 'ai.tabs.overview', icon: Gauge },
  { id: 'usage', labelKey: 'ai.tabs.usage', icon: BarChart3 },
  { id: 'assistant', labelKey: 'ai.tabs.assistant', icon: Sparkles },
]

function BudgetGauge({
  spentUzsThisMonth,
  budgetUzsPerMonth,
  usedPct,
  budgetStatus,
}: {
  spentUzsThisMonth: number
  budgetUzsPerMonth: number
  usedPct: number
  budgetStatus: 'ok' | 'soft_cap' | 'hard_stop'
}) {
  const t = useT()
  const locale = useLocale()
  const tone =
    budgetStatus === 'hard_stop'
      ? 'destructive'
      : budgetStatus === 'soft_cap'
        ? 'warning'
        : 'success'
  const barColor =
    budgetStatus === 'hard_stop'
      ? 'bg-destructive'
      : budgetStatus === 'soft_cap'
        ? 'bg-warning'
        : 'bg-success'

  return (
    <div className="flex flex-col gap-3 rounded-md border border-border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-small font-medium text-foreground">{t('ai.budget.title')}</h3>
        <Badge tone={tone}>{t(`ai.budget.status.${budgetStatus}`)}</Badge>
      </div>
      <div className="h-3 w-full overflow-hidden rounded-full bg-muted">
        <div
          className={cn('h-full rounded-full transition-[width]', barColor)}
          style={{ width: `${Math.min(100, usedPct)}%` }}
        />
      </div>
      <p className="text-small text-muted-foreground">
        {t('ai.budget.spentOfCap', {
          spent: formatUzs(spentUzsThisMonth, locale),
          cap: formatUzs(budgetUzsPerMonth, locale),
        })}
      </p>
    </div>
  )
}

function OverviewTab() {
  const t = useT()
  const { department } = useDepartment()
  const settingsQuery = useAiSettingsQuery()
  const patchMutation = usePatchAiSettingsMutation()
  const isHead = department?.role === 'head'

  const [budgetInput, setBudgetInput] = React.useState('')
  React.useEffect(() => {
    if (settingsQuery.data) setBudgetInput(String(settingsQuery.data.budgetUzsPerMonth))
  }, [settingsQuery.data])

  if (settingsQuery.isPending) return <StateView kind="loading" titleKey="state.loading" />
  if (settingsQuery.isError) {
    return (
      <StateView
        kind="error"
        titleKey="state.error.title"
        bodyKey="state.error.body"
        action={{ labelKey: 'state.error.retry', onAction: () => void settingsQuery.refetch() }}
      />
    )
  }
  const settings = settingsQuery.data

  function toggleFlag(feature: AiFeatureId, checked: boolean) {
    patchMutation.mutate(
      { flags: { [feature]: checked } },
      { onError: () => toast(t('toast.saveError')) },
    )
  }

  function saveBudget() {
    const value = Number(budgetInput)
    if (!Number.isFinite(value) || value < 0) {
      toast(t('ai.budget.invalidAmount'))
      return
    }
    patchMutation.mutate(
      { budgetUzsPerMonth: Math.round(value) },
      { onError: () => toast(t('toast.saveError')) },
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <BudgetGauge
        spentUzsThisMonth={settings.spentUzsThisMonth}
        budgetUzsPerMonth={settings.budgetUzsPerMonth}
        usedPct={settings.usedPct}
        budgetStatus={settings.budgetStatus}
      />

      {isHead ? (
        <div className="flex flex-wrap items-end gap-3 rounded-md border border-border bg-card p-4">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="ai-budget-input" className="text-small font-medium text-foreground">
              {t('ai.budget.editLabel')}
            </label>
            <input
              id="ai-budget-input"
              type="number"
              min={0}
              value={budgetInput}
              onChange={(e) => setBudgetInput(e.target.value)}
              className="h-11 w-48 rounded-sm border border-border bg-card px-3 text-body text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            />
          </div>
          <Button onClick={saveBudget} loading={patchMutation.isPending}>
            {t('ai.budget.save')}
          </Button>
        </div>
      ) : null}

      <div className="flex flex-col gap-2 rounded-md border border-border bg-card p-4">
        <h3 className="text-small font-medium text-foreground">{t('ai.flags.title')}</h3>
        <p className="text-caption text-muted-foreground">{t('ai.flags.description')}</p>
        <ul className="mt-2 flex flex-col gap-2">
          {AI_FEATURE_IDS.map((feature) => (
            <li key={feature} className="flex items-center gap-3">
              <Checkbox
                id={`flag-${feature}`}
                checked={settings.flags[feature] === true}
                onCheckedChange={(checked) => toggleFlag(feature, checked)}
                disabled={!isHead}
                aria-label={t(featureLabelKey(feature))}
              />
              <label htmlFor={`flag-${feature}`} className="text-body text-foreground">
                {t(featureLabelKey(feature))}
              </label>
            </li>
          ))}
        </ul>
        {!isHead ? (
          <p className="text-caption text-muted-foreground">{t('ai.flags.headOnly')}</p>
        ) : null}
      </div>
    </div>
  )
}

const STATUS_TONE: Record<Trace['status'], 'success' | 'warning' | 'destructive' | 'neutral'> = {
  ok: 'success',
  empty_after_retry: 'warning',
  schema_invalid_after_retry: 'warning',
  provider_error: 'destructive',
  blocked_budget: 'destructive',
  blocked_flag: 'neutral',
}

function UsageTab() {
  const t = useT()
  const locale = useLocale()
  const usageQuery = useAiUsageQuery()

  if (usageQuery.isPending) return <StateView kind="loading" titleKey="state.loading" />
  if (usageQuery.isError) {
    return (
      <StateView
        kind="error"
        titleKey="state.error.title"
        bodyKey="state.error.body"
        action={{ labelKey: 'state.error.retry', onAction: () => void usageQuery.refetch() }}
      />
    )
  }
  if (usageQuery.data.length === 0) {
    return <StateView kind="empty" titleKey="ai.usage.empty.title" bodyKey="ai.usage.empty.body" />
  }

  return (
    <div className="overflow-x-auto rounded-md border border-border">
      <table className="w-full min-w-160 text-left text-small">
        <thead className="border-b border-border bg-muted/40 text-caption text-muted-foreground">
          <tr>
            <th className="px-3 py-2">{t('ai.usage.columns.when')}</th>
            <th className="px-3 py-2">{t('ai.usage.columns.feature')}</th>
            <th className="px-3 py-2">{t('ai.usage.columns.status')}</th>
            <th className="px-3 py-2">{t('ai.usage.columns.tokens')}</th>
            <th className="px-3 py-2">{t('ai.usage.columns.cost')}</th>
            <th className="px-3 py-2">{t('ai.usage.columns.latency')}</th>
          </tr>
        </thead>
        <tbody>
          {usageQuery.data.map((trace) => {
            const date = new Date(trace.createdAt)
            return (
              <tr key={trace.id} className="border-b border-border last:border-0">
                <td className="px-3 py-2 text-foreground">
                  {formatDate(date, locale)} {formatTime(date, locale)}
                </td>
                <td className="px-3 py-2 text-foreground">{t(featureLabelKey(trace.feature))}</td>
                <td className="px-3 py-2">
                  <Badge tone={STATUS_TONE[trace.status]}>
                    {t(`ai.usage.status.${trace.status}`)}
                  </Badge>
                </td>
                <td className="px-3 py-2 text-foreground">{trace.totalTokens}</td>
                <td className="px-3 py-2 text-foreground">{formatUzs(trace.costUzs, locale)}</td>
                <td className="px-3 py-2 text-foreground">
                  {t('ai.result.latency', { ms: trace.latencyMs })}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

export default function AiSettingsScreen() {
  const t = useT()
  const { isLoading, isAuthenticated } = useSession()
  const [tab, setTab] = React.useState<TabId>('overview')

  if (isLoading) return <StateView kind="loading" titleKey="state.loading" />
  if (!isAuthenticated) {
    return <StateView kind="forbidden" titleKey="state.denied.title" bodyKey="state.denied.body" />
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-h2 text-foreground">{t('ai.title')}</h1>
      </div>

      <div
        role="tablist"
        aria-label={t('ai.title')}
        className="flex flex-wrap gap-1 border-b border-border"
      >
        {TABS.map(({ id, labelKey, icon: Icon }) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
            className={cn(
              'flex items-center gap-1.5 rounded-t-sm px-3 py-2 text-small font-medium',
              tab === id
                ? 'border-b-2 border-primary text-foreground'
                : 'border-b-2 border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            <Icon className="size-4" aria-hidden="true" />
            {t(labelKey)}
          </button>
        ))}
      </div>

      <div role="tabpanel">
        {tab === 'overview' ? <OverviewTab /> : null}
        {tab === 'usage' ? <UsageTab /> : null}
        {tab === 'assistant' ? <AssistantPanel /> : null}
      </div>
    </div>
  )
}
