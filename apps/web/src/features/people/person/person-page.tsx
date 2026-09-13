// The person page (v1.1 SPEC §6) -- "click a xodim anywhere and see everything about them".
//
// Who sees what, decided on the server and mirrored here so the client only ever *hides*:
//  * the head sees any member of their boshqarma;
//  * a xodim sees exactly one person page, their own (`/people/me`), and the server answers that
//    route on `{kind:'own_account'}` rather than on the head-only subject;
//  * nothing on this page can carry personal-workspace content. The focus figure is the aggregate
//    minute count `app.focus_minutes_by_user` is physically limited to (I-1), and the Faollik tab is
//    a union of work events, never an audit-log mirror.
import * as React from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useLocale, useT, formatDate, formatRelativeTime } from '@devon/i18n'
import { getIndicator, type IndicatorKey } from '@devon/contracts'
import {
  Avatar,
  Badge,
  Button,
  Card,
  Progress,
  SegmentedControl,
  Skeleton,
  Stagger,
  StaggerItem,
  StatNumber,
  StateView,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  cn,
  initialsFromName,
} from '@devon/ui'
import { ArrowLeft, CalendarDays, ClipboardList, Send, Table2, UserPlus } from 'lucide-react'
import { avatarUrl } from '../../../lib/avatar.js'
import { ApiError } from '../../../lib/api-client.js'
import { navigate } from '../../../lib/router.js'
import { useSession } from '../../../lib/session.js'
import { createCard } from '../../work/api.js'
import type { PersonCard, PersonOverview } from '../api.js'
import {
  useCsrfToken,
  usePersonActivityQuery,
  usePersonCardsQuery,
  usePersonOverviewQuery,
} from '../hooks.js'
import { QuickAssignSheet, type QuickAssignSubmit } from '../components/quick-assign-sheet.js'
import { boardColumnPath } from '../routes.js'
import { formatIndicator } from '../format.js'
import { LoadByProjectChart, OnTimeChart, ThroughputChart } from './person-charts.js'
import { PersonFieldsTab } from './person-fields-tab.js'

export type PersonPageProps = {
  /** A user id, or the literal `me` -- the server resolves `me` to the caller. */
  userId: string
  /** Where "back" goes: the directory, the table, or the dashboard that linked here. */
  onBack?: () => void
}

const KPI_KEYS: readonly IndicatorKey[] = [
  'openCards',
  'overdueCards',
  'onTimeRate90d',
  'workloadPct',
  'focusMinutes7d',
]

type Translate = (key: string, vars?: Record<string, string | number>) => string

