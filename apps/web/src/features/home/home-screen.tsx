// `/` -- Home (TECH-SPEC §5: "a Home page per role answering 'due from me / needs my decision /
// around me' with the pinned charts and upcoming events"). This feature's manifest registers the
// exact-path route `/` (MODULE-GUIDE.md "Web features": a feature route is checked before the five
// core routes), so this screen fully replaces `apps/web/src/routes/home.tsx`'s EPIC-000 placeholder --
// every guard that placeholder had (forced state, loading, offline, redirect-to-login) is reproduced
// here first, verbatim, before any of this module's own content renders.
import * as React from 'react'
import { useT, useLocale } from '@devon/i18n'
import { StateView } from '@devon/ui'
import NumberFlow from '@number-flow/react'
import { useForcedState } from '../../lib/forced-state.js'
import { useDepartment, useInstanceQuery, useMeQuery } from '../../lib/session.js'
import { useOnline } from '../../lib/use-online.js'
import { navigate } from '../../lib/router.js'
import { formatHomeDateLine, greetingKey, greetingName, tashkentHour } from '../../lib/greeting.js'
import { ForcedStateBlock } from '../../shell/forced-state-block.js'
import { useOpenPalette } from '../../shell/palette-context.js'
import {
  usePersonalOverviewQuery,
  usePinnedChartsQuery,
  useSummaryQuery,
  useUnpinChartMutation,
} from '../analytics/use-analytics.js'
import {
  EventsParticipationSection,
  LoadPerPersonSection,
  LoadPerUnitSection,
  OnTimeRateSection,
  OpenVsOverdueSection,
  PersonalStatsSection,
  PollTurnoutSection,
  ProjectProgressSection,
  ThroughputSection,
  type SectionProps,
} from '../analytics/sections.js'
import type { AnalyticsChartKey } from '../analytics/types.js'

const SECTION_BY_KEY: Record<AnalyticsChartKey, React.ComponentType<SectionProps>> = {
  throughput: ThroughputSection,
  onTimeRate: OnTimeRateSection,
  openVsOverdue: OpenVsOverdueSection,
  loadPerPerson: LoadPerPersonSection,
  loadPerUnit: LoadPerUnitSection,
  projectProgress: ProjectProgressSection,
  eventsParticipation: EventsParticipationSection,
  pollTurnout: PollTurnoutSection,
  personal: PersonalStatsSection,
}

function DashboardTile({
  titleKey,
  bodyKey,
  bodyParams,
  ctaKey,
  onCta,
}: {
  titleKey: string
  bodyKey: string
  bodyParams?: Record<string, string | number>
  ctaKey?: string
  onCta?: () => void
}) {
  const t = useT()
  return (
    <div className="flex flex-col gap-2 rounded-md border border-border bg-card p-5 shadow-1">
      <h3 className="text-h3 text-foreground">{t(titleKey)}</h3>
      <p className="text-body text-muted-foreground">{t(bodyKey, bodyParams)}</p>
      {ctaKey && onCta ? (
        <button
          type="button"
          onClick={onCta}
          className="self-start text-small font-medium text-primary hover:underline"
        >
          {t(ctaKey)} →
        </button>
      ) : null}
    </div>
  )
}

function PinnedCharts() {
  const t = useT()
  const pinnedQuery = usePinnedChartsQuery()
  const summaryQuery = useSummaryQuery({})
  const unpinChart = useUnpinChartMutation()

  const pins = pinnedQuery.data ?? []
  if (pinnedQuery.isPending || summaryQuery.isPending) return null
  if (pins.length === 0 || !summaryQuery.data) {
    return (
      <div className="flex flex-col gap-2 rounded-md border border-dashed border-border bg-card p-5">
        <h3 className="text-h3 text-foreground">{t('home.dashboard.pinned.title')}</h3>
        <p className="text-small text-muted-foreground">{t('home.dashboard.pinned.empty')}</p>
        <button
          type="button"
          onClick={() => navigate('/analytics')}
          className="self-start text-small font-medium text-primary hover:underline"
        >
          {t('home.dashboard.pinned.cta')} →
        </button>
      </div>
    )
  }

  const pinnedKeys = new Set(pins.map((p) => p.chartKey))
  const sectionProps: SectionProps = {
    summary: summaryQuery.data,
    query: {},
    pinnedKeys,
    onTogglePin: (chartKey) => {
      const pin = pins.find((p) => p.chartKey === chartKey)
      if (pin) unpinChart.mutate(pin.id)
    },
    pinBusy: unpinChart.isPending,
  }

  return (
    <div className="flex flex-col gap-4">
      <h3 className="text-h3 text-foreground">{t('home.dashboard.pinned.title')}</h3>
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        {pins.map((pin) => {
          const Section = SECTION_BY_KEY[pin.chartKey]
          return <Section key={pin.id} {...sectionProps} />
        })}
      </div>
    </div>
  )
}

