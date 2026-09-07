// `/` -- Home (TECH-SPEC §5: "a Home page per role answering 'due from me / needs my decision /
// around me' with the pinned charts and upcoming events"), rebuilt to UI-OVERHAUL.md §2 row 4:
// "Greeting by time of day, 'due from me / needs my decision / around me' tiles, pinned charts,
// everything staggers in", plus the onboarding checklist card from row "Onboarding".
//
// This feature's manifest registers the exact-path route `/`, so this screen fully replaces
// `apps/web/src/routes/home.tsx`'s EPIC-000 placeholder -- every guard that placeholder had (forced
// state, loading, offline, redirect-to-login) is reproduced here first, verbatim, before any of this
// module's own content renders.
import * as React from 'react'
import { useT, useLocale } from '@devon/i18n'
import {
  AmbientGradient,
  Card,
  Checkbox,
  KpiTile,
  Progress,
  Reveal,
  Stagger,
  StaggerItem,
  StateView,
  WelcomeIllustration,
} from '@devon/ui'
import { ArrowRight, CalendarDays, Gavel, ListTodo } from 'lucide-react'
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

/** One of the three "what is being asked of me" tiles. A tile that has nothing to say still renders
 * -- three tiles that come and go would move the two that remain, and the shape of Home is part of
 * what makes it readable in ten seconds. */
function DashboardTile({
  icon: Icon,
  titleKey,
  bodyKey,
  bodyParams,
  ctaKey,
  onCta,
  tone,
}: {
  icon: React.ComponentType<React.SVGProps<SVGSVGElement>>
  titleKey: string
  bodyKey: string
  bodyParams?: Record<string, string | number>
  ctaKey?: string
  onCta?: () => void
  tone?: 'attention' | 'neutral'
}) {
  const t = useT()
  return (
    <Card
      interactive={Boolean(onCta)}
      className="flex h-full flex-col gap-3"
      {...(onCta ? { onClick: onCta } : {})}
    >
      <span
        className={
          tone === 'attention'
            ? 'inline-flex size-9 items-center justify-center rounded-sm bg-attention/20 text-foreground'
            : 'inline-flex size-9 items-center justify-center rounded-sm bg-accent text-accent-foreground'
        }
      >
        <Icon className="size-4.5" aria-hidden="true" />
      </span>
      <h3 className="text-lead font-medium text-foreground">{t(titleKey)}</h3>
      <p className="flex-1 text-body text-muted-foreground">{t(bodyKey, bodyParams)}</p>
      {ctaKey && onCta ? (
        <span className="inline-flex items-center gap-1 text-small font-medium text-primary">
          {t(ctaKey)}
          <ArrowRight className="size-3.5" aria-hidden="true" />
        </span>
      ) : null}
    </Card>
  )
}

interface ChecklistItem {
  id: string
  labelKey: string
  done: boolean
  onGo: () => void
}

/** UI-OVERHAUL.md §2 "Onboarding" (Notion, Slack): a checklist card on Home with progress, each item
 * one click away. Every item is derived from data Home already has -- nothing here is a stored
 * "tour step", so it can never disagree with reality, and the whole card disappears for good once
 * the last item is true. */