export function PersonPage({ userId, onBack }: PersonPageProps): React.JSX.Element {
  const t = useT()
  const locale = useLocale()
  const session = useSession()
  const overviewQuery = usePersonOverviewQuery(userId)
  const [tab, setTab] = React.useState('overview')
  const [assignOpen, setAssignOpen] = React.useState(false)
  const csrf = useCsrfToken()
  const queryClient = useQueryClient()
  const assignMutation = useMutation({
    mutationFn: (input: QuickAssignSubmit) =>
      Promise.all(
        input.assigneeUserIds.map((assigneeUserId) =>
          createCard(
            {
              title: input.title,
              assigneeUserId,
              priority: input.priority,
              dueAt: input.dueAt,
              ...(input.estimateMin === null ? {} : { estimateMin: input.estimateMin }),
            },
            csrf,
          ),
        ),
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['work', 'board'] })
      void queryClient.invalidateQueries({ queryKey: ['people'] })
    },
  })

  if (overviewQuery.isPending) {
    return (
      <div className="flex flex-col gap-4" aria-hidden="true">
        <Skeleton className="h-24 w-full rounded-lg" />
        <Skeleton className="h-9 w-80 rounded-sm" />
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          {Array.from({ length: 5 }).map((_, index) => (
            <Skeleton key={index} className="h-24 rounded-md" />
          ))}
        </div>
        <Skeleton className="h-48 w-full rounded-md" />
      </div>
    )
  }

  const error = overviewQuery.error
  if (error instanceof ApiError && error.code === 'forbidden') {
    return (
      <StateView
        kind="forbidden"
        titleKey="people.person.denied.title"
        bodyKey="people.person.denied.body"
        action={{ labelKey: 'people.person.denied.action', onAction: () => navigate('/people/me') }}
      />
    )
  }
  if (error instanceof ApiError && error.code === 'not_found') {
    return (
      <StateView
        kind="empty"
        titleKey="people.person.missing.title"
        bodyKey="people.person.missing.body"
        action={{ labelKey: 'people.person.missing.action', onAction: () => navigate('/people') }}
      />
    )
  }
  if (error || !overviewQuery.data) {
    return (
      <StateView
        kind="error"
        titleKey="state.error.title"
        bodyKey="state.error.body"
        action={{ labelKey: 'state.error.action', onAction: () => void overviewQuery.refetch() }}
      />
    )
  }

  const data = overviewQuery.data
  const isSelf = data.header.userId === session.user?.id
  const showOnboarding = data.onboarding.percent < 100

  return (
    <div className="flex flex-col gap-5">
      {onBack ? (
        <Button variant="ghost" size="sm" className="self-start" onClick={onBack}>
          <ArrowLeft aria-hidden="true" className="size-4" />
          {t('people.person.back')}
        </Button>
      ) : null}

      <PersonHeaderCard
        data={data}
        t={t}
        locale={locale}
        isSelf={isSelf}
        onAssign={() => setAssignOpen(true)}
      />

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="overview">{t('people.person.tab.overview')}</TabsTrigger>
          <TabsTrigger value="tasks">{t('people.person.tab.tasks')}</TabsTrigger>
          <TabsTrigger value="projects" count={data.projects.length}>
            {t('people.person.tab.projects')}
          </TabsTrigger>
          <TabsTrigger value="events" count={data.events.length}>
            {t('people.person.tab.events')}
          </TabsTrigger>
          {showOnboarding ? (
            <TabsTrigger value="onboarding">{t('people.person.tab.onboarding')}</TabsTrigger>
          ) : null}
          <TabsTrigger value="fields">{t('people.person.tab.fields')}</TabsTrigger>
          <TabsTrigger value="activity">{t('people.person.tab.activity')}</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="pt-4">
          <OverviewTab data={data} t={t} locale={locale} />
        </TabsContent>
        <TabsContent value="tasks" className="pt-4">
          <TasksTab userId={userId} t={t} locale={locale} />
        </TabsContent>
        <TabsContent value="projects" className="pt-4">
          <ProjectsTab data={data} t={t} locale={locale} />
        </TabsContent>
        <TabsContent value="events" className="pt-4">
          <EventsTab data={data} t={t} locale={locale} />
        </TabsContent>
        {showOnboarding ? (
          <TabsContent value="onboarding" className="pt-4">
            <OnboardingTab data={data} t={t} />
          </TabsContent>
        ) : null}
        <TabsContent value="fields" className="pt-4">
          <PersonFieldsTab
            userId={data.header.userId}
            canManage={data.canManage}
            canEditOwn={isSelf}
          />
        </TabsContent>
        <TabsContent value="activity" className="pt-4">
          <ActivityTab userId={userId} t={t} locale={locale} />
        </TabsContent>
      </Tabs>

      {/* SPEC §6 "actions (head): assign a task". The same sheet the people table uses, so a task
          given from a person page and a task given from a row are the same object with the same
          fields -- and neither one navigates away to a board that never read the parameter. */}
      <QuickAssignSheet
        targets={
          assignOpen
            ? [
                {
                  userId: data.header.userId,
                  givenName: data.header.givenName,
                  familyName: data.header.familyName,
                  title: data.header.title,
                  avatarKey: data.header.avatarKey,
                },
              ]
            : []
        }
        onOpenChange={(open) => {
          if (!open) setAssignOpen(false)
        }}
        onSubmit={async (input) => {
          await assignMutation.mutateAsync(input)
        }}
        pending={assignMutation.isPending}
      />
    </div>
  )
}