function Dashboard() {
  const t = useT()
  const overviewQuery = usePersonalOverviewQuery()

  if (overviewQuery.isPending) return <StateView kind="loading" titleKey="state.loading" />
  if (overviewQuery.isError || !overviewQuery.data) {
    return (
      <StateView
        kind="error"
        titleKey="state.error.title"
        bodyKey="state.error.body"
        action={{ labelKey: 'state.error.action', onAction: () => overviewQuery.refetch() }}
      />
    )
  }

  const p = overviewQuery.data
  const hasAnything =
    p.openCount > 0 || p.overdueCount > 0 || p.givenOverdueCount > 0 || p.upcomingEventCount > 0

  return (
    <div className="flex w-full max-w-320 flex-col gap-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <DashboardTile
          titleKey="home.dashboard.dueFromMe.title"
          bodyKey="home.dashboard.dueFromMe.body"
          bodyParams={{ open: p.openCount, overdue: p.overdueCount }}
          ctaKey="home.dashboard.dueFromMe.cta"
          onCta={() => navigate('/work/mine')}
        />
        {p.givenOverdueCount > 0 ? (
          <DashboardTile
            titleKey="home.dashboard.needsMyDecision.title"
            bodyKey="home.dashboard.needsMyDecision.body"
            bodyParams={{ count: p.givenOverdueCount }}
            ctaKey="home.dashboard.dueFromMe.cta"
            onCta={() => navigate('/work')}
          />
        ) : (
          <DashboardTile
            titleKey="home.dashboard.needsMyDecision.title"
            bodyKey="home.dashboard.needsMyDecision.empty"
          />
        )}
        <DashboardTile
          titleKey="home.dashboard.aroundMe.title"
          bodyKey="home.dashboard.aroundMe.body"
          bodyParams={{ count: p.upcomingEventCount }}
          ctaKey="home.dashboard.aroundMe.cta"
          onCta={() => navigate('/events')}
        />
      </div>

      <div className="flex items-center gap-8 rounded-md border border-border bg-card p-4">
        <div className="flex flex-col">
          <span className="text-eyebrow uppercase tracking-(--text-eyebrow--letter-spacing) text-muted-foreground">
            {t('home.dashboard.personal.onTimeRate')}
          </span>
          <span className="font-display text-h2 tabular-nums text-foreground">
            {p.onTimeRate === null ? (
              '—'
            ) : (
              <NumberFlow value={Math.round(p.onTimeRate * 100)} suffix="%" />
            )}
          </span>
        </div>
        <div className="flex flex-col">
          <span className="text-eyebrow uppercase tracking-(--text-eyebrow--letter-spacing) text-muted-foreground">
            {t('home.dashboard.personal.focusMinutes')}
          </span>
          <span className="font-display text-h2 tabular-nums text-foreground">
            <NumberFlow value={p.focusMinutesThisWeek} />
          </span>
        </div>
      </div>

      {hasAnything ? <PinnedCharts /> : null}
    </div>
  )
}

export default function HomeScreen() {
  const t = useT()
  const locale = useLocale()
  const forced = useForcedState()
  const online = useOnline()
  const meQuery = useMeQuery()
  const instanceQuery = useInstanceQuery()
  const openPalette = useOpenPalette()
  const { departmentId } = useDepartment()

  const settled = !meQuery.isPending && !instanceQuery.isPending
  const user = meQuery.data?.user ?? null

  React.useEffect(() => {
    if (forced) return
    if (settled && meQuery.data === null) navigate('/login')
  }, [forced, settled, meQuery.data])

  if (forced) {
    return <ForcedStateBlock kind={forced} />
  }

  if (!settled) {
    return <StateView kind="loading" titleKey="state.loading" />
  }

  if (!online && !user) {
    return (
      <StateView
        kind="offline"
        titleKey="state.offline.banner"
        bodyKey="state.offline.empty"
        action={{ labelKey: 'state.error.action', onAction: () => window.location.reload() }}
      />
    )
  }

  if (!user) return null // redirecting to /login (effect above)

  const isDemo = instanceQuery.data?.isDemo ?? false
  const now = new Date()

  const header = (
    <div className="flex flex-col items-center gap-2 text-center">
      <p className="text-eyebrow uppercase tracking-(--text-eyebrow--letter-spacing) text-muted-foreground">
        {t('home.eyebrow')}
      </p>
      <h1 className="font-display text-hero text-foreground">
        {t(greetingKey(tashkentHour(now)), { name: greetingName(user) })}
      </h1>
      <p className="text-lead text-muted-foreground">{formatHomeDateLine(now, locale)}</p>
    </div>
  )

  // No active department yet (a brand-new account, or a super admin with none) -- the original
  // zero-training empty states (design.md: "nothing yet, and here is how you will find it") still
  // apply exactly as EPIC-000 shipped them; this module's dashboard has nothing to query without a
  // department context.
  if (!departmentId) {
    const empty = isDemo
      ? {
          titleKey: 'home.empty.demo.title',
          bodyKey: undefined,
          actionKey: 'home.empty.action',
          onAction: openPalette,
        }
      : user.role === 'super_admin'
        ? {
            titleKey: 'home.empty.admin.title',
            bodyKey: 'home.empty.admin.body',
            actionKey: 'home.empty.admin.action',
            onAction: () => navigate('/admin'),
          }
        : {
            titleKey: 'home.empty.member.title',
            bodyKey: 'home.empty.member.body',
            actionKey: 'home.empty.action',
            onAction: openPalette,
          }

    return (
      <div className="mx-auto flex max-w-320 flex-col items-center gap-10">
        {header}
        <StateView
          kind="empty"
          titleKey={empty.titleKey}
          bodyKey={empty.bodyKey}
          action={{ labelKey: empty.actionKey, onAction: empty.onAction }}
          className="w-full max-w-140"
        />
      </div>
    )
  }

  return (
    <div className="mx-auto flex max-w-320 flex-col items-center gap-8">
      {header}
      <Dashboard />
    </div>
  )
}
