// The boshqarma boshlig'i's Home (v1.1 SPEC §3.2) -- the answer to CTO finding #2: the head's home is
// for *management* (people, load, risk, decisions), the member's home is for *working*. Same shell,
// two products.
//
// Every number here is real and comes from an endpoint that already exists: the analytics summary
// (whose person-axis sections the server serves only to a head), the shared people-indicator service
// (SPEC §4.2, head-only), and the head's own personal overview. Nothing is mocked and nothing is a
// dashed "coming soon" box -- a management dashboard that lies once is never trusted again.
//
// `HeadDashboardTile` below is the typed seam the head-console package extends (SPEC §13): it adds
// `Xavf ostida` from `computeRisk`, `Maqsadlar` from the goals module and `AI xulosa` from the
// catch-up feature by adding entries to `HEAD_TILES`, not by rewriting this file.
import * as React from 'react'
import { useQuery } from '@tanstack/react-query'
import { useT, useLocale, formatNumber } from '@devon/i18n'
import { INDICATORS, type IndicatorKey } from '@devon/contracts'
import {
  Avatar,
  Card,
  Progress,
  Reveal,
  Stagger,
  StaggerItem,
  StatNumber,
  StateView,
  cn,
  initialsFromName,
} from '@devon/ui'
import { AlertTriangle, CalendarDays, Gavel, Sparkle, Users2 } from 'lucide-react'
import { navigate } from '../../lib/router.js'
import { avatarUrl } from '../../lib/avatar.js'
import { useDepartment } from '../../lib/session.js'
import { fetchMembers, type Member } from '../structure/api.js'
import { fetchIndicators } from '../people/api.js'
import { usePersonalOverviewQuery, useSummaryQuery } from '../analytics/use-analytics.js'

/** The indicator keys this dashboard asks for. Narrow on purpose: the service runs one query per
 * source it is actually asked about, so a five-tile dashboard costs three statements. */
const DASHBOARD_KEYS: readonly IndicatorKey[] = [
  'overdueCards',
  'openCards',
  'workloadPct',
  'onboardingPct',
  'joinedAt',
]

/**
 * A tile on the head's Home. The head-console package adds entries to `HEAD_TILES`; the layout,
 * the stagger and the empty-state contract live here, once.
 */
export type HeadDashboardTile = {
  id: string
  titleKey: string
  /** One line saying what the number means -- never a bare number on a management screen. */
  meaningKey: string
  icon: React.ComponentType<React.SVGProps<SVGSVGElement>>
  /** Where the drill-down goes. */
  onOpen: () => void
  ctaKey: string
}

function TileShell({
  tile,
  tone = 'neutral',
  children,
}: {
  tile: Pick<HeadDashboardTile, 'titleKey' | 'meaningKey' | 'icon' | 'onOpen' | 'ctaKey'>
  tone?: 'neutral' | 'attention'
  children: React.ReactNode
}): React.JSX.Element {
  const t = useT()
  const Icon = tile.icon
  return (
    <Card
      elevation="flat"
      className={cn(
        'flex h-full flex-col gap-3',
        tone === 'attention' && 'border-warning/40 bg-warning/5',
      )}
    >
      <div className="flex items-center gap-2 text-muted-foreground">
        <Icon aria-hidden="true" className="size-4" />
        <h3 className="text-small font-medium text-foreground">{t(tile.titleKey)}</h3>
      </div>
      {children}
      <p className="text-caption text-muted-foreground">{t(tile.meaningKey)}</p>
      <button
        type="button"
        onClick={tile.onOpen}
        className="mt-auto self-start text-small font-medium text-primary hover:underline"
      >
        {t(tile.ctaKey)}
      </button>
    </Card>
  )
}

function PersonRow({
  member,
  right,
}: {
  member: Member
  right: React.ReactNode
}): React.JSX.Element {
  const name = `${member.givenName} ${member.familyName}`.trim()
  return (
    <li className="flex items-center gap-2">
      <Avatar
        size="sm"
        alt={name}
        hueSeed={member.userId}
        initials={initialsFromName(member.givenName, member.familyName)}
        src={avatarUrl(member.avatarKey, 64)}
      />
      <span className="min-w-0 flex-1 truncate text-small">{name}</span>
      {right}
    </li>
  )
}