function PersonHeaderCard({
  data,
  t,
  locale,
  isSelf,
  onAssign,
}: {
  data: PersonOverview
  t: Translate
  locale: ReturnType<typeof useLocale>
  isSelf: boolean
  onAssign: () => void
}): React.JSX.Element {
  const header = data.header
  const name = `${header.givenName} ${header.familyName}`.trim()
  const formal = [header.familyName, header.givenName, header.patronymic].filter(Boolean).join(' ')

  return (
    <Card elevation="flat" className="flex flex-col gap-4 sm:flex-row sm:items-start">
      <Avatar
        size="lg"
        alt={name}
        hueSeed={header.userId}
        initials={initialsFromName(header.givenName, header.familyName)}
        src={avatarUrl(header.avatarKey, 128)}
      />
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="font-display text-h2">{name}</h1>
          {header.membershipRole === 'head' ? (
            <Badge tone="primary" variant="subtle">
              {t('shell.department.role.head')}
            </Badge>
          ) : null}
          {isSelf ? <Badge variant="subtle">{t('people.person.you')}</Badge> : null}
        </div>
        <p className="text-small text-muted-foreground">
          {header.title ?? t('people.person.noTitle')}
        </p>
        <dl className="flex flex-wrap gap-x-6 gap-y-1 text-caption">
          <span className="flex gap-1">
            <dt className="text-muted-foreground">{t('people.person.meta.formalName')}</dt>
            <dd>{formal}</dd>
          </span>
          <span className="flex gap-1">
            <dt className="text-muted-foreground">{t('people.person.meta.unit')}</dt>
            <dd>{header.unit ?? t('people.person.meta.noUnit')}</dd>
          </span>
          <span className="flex gap-1">
            <dt className="text-muted-foreground">{t('people.person.meta.unitRole')}</dt>
            <dd>
              {header.unitRole
                ? t(`people.table.unitRole.${header.unitRole}`)
                : t('people.person.meta.noUnitRole')}
            </dd>
          </span>
          <span className="flex gap-1">
            <dt className="text-muted-foreground">{t('people.person.meta.joined')}</dt>
            <dd className="tabular-nums">{formatDate(new Date(header.joinedAt), locale)}</dd>
          </span>
          <span className="flex gap-1">
            <dt className="text-muted-foreground">{t('people.person.meta.lastActive')}</dt>
            <dd>
              {header.lastActiveAt
                ? formatRelativeTime(new Date(header.lastActiveAt), locale)
                : t('people.person.meta.never')}
            </dd>
          </span>
          <span className="flex gap-1">
            <dt className="text-muted-foreground">{t('people.person.meta.telegram')}</dt>
            {/* v1.1 critique SEV3 #33: this read "Telegram  Ha". "Ha" is the answer to a question
                nobody asked out loud -- the field is a *state*, and a state is named, not agreed
                with. "Ulangan" / "Ulanmagan". */}
            <dd>
              {header.telegramLinked
                ? t('people.person.meta.telegramLinked')
                : t('people.person.meta.telegramNotLinked')}
            </dd>
          </span>
        </dl>
      </div>

      {data.canManage ? (
        <div className="flex flex-wrap gap-2 sm:flex-col">
          <Button size="sm" onClick={onAssign}>
            <UserPlus aria-hidden="true" className="size-4" />
            {t('people.person.action.assign')}
          </Button>
          <Button variant="secondary" size="sm" onClick={() => navigate(boardColumnPath(header))}>
            <Table2 aria-hidden="true" className="size-4" />
            {t('people.person.action.board')}
          </Button>
          {header.telegramDeepLink ? (
            <Button asChild variant="secondary" size="sm">
              <a href={header.telegramDeepLink} rel="noopener noreferrer">
                <Send aria-hidden="true" className="size-4" />
                {t('people.person.action.message')}
              </a>
            </Button>
          ) : null}
        </div>
      ) : null}
    </Card>
  )
}

