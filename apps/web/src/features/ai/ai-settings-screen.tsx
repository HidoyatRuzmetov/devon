// The AI screen (`/ai`). One route, three tabs, two products (SPEC §3.1, §8).
//
// v1.0's version is the screen AI-AUDIT §0.5 called "gray", and it was right: a budget ring, a number
// input, ten identical toggle rows with no description of what any of them did, and a third tab that
// was a raw-JSON playground whose Accept button copied `JSON.stringify(result)` to the clipboard.
// `featureDescriptionKey()` already existed, already had four locales, and was called from nowhere.
//
// This version answers the three questions a person actually arrives with:
//
//   * **Yordamchilar** — what each helper does, *where in the product it appears*, and a concrete
//     example of what it turns in and turns out. Every row, for everyone. The head additionally gets
//     the switch and this month's spend for that one helper (AI-AUDIT §5 fix 15), so "this is
//     expensive" becomes an action on one row instead of switching AI off entirely.
//   * **Soʻrash** — the Ask box (EPIC-016), with the raw retrieval under it.
//   * **Foydalanish** — who ran what, when, at what price, including the blocked attempts v1.1
//     started recording (G-5). A member sees their own runs; a head sees the department's.
//
// The Yordamchi raw-JSON tab is gone (AI-AUDIT §4, D-3) along with `assistant-panel.tsx` and
// `feature-forms.ts`. Every helper is reached where the work is, which is the entire point of them.
import * as React from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { useT, useLocale, formatDate, formatTime, formatUzs, formatNumber } from '@devon/i18n'
import {
  Badge,
  Button,
  Celebrate,
  PageHeader,
  ProgressRing,
  Stagger,
  StaggerItem,
  StateView,
  Switch,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  toast,
  useCelebrate,
  useReducedMotion,
} from '@devon/ui'
import { BarChart3, Database, Gauge, RefreshCw, Sparkles } from 'lucide-react'
import { useDepartment, useSession } from '../../lib/session.js'
import { AskPanel } from './ask-panel.js'
import {
  useAiSettingsQuery,
  useAiUsageQuery,
  usePatchAiSettingsMutation,
  useRebuildIndexMutation,
} from './use-ai.js'
import {
  AI_FEATURE_IDS,
  HEAD_ONLY_FEATURES,
  featureDescriptionKey,
  featureExampleKey,
  featureLabelKey,
  featureWhereKey,
  type AiFeatureId,
  type AiSettings,
  type Trace,
} from './types.js'

type TabId = 'helpers' | 'ask' | 'usage'

const TABS: {
  id: TabId
  labelKey: string
  icon: React.ComponentType<React.SVGProps<SVGSVGElement>>
}[] = [
  { id: 'helpers', labelKey: 'ai.tabs.helpers', icon: Gauge },
  { id: 'ask', labelKey: 'ai.tabs.ask', icon: Sparkles },
  { id: 'usage', labelKey: 'ai.tabs.usage', icon: BarChart3 },
]

/** DESIGN.md §3 "budget gauge ring": the department's monthly AI spend read as one number a head can
 * glance at, not a bar buried among settings -- `ProgressRing` (the same primitive project-progress
 * and the Pomodoro clock use) with the percentage spent inside it and the status tone on the arc. */
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
  const ringClass =
    budgetStatus === 'hard_stop'
      ? 'text-destructive'
      : budgetStatus === 'soft_cap'
        ? 'text-warning'
        : 'text-success'

  // round2 SEV3 "no celebration when the budget resets": the API has no dedicated "reset" event to
  // subscribe to, so this treats a large drop in `usedPct` between two renders (a department that had
  // meaningfully spent its month, now back near zero) as the monthly reset actually landing -- never
  // fires on first mount (nothing to compare against yet) or on a small in-month fluctuation.
  const resetCelebrate = useCelebrate()
  const previousUsedPct = React.useRef<number | undefined>(undefined)
  React.useEffect(() => {
    // Three named booleans, each on its own line (not one chained comparison): a line mixing `>`
    // and `<` operators around plain words is exactly what `check-i18n.mjs`'s hard-coded-JSX-text
    // regex heuristic mistakes for a stray text node (`people-screen.tsx`/`table-screen.tsx` avoid
    // the same trap in their own ternary-vs-if/else notes).
    const prev = previousUsedPct.current
    const hadMeaningfulSpend = prev !== undefined && prev >= 20
    const nowNearZero = usedPct < 5
    const droppedSharply = prev !== undefined && usedPct < prev - 15
    if (hadMeaningfulSpend && nowNearZero && droppedSharply) {
      resetCelebrate.fire()
      toast(t('ai.budget.resetToast'))
    }
    previousUsedPct.current = usedPct
    // `resetCelebrate.fire`/`t` are stable enough for this one-shot comparison; re-running this on
    // every render of either would re-arm the same transition it just fired for.
  }, [usedPct]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="flex flex-wrap items-center gap-5 rounded-md border border-border bg-card p-4">
      <span className="relative inline-flex">
        <ProgressRing
          value={usedPct}
          size={72}
          strokeWidth={6}
          toneClassName={ringClass}
          label={t('ai.budget.title')}
        >
          <span className="text-small font-medium tabular-nums text-foreground">
            {formatNumber(Math.round(Math.min(100, usedPct)), locale)}%
          </span>
        </ProgressRing>
        <Celebrate play={resetCelebrate.play} onDone={resetCelebrate.onDone} radius={40} />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-small font-medium text-foreground">{t('ai.budget.title')}</h3>
          <Badge tone={tone}>{t(`ai.budget.status.${budgetStatus}`)}</Badge>
        </div>
        <p className="text-small text-muted-foreground">
          {t('ai.budget.spentOfCap', {
            spent: formatUzs(spentUzsThisMonth, locale),
            cap: formatUzs(budgetUzsPerMonth, locale),
          })}
        </p>
      </div>
    </div>
  )
}