function OnboardingCard({ items }: { items: readonly ChecklistItem[] }) {
  const t = useT()
  const done = items.filter((item) => item.done).length
  if (done === items.length) return null

  return (
    <Reveal>
      <Card className="flex flex-col gap-4">
        <div className="flex items-start gap-4">
          <WelcomeIllustration className="hidden w-28 shrink-0 sm:block" />
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <h3 className="text-lead font-medium text-foreground">
              {t('home.dashboard.onboarding.title')}
            </h3>
            <p className="text-small tabular-nums text-muted-foreground">
              {t('home.dashboard.onboarding.body', { done, total: items.length })}
            </p>
            <Progress
              value={(done / items.length) * 100}
              label={t('home.dashboard.onboarding.title')}
              size="sm"
            />
          </div>
        </div>
        <ul className="flex flex-col gap-1">
          {items.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                onClick={item.onGo}
                className="flex min-h-11 w-full items-center gap-3 rounded-sm px-2 text-left text-body text-foreground transition-colors duration-(--dur-micro) hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <Checkbox checked={item.done} disabled aria-hidden="true" tabIndex={-1} />
                <span className={item.done ? 'text-muted-foreground line-through' : undefined}>
                  {t(item.labelKey)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </Card>
    </Reveal>
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
      <Card dashed elevation="flat" className="flex flex-col gap-2">
        <h3 className="text-lead font-medium text-foreground">
          {t('home.dashboard.pinned.title')}
        </h3>
        <p className="text-small text-muted-foreground">{t('home.dashboard.pinned.empty')}</p>
        <button
          type="button"
          onClick={() => navigate('/analytics')}
          className="inline-flex items-center gap-1 self-start text-small font-medium text-primary hover:underline"
        >
          {t('home.dashboard.pinned.cta')}
          <ArrowRight className="size-3.5" aria-hidden="true" />
        </button>
      </Card>
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
      <h3 className="text-lead font-medium text-foreground">{t('home.dashboard.pinned.title')}</h3>
      <Stagger className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        {pins.map((pin) => {
          const Section = SECTION_BY_KEY[pin.chartKey]
          return (
            <StaggerItem key={pin.id}>
              <Section {...sectionProps} />
            </StaggerItem>
          )
        })}
      </Stagger>
    </div>
  )
}

function Dashboard({ hasAvatar }: { hasAvatar: boolean }) {
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

  const checklist: ChecklistItem[] = [
    {
      id: 'photo',
      labelKey: 'home.dashboard.onboarding.photo',
      done: hasAvatar,
      onGo: () => navigate('/account'),
    },
    {
      id: 'work',
      labelKey: 'home.dashboard.onboarding.work',
      done: p.openCount > 0 || p.overdueCount > 0,
      onGo: () => navigate('/work'),
    },
    {
      id: 'event',
      labelKey: 'home.dashboard.onboarding.event',
      done: p.upcomingEventCount > 0,
      onGo: () => navigate('/events'),
    },
    {
      id: 'focus',
      labelKey: 'home.dashboard.onboarding.focus',
      done: p.focusMinutesThisWeek > 0,
      onGo: () => navigate('/personal'),
    },
  ]

  return (
    <div className="flex w-full flex-col gap-8">
      <section className="flex flex-col gap-3">
        <h2 className="text-eyebrow uppercase tracking-(--text-eyebrow--letter-spacing) text-muted-foreground">
          {t('home.dashboard.sectionTiles')}
        </h2>
        <Stagger className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <StaggerItem className="h-full">
            <DashboardTile
              icon={ListTodo}
              titleKey="home.dashboard.dueFromMe.title"
              bodyKey="home.dashboard.dueFromMe.body"
              bodyParams={{ open: p.openCount, overdue: p.overdueCount }}
              ctaKey="home.dashboard.dueFromMe.cta"
              onCta={() => navigate('/work/mine')}
              tone={p.overdueCount > 0 ? 'attention' : 'neutral'}
            />
          </StaggerItem>
          <StaggerItem className="h-full">
            {p.givenOverdueCount > 0 ? (
              <DashboardTile
                icon={Gavel}
                titleKey="home.dashboard.needsMyDecision.title"
                bodyKey="home.dashboard.needsMyDecision.body"
                bodyParams={{ count: p.givenOverdueCount }}
                ctaKey="home.dashboard.dueFromMe.cta"
                onCta={() => navigate('/work')}
                tone="attention"
              />
            ) : (
              <DashboardTile
                icon={Gavel}
                titleKey="home.dashboard.needsMyDecision.title"
                bodyKey="home.dashboard.needsMyDecision.empty"
              />
            )}
          </StaggerItem>
          <StaggerItem className="h-full">
            <DashboardTile
              icon={CalendarDays}
              titleKey="home.dashboard.aroundMe.title"
              bodyKey="home.dashboard.aroundMe.body"
              bodyParams={{ count: p.upcomingEventCount }}
              ctaKey="home.dashboard.aroundMe.cta"
              onCta={() => navigate('/events')}
            />
          </StaggerItem>
        </Stagger>
      </section>

      <Stagger className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <StaggerItem>
          <KpiTile
            label={t('home.dashboard.personal.onTimeRate')}
            value={p.onTimeRate === null ? null : Math.round(p.onTimeRate * 100)}
            suffix="%"
            question={t('home.dashboard.kpi.onTimeQuestion')}
          />
        </StaggerItem>
        <StaggerItem>
          <KpiTile
            label={t('home.dashboard.personal.focusMinutes')}
            value={p.focusMinutesThisWeek}
            question={t('home.dashboard.kpi.focusQuestion')}
          />
        </StaggerItem>
      </Stagger>

      <OnboardingCard items={checklist} />

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
    <Reveal className="flex flex-col gap-1">
      <p className="text-eyebrow uppercase tracking-(--text-eyebrow--letter-spacing) text-muted-foreground">
        {t('home.eyebrow')}
      </p>
      <h1 className="font-display text-hero text-foreground">
        {t(greetingKey(tashkentHour(now)), { name: greetingName(user) })}
      </h1>
      <p className="text-lead text-muted-foreground">{formatHomeDateLine(now, locale)}</p>
    </Reveal>
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
      <div className="relative flex flex-col gap-8">
        <AmbientGradient variant="hub" />
        {header}
        <StateView
          kind="empty"
          titleKey={empty.titleKey}
          bodyKey={empty.bodyKey}
          illustration={<WelcomeIllustration />}
          action={{ labelKey: empty.actionKey, onAction: empty.onAction }}
          className="w-full max-w-140"
        />
      </div>
    )
  }

  return (
    <div className="relative flex flex-col gap-8">
      {/* DESIGN.md v2: the ambient gradient lives on auth and the hub only. Home is the hub. */}
      <AmbientGradient variant="hub" />
      {header}
      <Dashboard hasAvatar={Boolean(user.avatarKey)} />
    </div>
  )
}