function OverviewTab({
  data,
  t,
  locale,
}: {
  data: PersonOverview
  t: Translate
  locale: ReturnType<typeof useLocale>
}): React.JSX.Element {
  const tiles = KPI_KEYS.map((key) => ({ key, spec: getIndicator(key)! })).filter(
    (tile) => tile.spec && data.indicators[tile.key] !== undefined,
  )

  return (
    <div className="flex flex-col gap-5">
      <Stagger className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        {tiles.map(({ key, spec }) => {
          const raw = data.indicators[key]
          const numeric = typeof raw === 'number'
          return (
            <StaggerItem key={key} className="h-full">
              <Card elevation="flat" className="flex h-full flex-col gap-1">
                <p className="text-eyebrow uppercase tracking-(--text-eyebrow--letter-spacing) text-muted-foreground">
                  {t(spec.labelKey)}
                </p>
                <p className="font-display text-h2 tabular-nums">
                  {numeric && spec.format !== 'minutes' ? (
                    <StatNumber
                      value={raw}
                      locale={locale}
                      {...(spec.format === 'percent' ? { suffix: '%' } : {})}
                    />
                  ) : (
                    formatIndicator(spec, raw ?? null, t, locale)
                  )}
                </p>
                <p className="text-caption text-muted-foreground">{t(spec.descriptionKey)}</p>
              </Card>
            </StaggerItem>
          )
        })}
      </Stagger>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <ThroughputChart points={data.throughput} />
        <OnTimeChart points={data.onTime} />
        <LoadByProjectChart
          points={data.load}
          noProjectLabel={t('people.person.chart.noProject')}
        />
        <Card elevation="flat" className="flex flex-col gap-2">
          <header className="flex flex-col gap-0.5">
            <h3 className="text-small font-medium">{t('people.person.risk.title')}</h3>
            <p className="text-caption text-muted-foreground">{t('people.person.risk.question')}</p>
          </header>
          {data.risks.length === 0 ? (
            <p className="flex min-h-40 items-center justify-center text-caption text-muted-foreground">
              {t('people.person.risk.empty')}
            </p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {data.risks.map((card) => (
                <li key={card.id}>
                  <CardRow card={card} t={t} locale={locale} />
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  )
}

function CardRow({
  card,
  t,
  locale,
}: {
  card: PersonCard
  t: Translate
  locale: ReturnType<typeof useLocale>
}): React.JSX.Element {
  return (
    <a
      href={`/work?card=${card.id}`}
      onClick={(event) => {
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return
        event.preventDefault()
        navigate(`/work?card=${card.id}`)
      }}
      className={cn(
        'flex min-h-11 items-center gap-2 rounded-sm border border-border px-2 py-1.5',
        'transition-colors duration-(--dur-micro) ease-out hover:bg-accent',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        card.risk === 'overdue' && 'border-destructive/40',
      )}
    >
      <span className="min-w-0 flex-1 truncate text-small">{card.title}</span>
      {card.projectTitle ? <Badge variant="subtle">{card.projectTitle}</Badge> : null}
      {card.dueAt ? (
        <span
          className={cn(
            'shrink-0 tabular-nums text-caption',
            card.risk === 'overdue' ? 'text-destructive' : 'text-muted-foreground',
          )}
        >
          {formatDate(new Date(card.dueAt), locale)}
        </span>
      ) : (
        <span className="shrink-0 text-caption text-muted-foreground">
          {t('people.person.tasks.noDue')}
        </span>
      )}
    </a>
  )
}

function TasksTab({
  userId,
  t,
  locale,
}: {
  userId: string
  t: Translate
  locale: ReturnType<typeof useLocale>
}): React.JSX.Element {
  const [role, setRole] = React.useState<'assignee' | 'giver'>('assignee')
  const [status, setStatus] = React.useState<'active' | 'done' | 'all'>('active')
  const query = usePersonCardsQuery(userId, role, status)

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <SegmentedControl
          size="sm"
          label={t('people.person.tasks.roleLabel')}
          value={role}
          onValueChange={setRole}
          options={[
            { value: 'assignee', label: t('people.person.tasks.role.assignee') },
            { value: 'giver', label: t('people.person.tasks.role.giver') },
          ]}
        />
        <SegmentedControl
          size="sm"
          label={t('people.person.tasks.statusLabel')}
          value={status}
          onValueChange={setStatus}
          options={[
            { value: 'active', label: t('people.person.tasks.status.active') },
            { value: 'done', label: t('people.person.tasks.status.done') },
            { value: 'all', label: t('people.person.tasks.status.all') },
          ]}
        />
      </div>

      {(() => {
        if (query.isPending) {
          return (
            <div className="flex flex-col gap-1.5" aria-hidden="true">
              {Array.from({ length: 5 }).map((_, index) => (
                <Skeleton key={index} className="h-11 w-full rounded-sm" />
              ))}
            </div>
          )
        }
        if (query.isError) {
          return (
            <StateView
              kind="error"
              titleKey="state.error.title"
              bodyKey="state.error.body"
              action={{ labelKey: 'state.error.action', onAction: () => void query.refetch() }}
            />
          )
        }
        if ((query.data ?? []).length === 0) {
          return (
            <StateView
              kind="empty"
              titleKey="people.person.tasks.empty.title"
              bodyKey="people.person.tasks.empty.body"
            />
          )
        }
        return (
          <Stagger as="ul" className="flex flex-col gap-1.5" animateKey={`${role}:${status}`}>
            {(query.data ?? []).map((card) => (
              <StaggerItem as="li" key={card.id}>
                <CardRow card={card} t={t} locale={locale} />
              </StaggerItem>
            ))}
          </Stagger>
        )
      })()}
    </div>
  )
}

function ProjectsTab({
  data,
  t,
  locale,
}: {
  data: PersonOverview
  t: Translate
  locale: ReturnType<typeof useLocale>
}): React.JSX.Element {
  if (data.projects.length === 0) {
    return (
      <StateView
        kind="empty"
        titleKey="people.person.projects.empty.title"
        bodyKey="people.person.projects.empty.body"
      />
    )
  }
  return (
    <Stagger className="grid grid-cols-1 gap-3 md:grid-cols-2">
      {data.projects.map((project) => {
        const progress =
          project.totalCards === 0 ? 0 : Math.round((project.doneCards / project.totalCards) * 100)
        return (
          <StaggerItem key={project.id} className="h-full">
            <Card elevation="flat" className="flex h-full flex-col gap-2">
              <div className="flex items-start justify-between gap-2">
                <h3 className="min-w-0 truncate text-small font-medium">{project.title}</h3>
                <Badge variant="subtle" tone={project.role === 'owner' ? 'primary' : 'neutral'}>
                  {project.role === 'owner'
                    ? t('people.person.projects.owner')
                    : t('people.person.projects.member')}
                </Badge>
              </div>
              <Progress
                value={progress}
                label={t('people.person.projects.progressAria', { title: project.title })}
              />
              <p className="text-caption text-muted-foreground">
                {t('people.person.projects.progress', {
                  done: project.doneCards,
                  total: project.totalCards,
                })}
              </p>
              {project.targetOn ? (
                <p className="text-caption tabular-nums text-muted-foreground">
                  {t('people.person.projects.target', {
                    date: formatDate(new Date(project.targetOn), locale),
                  })}
                </p>
              ) : null}
            </Card>
          </StaggerItem>
        )
      })}
    </Stagger>
  )
}

function EventsTab({
  data,
  t,
  locale,
}: {
  data: PersonOverview
  t: Translate
  locale: ReturnType<typeof useLocale>
}): React.JSX.Element {
  return (
    <div className="flex flex-col gap-4">
      <Card elevation="flat" className="flex flex-wrap items-center gap-6">
        <span className="flex flex-col">
          <span className="text-eyebrow uppercase tracking-(--text-eyebrow--letter-spacing) text-muted-foreground">
            {t('people.person.events.rsvpRate')}
          </span>
          <span className="font-display text-h3 tabular-nums">
            {formatIndicator(
              getIndicator('eventsRsvpRate90d')!,
              data.indicators['eventsRsvpRate90d'] ?? null,
              t,
              locale,
            )}
          </span>
        </span>
        <span className="flex flex-col">
          <span className="text-eyebrow uppercase tracking-(--text-eyebrow--letter-spacing) text-muted-foreground">
            {t('people.person.events.polls')}
          </span>
          <span className="font-display text-h3 tabular-nums">
            {t('people.person.events.pollsValue', {
              voted: data.polls.voted,
              total: data.polls.total,
            })}
          </span>
        </span>
      </Card>

      {data.events.length === 0 ? (
        <StateView
          kind="empty"
          titleKey="people.person.events.empty.title"
          bodyKey="people.person.events.empty.body"
        />
      ) : (
        <Stagger as="ul" className="flex flex-col gap-1.5">
          {data.events.map((event) => (
            <StaggerItem as="li" key={event.id}>
              <a
                href={`/events?event=${event.id}`}
                onClick={(clickEvent) => {
                  if (
                    clickEvent.metaKey ||
                    clickEvent.ctrlKey ||
                    clickEvent.shiftKey ||
                    clickEvent.button !== 0
                  )
                    return
                  clickEvent.preventDefault()
                  navigate(`/events?event=${event.id}`)
                }}
                className="flex min-h-11 items-center gap-2 rounded-sm border border-border px-2 py-1.5 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <CalendarDays aria-hidden="true" className="size-4 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate text-small">{event.title}</span>
                {event.drivesCarpool ? (
                  <Badge variant="subtle">{t('people.person.events.driver')}</Badge>
                ) : null}
                {event.claimedSeat ? (
                  <Badge variant="subtle">{t('people.person.events.passenger')}</Badge>
                ) : null}
                {event.rsvp ? (
                  <Badge variant="subtle" tone={event.rsvp === 'yes' ? 'primary' : 'neutral'}>
                    {t(`people.person.events.rsvp.${event.rsvp}`)}
                  </Badge>
                ) : null}
                <span className="shrink-0 tabular-nums text-caption text-muted-foreground">
                  {formatDate(new Date(event.startsAt), locale)}
                </span>
              </a>
            </StaggerItem>
          ))}
        </Stagger>
      )}
    </div>
  )
}

function OnboardingTab({ data, t }: { data: PersonOverview; t: Translate }): React.JSX.Element {
  return (
    <Card elevation="flat" className="flex flex-col gap-3">
      <header className="flex items-center justify-between gap-3">
        <h3 className="text-small font-medium">{t('people.person.onboarding.title')}</h3>
        <span className="tabular-nums text-small text-muted-foreground">
          {data.onboarding.percent}%
        </span>
      </header>
      <Progress value={data.onboarding.percent} label={t('people.person.onboarding.title')} />
      <p className="text-caption text-muted-foreground">{t('people.person.onboarding.note')}</p>
      <ul className="flex flex-col gap-1.5">
        {data.onboarding.steps.map((step) => (
          <li
            key={step.key}
            className={cn(
              'flex min-h-11 items-center gap-2 rounded-sm border border-border px-2',
              step.done && 'border-success/40 bg-success/5',
            )}
          >
            <ClipboardList aria-hidden="true" className="size-4 text-muted-foreground" />
            <span className="flex-1 text-small">
              {t(`people.person.onboarding.step.${step.key}`)}
            </span>
            <span className="text-caption text-muted-foreground">
              {step.done
                ? t('people.person.onboarding.done')
                : t('people.person.onboarding.pending')}
            </span>
          </li>
        ))}
      </ul>
    </Card>
  )
}

function ActivityTab({
  userId,
  t,
  locale,
}: {
  userId: string
  t: Translate
  locale: ReturnType<typeof useLocale>
}): React.JSX.Element {
  const query = usePersonActivityQuery(userId)

  if (query.isPending) {
    return (
      <div className="flex flex-col gap-1.5" aria-hidden="true">
        {Array.from({ length: 6 }).map((_, index) => (
          <Skeleton key={index} className="h-11 w-full rounded-sm" />
        ))}
      </div>
    )
  }
  if (query.isError) {
    return (
      <StateView
        kind="error"
        titleKey="state.error.title"
        bodyKey="state.error.body"
        action={{ labelKey: 'state.error.action', onAction: () => void query.refetch() }}
      />
    )
  }
  const entries = query.data ?? []
  if (entries.length === 0) {
    return (
      <StateView
        kind="empty"
        titleKey="people.person.activity.empty.title"
        bodyKey="people.person.activity.empty.body"
      />
    )
  }

  return (
    <ol className="flex flex-col gap-0">
      {entries.map((entry, index) => (
        <li key={`${entry.at}:${index}`} className="flex gap-3">
          <span className="flex flex-col items-center" aria-hidden="true">
            <span className="mt-3 size-2 shrink-0 rounded-full bg-primary" />
            {index < entries.length - 1 ? <span className="w-px flex-1 bg-border" /> : null}
          </span>
          <span className="flex min-w-0 flex-1 flex-col py-2">
            <span className="text-small">
              {t(`people.person.activity.kind.${entry.kind.replaceAll('.', '_')}`)}
            </span>
            <span className="min-w-0 truncate text-caption text-muted-foreground">
              {entry.cardTitle ?? entry.eventTitle ?? ''}
            </span>
            <span className="text-caption text-muted-foreground">
              {formatRelativeTime(new Date(entry.at), locale)}
            </span>
          </span>
        </li>
      ))}
    </ol>
  )
}
