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
import { useT, useLocale, formatNumber } from '@devon/i18n'
import {
  Card,
  Celebrate,
  cn,
  EmptyChartsIllustration,
  HubAmbientWash,
  KpiTile,
  Progress,
  Reveal,
  Stagger,
  StaggerItem,
  StatNumber,
  StateView,
  toast,
  useCelebrate,
  WelcomeIllustration,
} from '@devon/ui'
import { ArrowRight, CalendarDays, Check, Gavel, ListTodo } from 'lucide-react'
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
 * what makes it readable in ten seconds.
 *
 * UI-OVERHAUL.md's critique (item 35): these three led with a prose sentence ("11 ta ochiq, 3 tasi
 * muddatidan o'tgan") and buried the count inside it, unlike every KpiTile on this same page and on
 * Linear's own "My issues" tile, which show the number first. `value` is now the tile's own headline,
 * rendered through `StatNumber` (a bare NumberFlow ticker, locale-aware) exactly the way `KpiTile`
 * renders its number -- the icon + title move up to a small eyebrow row, the full sentence (still
 * carrying the secondary breakdown, e.g. the overdue count) reads underneath as the "prose second"
 * the critique asked for. */
function DashboardTile({
  icon: Icon,
  titleKey,
  value,
  bodyKey,
  bodyParams,
  ctaKey,
  onCta,
  tone,
}: {
  icon: React.ComponentType<React.SVGProps<SVGSVGElement>>
  titleKey: string
  value: number
  bodyKey: string
  bodyParams?: Record<string, string | number>
  ctaKey?: string
  onCta?: () => void
  tone?: 'attention' | 'neutral'
}) {
  const t = useT()
  const locale = useLocale()
  return (
    <Card
      interactive={Boolean(onCta)}
      className="flex h-full flex-col gap-2"
      {...(onCta ? { onClick: onCta } : {})}
    >
      <div className="flex items-center gap-2">
        <span
          className={
            tone === 'attention'
              ? 'inline-flex size-7 shrink-0 items-center justify-center rounded-sm bg-attention/20 text-foreground'
              : 'inline-flex size-7 shrink-0 items-center justify-center rounded-sm bg-accent text-accent-foreground'
          }
        >
          <Icon className="size-4" aria-hidden="true" />
        </span>
        <h3 className="min-w-0 truncate text-small font-medium text-muted-foreground">
          {t(titleKey)}
        </h3>
      </div>
      <span className="font-display text-h1 tabular-nums text-foreground">
        <StatNumber value={value} locale={locale} />
      </span>
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

const ONBOARDING_CELEBRATED_KEY = 'devon.home.onboardingCelebrated'

/** UI-OVERHAUL.md §2 "Onboarding" (Notion, Slack): a checklist card on Home with progress, each item
 * one click away. Every item is derived from data Home already has -- nothing here is a stored
 * "tour step", so it can never disagree with reality, and the whole card disappears for good once
 * the last item is true.
 *
 * UI-OVERHAUL.md §3 "RSVP yes, card done, sprint complete ... onboarding complete": the *first* time
 * the last item lands, the card holds for one beat fully checked with a burst + toast, instead of
 * silently vanishing -- a `localStorage` flag (best-effort; a private window just skips straight to
 * vanishing) makes sure that only ever happens once per browser, not on every later visit to an
 * already-finished checklist. */
function OnboardingCard({ items }: { items: readonly ChecklistItem[] }) {
  const t = useT()
  const done = items.filter((item) => item.done).length
  const complete = done === items.length
  const celebrate = useCelebrate()
  const [dismissed, setDismissed] = React.useState(false)

  React.useEffect(() => {
    if (!complete) return
    const alreadyCelebrated = (() => {
      try {
        return window.localStorage.getItem(ONBOARDING_CELEBRATED_KEY) === '1'
      } catch {
        return true // Storage disabled -- skip straight to vanishing, never repeat.
      }
    })()
    if (alreadyCelebrated) {
      setDismissed(true)
      return
    }
    celebrate.fire()
    toast(t('home.dashboard.onboarding.done'))
    try {
      window.localStorage.setItem(ONBOARDING_CELEBRATED_KEY, '1')
    } catch {
      // Best-effort only -- the celebration still played this once either way.
    }
    const timer = window.setTimeout(() => setDismissed(true), 2400)
    return () => window.clearTimeout(timer)
  }, [complete]) // eslint-disable-line react-hooks/exhaustive-deps -- fire once per completion only

  if (complete && dismissed) return null

  return (
    <Reveal>
      <Card className="flex flex-col gap-4">
        {/* One grid: an illustration column, then a single content column that the title, the
            progress bar AND the checklist rows all share -- previously the list sat as a sibling of
            the title's own flex row, so it started flush with the card's left edge (one grid column
            left of "Boshlash" itself) instead of lining up under it. */}
        <div className="flex items-start gap-4">
          <WelcomeIllustration className="hidden w-28 shrink-0 sm:block" />
          <div className="flex min-w-0 flex-1 flex-col gap-3">
            <div className="flex flex-col gap-2">
              <h3 className="relative inline-flex w-fit text-lead font-medium text-foreground">
                {t('home.dashboard.onboarding.title')}
                {complete ? (
                  <Celebrate play={celebrate.play} onDone={celebrate.onDone} radius={36} />
                ) : null}
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
            <ul className="flex flex-col gap-0.5">
              {items.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    onClick={item.onGo}
                    className="flex min-h-10 w-full items-center gap-3 rounded-sm px-2 text-left text-body text-foreground transition-colors duration-(--dur-micro) hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {/* A real Checkbox renders Radix's own button element with role=checkbox --
                        nesting that inside this row's own button is invalid HTML (a button inside a
                        button) and threw a React hydration warning (found clicking through Home,
                        2026-09). This row's checkmark is purely a status glyph (the click target and
                        the "done" state both live on the outer button), so it renders as a plain
                        decorative span with the same visual language as Checkbox, not the
                        interactive primitive. */}
                    <span
                      aria-hidden="true"
                      className={cn(
                        'inline-flex size-5 shrink-0 items-center justify-center rounded-sm border border-border bg-card text-primary-foreground',
                        item.done && 'border-primary bg-primary',
                      )}
                    >
                      {item.done ? <Check className="size-3.5" aria-hidden="true" /> : null}
                    </span>
                    <span className={item.done ? 'text-muted-foreground line-through' : undefined}>
                      {t(item.labelKey)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
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
    // round2 SEV3 #27: this used to be a left-aligned paragraph plus a text link -- DESIGN.md §9.6's
    // empty-state shape (illustration, one line, exactly one action), sized to sit inside a dashed
    // card among the other tiles rather than the full-page `EmptyState` shell. round3: the block
    // (like the rest of Home) still had no entrance of its own -- wrapped the same way the
    // onboarding card above it already is.
    return (
      <Reveal>
        <Card dashed elevation="flat" className="flex flex-col items-center gap-2 text-center">
          <EmptyChartsIllustration className="w-24 text-illustration-ink" />
          <h3 className="text-lead font-medium text-foreground">
            {t('home.dashboard.pinned.title')}
          </h3>
          <p className="text-small text-muted-foreground">{t('home.dashboard.pinned.empty')}</p>
          <button
            type="button"
            onClick={() => navigate('/analytics')}
            className="inline-flex items-center gap-1 text-small font-medium text-primary hover:underline"
          >
            {t('home.dashboard.pinned.cta')}
            <ArrowRight className="size-3.5" aria-hidden="true" />
          </button>
        </Card>
      </Reveal>
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
    <Reveal className="flex flex-col gap-4">
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
    </Reveal>
  )
}

function Dashboard({ hasAvatar }: { hasAvatar: boolean }) {
  const t = useT()
  const locale = useLocale()
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
              value={p.openCount}
              bodyKey="home.dashboard.dueFromMe.body"
              bodyParams={{
                open: formatNumber(p.openCount, locale),
                overdue: formatNumber(p.overdueCount, locale),
              }}
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
                value={p.givenOverdueCount}
                bodyKey="home.dashboard.needsMyDecision.body"
                bodyParams={{ count: formatNumber(p.givenOverdueCount, locale) }}
                ctaKey="home.dashboard.dueFromMe.cta"
                onCta={() => navigate('/work')}
                tone="attention"
              />
            ) : (
              <DashboardTile
                icon={Gavel}
                titleKey="home.dashboard.needsMyDecision.title"
                value={0}
                bodyKey="home.dashboard.needsMyDecision.empty"
              />
            )}
          </StaggerItem>
          <StaggerItem className="h-full">
            <DashboardTile
              icon={CalendarDays}
              titleKey="home.dashboard.aroundMe.title"
              value={p.upcomingEventCount}
              bodyKey="home.dashboard.aroundMe.body"
              bodyParams={{ count: formatNumber(p.upcomingEventCount, locale) }}
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
            locale={locale}
            suffix="%"
            question={t('home.dashboard.kpi.onTimeQuestion')}
          />
        </StaggerItem>
        <StaggerItem>
          <KpiTile
            label={t('home.dashboard.personal.focusMinutes')}
            value={p.focusMinutesThisWeek}
            locale={locale}
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
        <HubAmbientWash />
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
      <HubAmbientWash />
      {header}
      <Dashboard hasAvatar={Boolean(user.avatarKey)} />
    </div>
  )
}