/**
 * SPEC §8 "Honesty": the head's AI budget and the admin health page must agree about whether a key is
 * configured, and every person pressing a sparkle button deserves to know the answer will be a
 * simulation before they trust it. One strip, everyone sees it, only when it is true.
 */
function SimulatedBanner() {
  const t = useT()
  return (
    <p
      role="note"
      className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 px-4 py-3 text-small text-foreground"
    >
      <Sparkles className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />
      <span className="min-w-0">
        <span className="font-medium">{t('ai.simulated.bannerTitle')}</span>{' '}
        {t('ai.simulated.bannerBody')}
      </span>
    </p>
  )
}

/** EPIC-016: which retrieval backend is live, why, and what the head can do about it. Written as a
 * sentence, not a status code -- "keyword search, because this GLM deployment does not offer an
 * embeddings model" is a thing a boshqarma boshligʻi can act on or accept. */
function SearchBackendCard({ search, isHead }: { search: AiSettings['search']; isHead: boolean }) {
  const t = useT()
  const locale = useLocale()
  const rebuild = useRebuildIndexMutation()
  return (
    <div className="flex flex-col gap-2 rounded-md border border-border bg-card p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Database className="size-4 shrink-0 text-primary" aria-hidden="true" />
        <h3 className="text-small font-medium text-foreground">{t('ai.search.backendTitle')}</h3>
        <Badge tone={search.backend === 'embeddings' ? 'success' : 'neutral'}>
          {t(`ai.search.backend.${search.backend}`)}
        </Badge>
      </div>
      <p className="text-small text-muted-foreground">
        {t(`ai.search.reason.${search.reason}`)}
      </p>
      <p className="text-caption tabular-nums text-muted-foreground">
        {t('ai.search.indexed', {
          count: formatNumber(search.indexedCount, locale),
          pending: formatNumber(search.pendingEmbeddingCount, locale),
        })}
      </p>
      {isHead ? (
        <div className="flex flex-wrap items-center gap-3 pt-1">
          <Button
            variant="secondary"
            size="sm"
            loading={rebuild.isPending}
            onClick={() =>
              rebuild.mutate(undefined, {
                onSuccess: (result) =>
                  toast(
                    t('ai.search.rebuilt', {
                      indexed: formatNumber(result.indexed, locale),
                      embedded: formatNumber(result.embedded, locale),
                    }),
                  ),
                onError: () => toast(t('toast.saveError')),
              })
            }
          >
            <RefreshCw className="size-3.5" aria-hidden="true" />
            {t('ai.search.rebuild')}
          </Button>
          <span className="text-caption text-muted-foreground">{t('ai.search.rebuildHint')}</span>
        </div>
      ) : null}
    </div>
  )
}