export function HeadDashboard(): React.JSX.Element {
  const t = useT()
  const locale = useLocale()
  const { departmentId } = useDepartment()

  const membersQuery = useQuery({
    queryKey: ['structure', 'members', departmentId],
    queryFn: () => fetchMembers(departmentId!),
    enabled: departmentId !== null,
  })
  const indicatorsQuery = useQuery({
    queryKey: ['people', 'indicators', departmentId, DASHBOARD_KEYS.join(',')],
    queryFn: () => fetchIndicators([...DASHBOARD_KEYS]),
    enabled: departmentId !== null,
  })
  const summaryQuery = useSummaryQuery({})
  const overviewQuery = usePersonalOverviewQuery()

  const pending =
    membersQuery.isPending ||
    indicatorsQuery.isPending ||
    summaryQuery.isPending ||
    overviewQuery.isPending

  if (pending) return <StateView kind="loading" titleKey="state.loading" />

  const failed =
    membersQuery.isError || indicatorsQuery.isError || summaryQuery.isError || overviewQuery.isError
  if (failed) {
    return (
      <StateView
        kind="error"
        titleKey="state.error.title"
        bodyKey="state.error.body"
        action={{
          labelKey: 'state.error.action',
          onAction: () => {
            void indicatorsQuery.refetch()
            void summaryQuery.refetch()
          },
        }}
      />
    )
  }

  const members = membersQuery.data ?? []
  const membersById = new Map(members.map((m) => [m.userId, m]))
  const rows = indicatorsQuery.data?.people ?? []
  const capacity = indicatorsQuery.data?.capacityCards ?? 8
  const summary = summaryQuery.data
  const overview = overviewQuery.data

  const num = (userId: string, key: IndicatorKey): number =>
    Number(rows.find((r) => r.userId === userId)?.values[key] ?? 0)

  const overdueByPerson = members
    .map((member) => ({ member, overdue: num(member.userId, 'overdueCards') }))
    .filter((row) => row.overdue > 0)
    .sort((a, b) => b.overdue - a.overdue)
    .slice(0, 5)

  const loadThisWeek = members
    .map((member) => ({
      member,
      pct: num(member.userId, 'workloadPct'),
      open: num(member.userId, 'openCards'),
    }))
    .sort((a, b) => b.pct - a.pct)
    .slice(0, 5)

  const onboarding = members
    .map((member) => ({ member, pct: num(member.userId, 'onboardingPct') }))
    .filter((row) => row.pct !== 100)
    .sort((a, b) => a.pct - b.pct)
    .slice(0, 4)

  const slippingProjects = [...(summary?.projectProgress ?? [])]
    .sort((a, b) => a.progress - b.progress)
    .slice(0, 4)

  const now = Date.now()
  const SEVEN_DAYS_MS = 7 * 86_400_000
  const upcomingEvents: NonNullable<typeof summary>['eventsParticipation'] = []
  for (const event of summary?.eventsParticipation ?? []) {
    const startsIn = new Date(event.startsAt).getTime() - now
    if (startsIn < 0) continue
    if (startsIn > SEVEN_DAYS_MS) continue
    upcomingEvents.push(event)
    if (upcomingEvents.length === 4) break
  }

  const decisionsWaiting = overview?.givenOverdueCount ?? 0
  const totalOverdue = members.reduce((sum, member) => sum + num(member.userId, 'overdueCards'), 0)
  const overloaded = loadThisWeek.filter((row) => row.pct >= 100).length

  return (
    <div className="flex w-full flex-col gap-8">
      <section className="flex flex-col gap-3">
        <h2 className="text-eyebrow uppercase tracking-(--text-eyebrow--letter-spacing) text-muted-foreground">
          {t('home.head.section')}
        </h2>

        <Stagger className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {/* Qaror kutmoqda */}
          <StaggerItem className="h-full">
            <TileShell
              tile={{
                titleKey: 'home.head.decisions.title',
                meaningKey: 'home.head.decisions.meaning',
                icon: Gavel,
                ctaKey: 'home.head.decisions.cta',
                onOpen: () => navigate('/work'),
              }}
              tone={decisionsWaiting > 0 ? 'attention' : 'neutral'}
            >
              <StatNumber value={decisionsWaiting} locale={locale} />
            </TileShell>
          </StaggerItem>

          {/* Kechikayotgan ishlar -- overdue by person */}
          <StaggerItem className="h-full">
            <TileShell
              tile={{
                titleKey: 'home.head.overdue.title',
                meaningKey: 'home.head.overdue.meaning',
                icon: AlertTriangle,
                ctaKey: 'home.head.overdue.cta',
                onOpen: () => navigate('/people/table'),
              }}
              tone={totalOverdue > 0 ? 'attention' : 'neutral'}
            >
              {overdueByPerson.length === 0 ? (
                <p className="text-small text-muted-foreground">{t('home.head.overdue.empty')}</p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {overdueByPerson.map(({ member, overdue }) => (
                    <PersonRow
                      key={member.userId}
                      member={member}
                      right={
                        <span className="tabular-nums text-small font-medium text-danger">
                          {formatNumber(overdue, locale)}
                        </span>
                      }
                    />
                  ))}
                </ul>
              )}
            </TileShell>
          </StaggerItem>

          {/* Bu hafta yuklama */}
          <StaggerItem className="h-full">
            <TileShell
              tile={{
                titleKey: 'home.head.load.title',
                meaningKey: 'home.head.load.meaning',
                icon: Users2,
                ctaKey: 'home.head.load.cta',
                onOpen: () => navigate('/people/table'),
              }}
              tone={overloaded > 0 ? 'attention' : 'neutral'}
            >
              {loadThisWeek.length === 0 ? (
                <p className="text-small text-muted-foreground">{t('home.head.load.empty')}</p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {loadThisWeek.map(({ member, pct, open }) => (
                    <PersonRow
                      key={member.userId}
                      member={member}
                      right={
                        <span
                          className="tabular-nums text-small text-muted-foreground"
                          title={t('people.table.workload.value', {
                            open,
                            capacity,
                          })}
                        >
                          {pct}%
                        </span>
                      }
                    />
                  ))}
                </ul>
              )}
            </TileShell>
          </StaggerItem>

          {/* Loyihalar */}
          <StaggerItem className="h-full">
            <TileShell
              tile={{
                titleKey: 'home.head.projects.title',
                meaningKey: 'home.head.projects.meaning',
                icon: Sparkle,
                ctaKey: 'home.head.projects.cta',
                onOpen: () => navigate('/projects'),
              }}
            >
              {slippingProjects.length === 0 ? (
                <p className="text-small text-muted-foreground">{t('home.head.projects.empty')}</p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {slippingProjects.map((project) => (
                    <li key={project.id} className="flex flex-col gap-1">
                      <span className="flex items-baseline justify-between gap-2">
                        <span className="min-w-0 truncate text-small">{project.title}</span>
                        <span className="tabular-nums text-caption text-muted-foreground">
                          {Math.round(project.progress)}%
                        </span>
                      </span>
                      <Progress
                        value={Math.round(project.progress)}
                        label={t('home.head.projects.progressAria', { title: project.title })}
                      />
                    </li>
                  ))}
                </ul>
              )}
            </TileShell>
          </StaggerItem>

          {/* Tadbirlar */}
          <StaggerItem className="h-full">
            <TileShell
              tile={{
                titleKey: 'home.head.events.title',
                meaningKey: 'home.head.events.meaning',
                icon: CalendarDays,
                ctaKey: 'home.head.events.cta',
                onOpen: () => navigate('/events'),
              }}
            >
              {upcomingEvents.length === 0 ? (
                <p className="text-small text-muted-foreground">{t('home.head.events.empty')}</p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {upcomingEvents.map((event) => (
                    <li key={event.id} className="flex items-baseline justify-between gap-2">
                      <span className="min-w-0 truncate text-small">{event.title}</span>
                      <span className="tabular-nums text-caption text-muted-foreground">
                        {formatNumber(event.yes, locale)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </TileShell>
          </StaggerItem>

          {/* Yangi xodimlar */}
          <StaggerItem className="h-full">
            <TileShell
              tile={{
                titleKey: 'home.head.onboarding.title',
                meaningKey: 'home.head.onboarding.meaning',
                icon: Users2,
                ctaKey: 'home.head.onboarding.cta',
                onOpen: () => navigate('/people/table'),
              }}
            >
              {onboarding.length === 0 ? (
                <p className="text-small text-muted-foreground">
                  {t('home.head.onboarding.empty')}
                </p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {onboarding.map(({ member, pct }) => (
                    <PersonRow
                      key={member.userId}
                      member={member}
                      right={
                        <span className="tabular-nums text-small text-muted-foreground">
                          {pct}%
                        </span>
                      }
                    />
                  ))}
                </ul>
              )}
            </TileShell>
          </StaggerItem>
        </Stagger>
      </section>

      <Reveal>
        <p className="text-caption text-muted-foreground">
          {t('home.head.indicatorsNote', { count: INDICATORS.length })}
        </p>
      </Reveal>
    </div>
  )
}

/** Kept out of the component so `membersById` stays available to the head-console package's tiles
 * when it extends this file's data (SPEC §13, wave 3). */
export type HeadDashboardData = {
  members: Map<string, Member>
}
