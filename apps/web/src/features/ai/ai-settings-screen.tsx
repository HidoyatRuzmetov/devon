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
import {
  useT,
  useLocale,
  formatDate,
  formatTime,
  formatUzs,
  formatNumber,
  type Locale,
} from '@devon/i18n'
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
  cn,
  toast,
  useCelebrate,
  useReducedMotion,
} from '@devon/ui'
import { BarChart3, Database, Gauge, Sparkles } from 'lucide-react'
import { useDepartment, useSession } from '../../lib/session.js'
import { AskPanel } from './ask-panel.js'
import { useAiSettingsQuery, useAiUsageQuery, usePatchAiSettingsMutation } from './use-ai.js'
import {
  AI_FEATURE_IDS,
  HEAD_ONLY_FEATURES,
  featureDescriptionKey,
  featureExampleKey,
  featureLabelKey,
  featureWhereKey,
  displayTraceFeature,
  type AiFeatureId,
  type AiTraceFeatureId,
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
function SearchBackendCard({ search }: { search: AiSettings['search'] }) {
  const t = useT()
  const locale = useLocale()
  return (
    <div className="flex flex-col gap-2 rounded-md border border-border bg-card p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Database className="size-4 shrink-0 text-primary" aria-hidden="true" />
        <h3 className="text-small font-medium text-foreground">{t('ai.search.backendTitle')}</h3>
        <Badge tone={search.backend === 'embeddings' ? 'success' : 'neutral'}>
          {t(`ai.search.backend.${search.backend}`)}
        </Badge>
      </div>
      <p className="text-small text-muted-foreground">{t(`ai.search.reason.${search.reason}`)}</p>
      <p className="text-caption tabular-nums text-muted-foreground">
        {t('ai.search.indexed', {
          count: formatNumber(search.indexedCount, locale),
          pending: formatNumber(search.pendingEmbeddingCount, locale),
        })}
      </p>
      <p className="text-small text-muted-foreground">{t('ai.search.automaticContext')}</p>
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

  // v1.1 critique SEV2 #22. This was `<input type="number">`, which the browser exposes as a
  // spinbutton -- and with only `min={0}` set, assistive tech read `aria-valuemin="0"
  // aria-valuemax="0"` while the field held 2000000, an out-of-range announcement some screen
  // readers refuse input on entirely. It also showed the raw digits `2000000` one row under a
  // summary line reading `2 000 000 soʻm`, so the same number was formatted two ways in one card,
  // against DESIGN.md §5's locale-separator rule.
  //
  // A formatted text input with `inputMode="numeric"` is the fix: no spinbutton role, no broken
  // range, the locale's own group separator applied on blur, and the soʻm suffix inside the field
  // where the number is, not in a caption beside it. The field holds digits while it has focus (a
  // separator under the caret is hostile to typing) and formats the moment it loses focus.
  const [budgetInput, setBudgetInput] = React.useState('')
  const [budgetFocused, setBudgetFocused] = React.useState(false)
  React.useEffect(() => {
    if (settingsQuery.data?.budgetUzsPerMonth !== undefined) {
      setBudgetInput(formatNumber(settingsQuery.data.budgetUzsPerMonth, locale))
    }
  }, [settingsQuery.data, locale])

  /** Digits only: every separator this app or a paste could produce (space, NBSP, narrow NBSP,
   * comma, apostrophe) is stripped before the number is read. */
  function budgetDigits(raw: string): string {
    return raw.replace(/[^0-9]/g, '')
  }

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
    const digits = budgetDigits(budgetInput)
    const value = digits.length > 0 ? Number(digits) : Number.NaN
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
            <div className="relative w-56">
              <input
                id="ai-budget-input"
                type="text"
                inputMode="numeric"
                autoComplete="off"
                enterKeyHint="done"
                value={budgetInput}
                aria-describedby="ai-budget-suffix"
                onFocus={() => {
                  setBudgetFocused(true)
                  setBudgetInput((raw) => budgetDigits(raw))
                }}
                onBlur={() => {
                  setBudgetFocused(false)
                  setBudgetInput((raw) => {
                    const digits = budgetDigits(raw)
                    return digits.length > 0 ? formatNumber(Number(digits), locale) : ''
                  })
                }}
                onChange={(e) => setBudgetInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    e.currentTarget.blur()
                    saveBudget()
                  }
                }}
                className="h-11 w-full rounded-sm border border-border bg-card py-0 pl-3 pr-16 text-body tabular-nums text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              />
              {/* The unit lives inside the field, so the number and what it is measured in are one
                  object. It is a description rather than a label, so a screen reader hears
                  "Oylik byudjet ... soʻm" and not two competing names. */}
              <span
                id="ai-budget-suffix"
                className={cn(
                  'pointer-events-none absolute inset-y-0 right-3 flex items-center text-small',
                  budgetFocused ? 'text-foreground' : 'text-muted-foreground',
                )}
              >
                {t('ai.budget.currency')}
              </span>
            </div>
          </div>
          <Button onClick={saveBudget} loading={patchMutation.isPending}>
            {t('ai.budget.save')}
          </Button>
        </div>
      ) : null}

      <SearchBackendCard search={settings.search} />

      <div className="flex flex-col gap-1 rounded-md border border-border bg-card p-4">
        <h3 className="text-small font-medium text-foreground">{t('ai.flags.title')}</h3>
        <p className="mb-2 text-caption text-muted-foreground">{t('ai.flags.description')}</p>
        <Stagger as="ul" className="flex flex-col divide-y divide-border">
          {visibleFeatures.map((feature) => {
            const spend = settings.spendByFeature?.[feature]
            const perCall = settings.estimatedCostUzsPerCall?.[feature]
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
                  {/* SEV3 #30. This used to render `spendByFeature` alone -- month-to-date spend
                      with no unit -- so five of the thirteen helpers showed nothing at all (nobody
                      had run them) and the other eight showed a bare figure that could have meant
                      per call, per month or an average. Two different facts, both labelled:
                      the estimated price of asking once, always present; and what this department
                      has actually spent this month, when there is any. */}
                  <div className="flex flex-col items-end gap-0.5 text-caption tabular-nums text-muted-foreground">
                    {perCall !== undefined && perCall > 0 ? (
                      <span title={t('ai.catalogue.costEstimated')}>
                        {t('ai.catalogue.costPerCall', { cost: formatUzs(perCall, locale) })}
                      </span>
                    ) : null}
                    {spend !== undefined && spend > 0 ? (
                      <span className="text-foreground">
                        {t('ai.flags.spentThisMonth', { cost: formatUzs(spend, locale) })}
                      </span>
                    ) : null}
                  </div>
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
  // SEV2 #23: "we stopped waiting" is a warning about our own patience, not a provider outage.
  timeout: 'warning',
  blocked_budget: 'destructive',
  blocked_flag: 'neutral',
}

const TRACE_STATUSES = [
  'ok',
  'empty_after_retry',
  'schema_invalid_after_retry',
  'provider_error',
  'timeout',
  'blocked_budget',
  'blocked_flag',
] as const

/** SEV2 #23: the trace table printed `latencyMs` raw -- "275962" -- which no head reads as four and
 * a half minutes. Seconds, one decimal below ten, whole above. */
function latencySeconds(ms: number, locale: Locale): string {
  const seconds = ms / 1000
  return formatNumber(seconds, locale, { maximumFractionDigits: seconds < 10 ? 1 : 0 })
}

const PAGE_SIZE = 20

/**
 * The head's AI console, Foydalanish tab.
 *
 * v1.1 critique SEV3 #33: this was an unfiltered, unpaged wall of rows, with latency in raw
 * milliseconds and a row labelled "Nimani oʻtkazib yubordim (eskirgan)" -- an internal deprecation
 * marker leaking onto a management screen. Now: filters by helper, outcome and date range, paging,
 * latency in seconds, and a retired feature id displayed under the helper that absorbed it
 * (`displayTraceFeature`), while storage keeps the original so an audit stays exact.
 *
 * The filtering is client-side on purpose: the endpoint returns the department's most recent traces,
 * which is the window a head looks through in one sitting. Narrowing that in the browser is instant
 * and costs one request rather than one per filter change.
 */
function UsageTab() {
  const t = useT()
  const locale = useLocale()
  const usageQuery = useAiUsageQuery()

  const [featureFilter, setFeatureFilter] = React.useState<'all' | AiTraceFeatureId>('all')
  const [statusFilter, setStatusFilter] = React.useState<'all' | Trace['status']>('all')
  const [days, setDays] = React.useState<number | 'all'>(30)
  const [page, setPage] = React.useState(0)

  // Any filter change restarts the listing: staying on page 4 of a list that is now two pages long
  // is the classic way a filtered table looks empty.
  React.useEffect(() => setPage(0), [featureFilter, statusFilter, days])

  const traces = React.useMemo(() => usageQuery.data ?? [], [usageQuery.data])

  /** Only the helpers that actually appear in the loaded window -- a filter offering fourteen
   * options when three were used is a longer list carrying less information. */
  const featuresPresent = React.useMemo(() => {
    const seen = new Map<AiTraceFeatureId, string>()
    for (const trace of traces) {
      const id = displayTraceFeature(trace.feature)
      if (!seen.has(id)) seen.set(id, t(featureLabelKey(id)))
    }
    return [...seen.entries()].sort((a, b) => a[1].localeCompare(b[1]))
  }, [traces, t])

  const filtered = React.useMemo(() => {
    const since = days === 'all' ? 0 : Date.now() - days * 86_400_000
    return traces.filter((trace) => {
      if (featureFilter !== 'all' && displayTraceFeature(trace.feature) !== featureFilter)
        return false
      if (statusFilter !== 'all' && trace.status !== statusFilter) return false
      if (since === 0) return true
      const ranAt = new Date(trace.createdAt).getTime()
      return ranAt >= since
    })
  }, [traces, featureFilter, statusFilter, days])

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const safePage = Math.min(page, pageCount - 1)
  const shown = filtered.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE)

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
  if (traces.length === 0) {
    return <StateView kind="empty" titleKey="ai.usage.empty.title" bodyKey="ai.usage.empty.body" />
  }

  const selectClass =
    'h-9 rounded-sm border border-border bg-card px-2 text-small text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <label htmlFor="ai-usage-feature" className="text-caption text-muted-foreground">
            {t('ai.usage.filter.feature')}
          </label>
          <select
            id="ai-usage-feature"
            className={selectClass}
            value={featureFilter}
            onChange={(e) => setFeatureFilter(e.target.value as 'all' | AiTraceFeatureId)}
          >
            <option value="all">{t('ai.usage.filter.allFeatures')}</option>
            {featuresPresent.map(([id, label]) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="ai-usage-status" className="text-caption text-muted-foreground">
            {t('ai.usage.filter.status')}
          </label>
          <select
            id="ai-usage-status"
            className={selectClass}
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as 'all' | Trace['status'])}
          >
            <option value="all">{t('ai.usage.filter.allStatuses')}</option>
            {TRACE_STATUSES.map((status) => (
              <option key={status} value={status}>
                {t(`ai.usage.status.${status}`)}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="ai-usage-range" className="text-caption text-muted-foreground">
            {t('ai.usage.filter.range')}
          </label>
          <select
            id="ai-usage-range"
            className={selectClass}
            value={String(days)}
            onChange={(e) => setDays(e.target.value === 'all' ? 'all' : Number(e.target.value))}
          >
            <option value="7">{t('ai.usage.filter.days7')}</option>
            <option value="30">{t('ai.usage.filter.days30')}</option>
            <option value="90">{t('ai.usage.filter.days90')}</option>
            <option value="all">{t('ai.usage.filter.allTime')}</option>
          </select>
        </div>

        <p className="ml-auto pb-2 text-caption tabular-nums text-muted-foreground" role="status">
          {t('ai.usage.filter.count', {
            shown: formatNumber(filtered.length, locale),
            total: formatNumber(traces.length, locale),
          })}
        </p>
      </div>

      {filtered.length === 0 ? (
        <StateView
          kind="empty"
          titleKey="ai.usage.filtered.title"
          bodyKey="ai.usage.filtered.body"
          action={{
            labelKey: 'ai.usage.filtered.action',
            onAction: () => {
              setFeatureFilter('all')
              setStatusFilter('all')
              setDays('all')
            },
          }}
        />
      ) : (
        <>
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
              <Stagger
                as="tbody"
                animateKey={`${featureFilter}|${statusFilter}|${days}|${safePage}`}
              >
                {shown.map((trace) => {
                  const date = new Date(trace.createdAt)
                  return (
                    <StaggerItem
                      as="tr"
                      key={trace.id}
                      className="border-b border-border last:border-0"
                    >
                      <td className="px-3 py-2 text-foreground">
                        {formatDate(date, locale)} {formatTime(date, locale)}
                      </td>
                      <td className="px-3 py-2 text-foreground">
                        {trace.userName || t('ai.usage.unknownUser')}
                      </td>
                      <td className="px-3 py-2 text-foreground">
                        {t(featureLabelKey(trace.feature))}
                      </td>
                      <td className="px-3 py-2">
                        <Badge tone={STATUS_TONE[trace.status]}>
                          {t(`ai.usage.status.${trace.status}`)}
                        </Badge>
                      </td>
                      <td className="px-3 py-2 tabular-nums text-foreground">
                        {formatNumber(trace.totalTokens, locale)}
                      </td>
                      <td className="px-3 py-2 text-foreground">
                        {formatUzs(trace.costUzs, locale)}
                      </td>
                      <td className="px-3 py-2 tabular-nums text-foreground">
                        {t('ai.usage.latencySeconds', {
                          seconds: latencySeconds(trace.latencyMs, locale),
                        })}
                      </td>
                    </StaggerItem>
                  )
                })}
              </Stagger>
            </table>
          </div>

          {pageCount > 1 ? (
            <div className="flex items-center justify-between gap-3">
              <Button
                variant="ghost"
                size="sm"
                disabled={safePage === 0}
                onClick={() => setPage((prev) => Math.max(0, prev - 1))}
              >
                {t('ai.usage.page.previous')}
              </Button>
              <p className="text-caption tabular-nums text-muted-foreground" role="status">
                {t('ai.usage.page.of', {
                  page: formatNumber(safePage + 1, locale),
                  pages: formatNumber(pageCount, locale),
                })}
              </p>
              <Button
                variant="ghost"
                size="sm"
                disabled={safePage >= pageCount - 1}
                onClick={() => setPage((prev) => Math.min(pageCount - 1, prev + 1))}
              >
                {t('ai.usage.page.next')}
              </Button>
            </div>
          ) : null}
        </>
      )}
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