function HelpersTab() {
  const t = useT()
  const locale = useLocale()
  const { department } = useDepartment()
  const settingsQuery = useAiSettingsQuery()
  const patchMutation = usePatchAiSettingsMutation()
  const isHead = department?.role === 'head'

  const [budgetInput, setBudgetInput] = React.useState('')
  React.useEffect(() => {
    if (settingsQuery.data?.budgetUzsPerMonth !== undefined) {
      setBudgetInput(String(settingsQuery.data.budgetUzsPerMonth))
    }
  }, [settingsQuery.data])

  // round2 SEV3 "toggling a flag gives only the Switch's own motion, no row acknowledgement": a
  // per-row token, bumped once the patch actually lands (not on click, since a head's toggle can
  // still fail the mutation) -- the row it belongs to briefly tints the same way a card-detail
  // property flashes on a committed edit.
  const [flashedFeature, setFlashedFeature] = React.useState<string | null>(null)
  const flashReduced = useReducedMotion()

  if (settingsQuery.isPending) return <StateView kind="loading" titleKey="state.loading" />
  if (settingsQuery.isError) {
    return (
      <StateView
        kind="error"
        titleKey="state.error.title"
        bodyKey="state.error.body"
        action={{ labelKey: 'state.error.action', onAction: () => void settingsQuery.refetch() }}
      />
    )
  }
  const settings = settingsQuery.data

  function toggleFlag(feature: AiFeatureId, checked: boolean) {
    patchMutation.mutate(
      { flags: { [feature]: checked } },
      {
        onSuccess: () => setFlashedFeature(feature),
        onError: () => toast(t('toast.saveError')),
      },
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

  // SPEC §2.2: a member never sees a helper that only a head may run. The server refuses it anyway;
  // this is the manners, not the enforcement.
  const visibleFeatures = AI_FEATURE_IDS.filter(
    (feature) => isHead || !HEAD_ONLY_FEATURES.includes(feature),
  )

  return (
    <div className="flex flex-col gap-6">
      {settings.simulated ? <SimulatedBanner /> : null}

      {/* D2a: the budget ring, the monthly spend and the cost of the department's AI are the
          boshqarma boshlig'i's business. The server omits them for a xodim; this is the matching
          hide, and the screen's remaining half -- which helpers exist and what they do -- is exactly
          what a member came here for (SPEC §3.1). */}
      {settings.budgetStatus !== undefined &&
      settings.spentUzsThisMonth !== undefined &&
      settings.budgetUzsPerMonth !== undefined &&
      settings.usedPct !== undefined ? (
        <BudgetGauge
          spentUzsThisMonth={settings.spentUzsThisMonth}
          budgetUzsPerMonth={settings.budgetUzsPerMonth}
          usedPct={settings.usedPct}
          budgetStatus={settings.budgetStatus}
        />
      ) : null}

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

      <SearchBackendCard search={settings.search} isHead={isHead} />

      <div className="flex flex-col gap-1 rounded-md border border-border bg-card p-4">
        <h3 className="text-small font-medium text-foreground">{t('ai.flags.title')}</h3>
        <p className="mb-2 text-caption text-muted-foreground">{t('ai.flags.description')}</p>
        <Stagger as="ul" className="flex flex-col divide-y divide-border">
          {visibleFeatures.map((feature) => {
            const spend = settings.spendByFeature?.[feature]
            return (
              <StaggerItem
                as="li"
                key={feature}
                className="relative flex flex-wrap items-start justify-between gap-x-4 gap-y-2 py-3"
              >
                <AnimatePresence>
                  {flashedFeature === feature ? (
                    <motion.span
                      key={`${feature}-flash`}
                      aria-hidden="true"
                      className="pointer-events-none absolute inset-0 rounded-sm bg-success/15"
                      initial={{ opacity: 0.9 }}
                      animate={{ opacity: 0 }}
                      transition={{ duration: flashReduced ? 0.15 : 0.6, ease: 'easeOut' }}
                      onAnimationComplete={() =>
                        setFlashedFeature((cur) => (cur === feature ? null : cur))
                      }
                    />
                  ) : null}
                </AnimatePresence>

                <div className="flex min-w-60 flex-1 flex-col gap-1">
                  <label
                    htmlFor={`flag-${feature}`}
                    className="flex flex-wrap items-center gap-2 text-body font-medium text-foreground"
                  >
                    {t(featureLabelKey(feature))}
                    {HEAD_ONLY_FEATURES.includes(feature) ? (
                      <Badge tone="info">{t('ai.flags.headOnlyBadge')}</Badge>
                    ) : null}
                  </label>
                  {/* AI-AUDIT §5 fix 14: these descriptions were already translated in four locales
                      and rendered nowhere. */}
                  <p className="text-small text-muted-foreground">
                    {t(featureDescriptionKey(feature))}
                  </p>
                  <p className="text-caption text-muted-foreground">
                    {t('ai.flags.whereLabel')} {t(featureWhereKey(feature))}
                  </p>
                  <p className="text-caption italic text-muted-foreground">
                    {t(featureExampleKey(feature))}
                  </p>
                </div>

                <div className="flex shrink-0 items-center gap-3">
                  {spend !== undefined && spend > 0 ? (
                    <span className="text-caption tabular-nums text-muted-foreground">
                      {formatUzs(spend, locale)}
                    </span>
                  ) : null}
                  <Switch
                    id={`flag-${feature}`}
                    checked={settings.flags[feature] === true}
                    onCheckedChange={(checked) => toggleFlag(feature, checked)}
                    disabled={!isHead}
                    aria-label={t(featureLabelKey(feature))}
                  />
                </div>
              </StaggerItem>
            )
          })}
        </Stagger>
        {!isHead ? (
          <p className="pt-2 text-caption text-muted-foreground">{t('ai.flags.headOnly')}</p>
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
        action={{ labelKey: 'state.error.action', onAction: () => void usageQuery.refetch() }}
      />
    )
  }
  if (usageQuery.data.length === 0) {
    return <StateView kind="empty" titleKey="ai.usage.empty.title" bodyKey="ai.usage.empty.body" />
  }

  return (
    <div className="overflow-x-auto rounded-md border border-border">
      <table className="w-full min-w-180 text-left text-small">
        <thead className="border-b border-border bg-muted/40 text-caption text-muted-foreground">
          <tr>
            <th className="px-3 py-2">{t('ai.usage.columns.when')}</th>
            <th className="px-3 py-2">{t('ai.usage.columns.who')}</th>
            <th className="px-3 py-2">{t('ai.usage.columns.feature')}</th>
            <th className="px-3 py-2">{t('ai.usage.columns.status')}</th>
            <th className="px-3 py-2">{t('ai.usage.columns.tokens')}</th>
            <th className="px-3 py-2">{t('ai.usage.columns.cost')}</th>
            <th className="px-3 py-2">{t('ai.usage.columns.latency')}</th>
          </tr>
        </thead>
        <Stagger as="tbody">
          {usageQuery.data.map((trace) => {
            const date = new Date(trace.createdAt)
            return (
              <StaggerItem as="tr" key={trace.id} className="border-b border-border last:border-0">
                <td className="px-3 py-2 text-foreground">
                  {formatDate(date, locale)} {formatTime(date, locale)}
                </td>
                <td className="px-3 py-2 text-foreground">
                  {trace.userName || t('ai.usage.unknownUser')}
                </td>
                <td className="px-3 py-2 text-foreground">{t(featureLabelKey(trace.feature))}</td>
                <td className="px-3 py-2">
                  <Badge tone={STATUS_TONE[trace.status]}>
                    {t(`ai.usage.status.${trace.status}`)}
                  </Badge>
                </td>
                <td className="px-3 py-2 tabular-nums text-foreground">
                  {formatNumber(trace.totalTokens, locale)}
                </td>
                <td className="px-3 py-2 text-foreground">{formatUzs(trace.costUzs, locale)}</td>
                <td className="px-3 py-2 text-foreground">
                  {t('ai.result.latency', { ms: formatNumber(trace.latencyMs, locale) })}
                </td>
              </StaggerItem>
            )
          })}
        </Stagger>
      </table>
    </div>
  )
}

export default function AiSettingsScreen() {
  const t = useT()
  const { isLoading, isAuthenticated } = useSession()
  // `?tab=ask` -- the palette's "Soʻrash" command deep-links straight to the Ask box rather than
  // dropping the person on the catalogue to find it (AI-AUDIT §5 fix 18). Read once, as the initial
  // state: the tab is the user's afterwards, and re-syncing it from the URL on every render would
  // fight them every time they click another tab.
  const [tab, setTab] = React.useState<TabId>(() => {
    const requested = new URLSearchParams(window.location.search).get('tab')
    return requested === 'ask' || requested === 'usage' ? requested : 'helpers'
  })

  if (isLoading) return <StateView kind="loading" titleKey="state.loading" />
  if (!isAuthenticated) {
    return <StateView kind="forbidden" titleKey="state.denied.title" bodyKey="state.denied.body" />
  }

  return (
    <Tabs value={tab} onValueChange={(v) => setTab(v as TabId)} className="flex flex-col gap-6">
      <PageHeader
        eyebrow={t('ai.eyebrow')}
        title={t('ai.title')}
        description={t('ai.description')}
        tabs={
          <TabsList>
            {TABS.map(({ id, labelKey, icon: Icon }) => (
              <TabsTrigger key={id} value={id}>
                <Icon className="size-4" aria-hidden="true" />
                {t(labelKey)}
              </TabsTrigger>
            ))}
          </TabsList>
        }
      />

      <TabsContent value="helpers">
        <HelpersTab />
      </TabsContent>
      <TabsContent value="ask">
        <AskPanel />
      </TabsContent>
      <TabsContent value="usage">
        <UsageTab />
      </TabsContent>
    </Tabs>
  )
}
