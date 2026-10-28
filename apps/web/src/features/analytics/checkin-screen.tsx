import type { CheckinBoard, CheckinEntry, CheckinMember } from '@devon/contracts'
import { useLocale, useT } from '@devon/i18n'
import {
  Avatar,
  Button,
  Dialog,
  DialogContent,
  IconButton,
  Input,
  StateView,
  Tabs,
  TabsList,
  TabsContent,
  TabsTrigger,
  cn,
  initialsFromName,
} from '@devon/ui'
import {
  Check,
  Circle,
  CircleAlert,
  ExternalLink,
  LockKeyhole,
  Minus,
  Pencil,
  X,
} from 'lucide-react'
import * as React from 'react'
import { avatarUrl } from '../../lib/avatar.js'
import { navigate, useSearchParams } from '../../lib/router.js'
import { useDepartment, useSession } from '../../lib/session.js'
import { createUnitPalette, unitColorClass } from '../../lib/unit-palette.js'
import { useCheckinChange, useCheckins } from './checkins-api.js'
import './checkins.css'

function name(member: CheckinMember) {
  return `${member.givenName} ${member.familyName}`.trim()
}
function MemberAvatar({ member, large = false }: { member: CheckinMember; large?: boolean }) {
  return (
    <Avatar
      decorative
      alt={name(member)}
      src={avatarUrl(member.avatarKey)}
      initials={initialsFromName(member.givenName, member.familyName)}
      hueSeed={member.unitId ?? member.userId}
      className={large ? 'size-16 text-h3' : undefined}
      size={large ? 'lg' : 'sm'}
    />
  )
}
const stateIcons = { pending: Circle, done: Check, blocked: CircleAlert }

function Deliverable({
  entry,
  closed,
  canRemove,
}: {
  entry: CheckinEntry
  closed: boolean
  canRemove: boolean
}) {
  const t = useT(),
    change = useCheckinChange()
  const [editing, setEditing] = React.useState(false),
    [text, setText] = React.useState(entry.text)
  const Icon = stateIcons[entry.state]
  return (
    <li className="checkin-deliverable" data-state={entry.state}>
      <div className="checkin-deliverable-body">
        {editing ? (
          <form
            className="min-w-0 flex-1"
            onSubmit={(e) => {
              e.preventDefault()
              if (text.trim())
                change.mutate(
                  { kind: 'update', id: entry.id, version: entry.version, text: text.trim() },
                  { onSuccess: () => setEditing(false) },
                )
            }}
          >
            <Input
              autoFocus
              aria-label={t('checkins.edit')}
              value={text}
              maxLength={500}
              onChange={(e) => setText(e.target.value)}
            />
            <div className="mt-2 flex gap-1">
              <IconButton
                type="submit"
                aria-label={t('checkins.save')}
                disabled={change.isPending || !text.trim()}
              >
                <Check />
              </IconButton>
              <IconButton aria-label={t('checkins.cancel')} onClick={() => setEditing(false)}>
                <X />
              </IconButton>
            </div>
          </form>
        ) : (
          <p className="checkin-deliverable-text">{entry.text}</p>
        )}
      </div>
      <div className="checkin-deliverable-footer">
        <Icon aria-hidden="true" className="checkin-state-icon" />
        {closed ? (
          <span className="checkin-state-label">{t(`checkins.state.${entry.state}`)}</span>
        ) : (
          <select
            aria-label={t('checkins.statusFor', { item: entry.text })}
            className="checkin-state-select"
            value={entry.state}
            disabled={change.isPending}
            onChange={(e) =>
              change.mutate({
                kind: 'update',
                id: entry.id,
                version: entry.version,
                state: e.target.value as CheckinEntry['state'],
              })
            }
          >
            {(['pending', 'done', 'blocked'] as const).map((state) => (
              <option key={state} value={state}>
                {t(`checkins.state.${state}`)}
              </option>
            ))}
          </select>
        )}
        <div className="ml-auto flex gap-1">
          {!closed && !editing ? (
            <IconButton
              className="checkin-action checkin-action-edit"
              aria-label={t('checkins.edit')}
              tooltip={t('checkins.edit')}
              onClick={() => {
                setText(entry.text)
                setEditing(true)
              }}
            >
              <Pencil />
            </IconButton>
          ) : null}
          {canRemove ? (
            <IconButton
              className="checkin-action"
              aria-label={t('checkins.remove')}
              tooltip={t('checkins.remove')}
              disabled={change.isPending}
              onClick={() => change.mutate({ kind: 'remove', id: entry.id })}
            >
              <Minus />
            </IconButton>
          ) : null}
        </div>
      </div>
    </li>
  )
}

function PersonCheckin({ data, member }: { data: CheckinBoard; member: CheckinMember }) {
  const [lockReview, setLockReview] = React.useState(false)
  const t = useT(),
    { department } = useDepartment(),
    change = useCheckinChange()
  const cycle = data.cycles.find((c) => c.id === data.selectedCycleId)!
  const entries = data.entries.filter((e) => e.memberUserId === member.userId)
  const groups = new Map<string, CheckinEntry[]>()
  for (const entry of entries) {
    const group = groups.get(entry.cardId) ?? []
    group.push(entry)
    groups.set(entry.cardId, group)
  }
  const closed = !!cycle.checkoutLockedAt,
    locked = !!cycle.checkinLockedAt
  const localDay = new Date(Date.now() + 5 * 3600000).toISOString().slice(0, 10)
  return (
    <section className="checkin-person" aria-label={name(member)}>
      <Dialog open={lockReview} onOpenChange={setLockReview}>
        <DialogContent title={t(locked ? 'checkins.lockCheckout' : 'checkins.lockCheckin')}>
          <p className="my-4 text-small text-muted-foreground">
            {t(locked ? 'checkins.confirmCheckout' : 'checkins.confirmCheckin')}
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setLockReview(false)}>
              {t('checkins.cancel')}
            </Button>
            <Button
              disabled={change.isPending}
              onClick={() =>
                change.mutate(
                  { kind: 'lock', cycleId: cycle.id, phase: locked ? 'checkout' : 'checkin' },
                  { onSuccess: () => setLockReview(false) },
                )
              }
            >
              {t(locked ? 'checkins.lockCheckout' : 'checkins.lockCheckin')}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      <header className="checkin-person-header">
        <div className="min-w-0">
          <h1 className="text-h2 font-semibold leading-tight">{name(member)}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-small text-muted-foreground">
            <span>{t('checkins.total', { count: entries.length })}</span>
            <span>
              {t('checkins.doneCount', { count: entries.filter((e) => e.state === 'done').length })}
            </span>
            <span className="inline-flex items-center gap-1.5">
              {locked ? <LockKeyhole className="size-3.5" /> : null}
              {t(closed ? 'checkins.closed' : locked ? 'checkins.agreed' : 'checkins.draft')}
            </span>
          </div>
        </div>
        <MemberAvatar member={member} large />
      </header>
      <div className="checkin-cycle-note">
        <p className="text-small text-muted-foreground">
          {t(
            closed ? 'checkins.closedHint' : locked ? 'checkins.agreedHint' : 'checkins.draftHint',
          )}
        </p>
        {department?.role === 'head' && !closed ? (
          <Button
            variant="secondary"
            size="sm"
            disabled={change.isPending || (locked && localDay < cycle.endsOn)}
            onClick={() => setLockReview(true)}
          >
            <LockKeyhole className="size-4" />
            {t(locked ? 'checkins.lockCheckout' : 'checkins.lockCheckin')}
          </Button>
        ) : null}
      </div>
      {entries.length ? (
        <div className="checkin-task-columns">
          {[...groups].map(([cardId, items]) => {
            const first = items[0]!
            return (
              <section key={cardId} className="checkin-task-group">
                <header className="checkin-task-header">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      {first.projectTitle ? (
                        <>
                          <h2 className="checkin-project-title">{first.projectTitle}</h2>
                          <h3 className="checkin-task-title is-project-task">{first.cardTitle}</h3>
                        </>
                      ) : (
                        <>
                          <p className="checkin-task-kind">{t('checkins.individual')}</p>
                          <h2 className="checkin-task-title">{first.cardTitle}</h2>
                        </>
                      )}
                    </div>
                    {first.sourceAvailable ? (
                      <IconButton
                        className="checkin-action"
                        aria-label={t('checkins.openTask')}
                        tooltip={t('checkins.openTask')}
                        onClick={() =>
                          navigate(
                            `/work/card?id=${cardId}&from=analytics&cycle=${cycle.id}&member=${member.userId}`,
                          )
                        }
                      >
                        <ExternalLink />
                      </IconButton>
                    ) : null}
                  </div>
                </header>
                <ul className="checkin-deliverables">
                  {items.map((entry) => (
                    <Deliverable
                      key={entry.id}
                      entry={entry}
                      closed={closed}
                      canRemove={!locked && !closed}
                    />
                  ))}
                </ul>
              </section>
            )
          })}
        </div>
      ) : (
        <StateView
          kind="empty"
          titleKey="checkins.empty"
          bodyKey="checkins.emptyHint"
          action={{ labelKey: 'checkins.openCards', onAction: () => navigate('/work') }}
        />
      )}
    </section>
  )
}

export function progressColour(done: number, total: number): string | undefined {
  if (!total) return undefined
  const ratio = Math.min(1, Math.max(0, done / total))
  const from = ratio < 0.5 ? 'var(--color-destructive)' : 'var(--color-warning)'
  const to = ratio < 0.5 ? 'var(--color-warning)' : 'var(--color-success)'
  return `color-mix(in oklab, color-mix(in oklab, ${from}, ${to} ${(ratio < 0.5 ? ratio * 2 : (ratio - 0.5) * 2) * 100}%), var(--color-card) 76%)`
}

function Progress({
  data,
  periodLabel,
  onOpen,
}: {
  data: CheckinBoard
  periodLabel: (s: string, e: string) => string
  onOpen: (cycle: string, member: string) => void
}) {
  const t = useT()
  const palette = createUnitPalette(data.units)
  const values = new Map(data.progress.map((p) => [`${p.cycleId}:${p.memberUserId}`, p]))
  return (
    <section className="checkin-progress">
      <div
        className="checkin-progress-scroll"
        // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- The named scroll region supports native arrow-key navigation.
        tabIndex={0}
        role="region"
        aria-label={t('checkins.progress')}
      >
        <table>
          <caption className="sr-only">{t('checkins.progressHint')}</caption>
          <thead>
            <tr>
              <th scope="col">{t('checkins.people')}</th>
              {data.cycles.map((c) => (
                <th scope="col" key={c.id}>
                  {periodLabel(c.startsOn, c.endsOn)}
                  <span className="mt-1 block text-caption font-normal text-muted-foreground">
                    {t(
                      c.checkoutLockedAt
                        ? 'checkins.closed'
                        : c.checkinLockedAt
                          ? 'checkins.agreed'
                          : 'checkins.draft',
                    )}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.members.map((m, index) => (
              <React.Fragment key={m.userId}>
                {index === 0 || m.unitId !== data.members[index - 1]?.unitId ? (
                  <tr className="checkin-unit-row">
                    <th scope="rowgroup">
                      <span
                        className={cn(
                          'mr-2 inline-block size-2 rounded-full',
                          unitColorClass(palette, m.unitId),
                        )}
                      />
                      {m.unitName ?? t('checkins.unassigned')}
                    </th>
                    <td colSpan={data.cycles.length} />
                  </tr>
                ) : null}
                <tr>
                  <th scope="row">
                    <div className="flex items-center gap-2">
                      <MemberAvatar member={m} />
                      <span>{name(m)}</span>
                    </div>
                  </th>
                  {data.cycles.map((c) => {
                    const value = values.get(`${c.id}:${m.userId}`),
                      done = value?.done ?? 0,
                      total = value?.total ?? 0
                    return (
                      <td key={c.id}>
                        <button
                          type="button"
                          className="checkin-progress-cell"
                          style={{ backgroundColor: progressColour(done, total) }}
                          onClick={() => onOpen(c.id, m.userId)}
                          aria-label={t('checkins.progressCell', {
                            name: name(m),
                            period: periodLabel(c.startsOn, c.endsOn),
                            done,
                            total,
                          })}
                        >
                          {total ? (
                            <>
                              <span className="font-semibold tabular-nums">
                                {done}
                                <span className="font-normal text-muted-foreground">
                                  {' '}
                                  / {total}
                                </span>
                              </span>
                              <span className="text-caption tabular-nums">
                                {Math.round((done / total) * 100)}%
                              </span>
                            </>
                          ) : (
                            <span className="text-muted-foreground" title={t('checkins.noItems')}>
                              —
                            </span>
                          )}
                        </button>
                      </td>
                    )
                  })}
                </tr>
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-center gap-3 px-4 py-3 text-caption text-muted-foreground">
        <span>{t('checkins.progressHint')}</span>
        <div className="ml-auto flex items-center gap-2">
          <span>0%</span>
          <span className="checkin-progress-legend" />
          <span>100%</span>
        </div>
      </div>
    </section>
  )
}

export default function CheckinScreen() {
  const t = useT(),
    locale = useLocale(),
    search = useSearchParams(),
    session = useSession(),
    { departmentId } = useDepartment()
  const cycleId = search.get('cycle') ?? undefined,
    memberId = search.get('member'),
    view = search.get('view') === 'progress' ? 'progress' : 'checkin'
  const query = useCheckins(cycleId),
    data = query.data
  function setParams(patch: Record<string, string>) {
    const next = new URLSearchParams(search)
    for (const [k, v] of Object.entries(patch)) next.set(k, v)
    navigate(`/analytics?${next}`, { replace: true })
  }
  const periodLabel = React.useCallback(
    (start: string, end: string) => {
      const format = new Intl.DateTimeFormat(locale === 'uz-Cyrl' ? 'uz' : locale, {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        timeZone: 'UTC',
      })
      return format.formatRange(new Date(`${start}T00:00:00Z`), new Date(`${end}T00:00:00Z`))
    },
    [locale],
  )
  if (!departmentId)
    return (
      <StateView
        kind="empty"
        titleKey="analytics.context.title"
        bodyKey="analytics.context.memberBody"
      />
    )
  if (query.isError)
    return (
      <StateView
        kind="error"
        titleKey="state.error.title"
        bodyKey="state.error.body"
        action={{ labelKey: 'state.error.action', onAction: () => query.refetch() }}
      />
    )
  if (!data) return <StateView kind="loading" titleKey="state.loading" />
  const selected =
    data.members.find((m) => m.userId === (memberId ?? session.user?.id)) ?? data.members[0]
  const palette = createUnitPalette(data.units)
  return (
    <Tabs value={view} onValueChange={(v) => setParams({ view: v })} className="checkins-page">
      <div className="checkins-toolbar">
        <TabsList aria-label={t('checkins.title')}>
          <TabsTrigger value="checkin">{t('checkins.title')}</TabsTrigger>
          <TabsTrigger value="progress">{t('checkins.progress')}</TabsTrigger>
        </TabsList>
        <select
          aria-label={t('checkins.period')}
          value={data.selectedCycleId}
          onChange={(e) => setParams({ cycle: e.target.value })}
          className="checkin-period-select"
        >
          {[...data.cycles].reverse().map((c) => (
            <option key={c.id} value={c.id}>
              {periodLabel(c.startsOn, c.endsOn)}
            </option>
          ))}
        </select>
      </div>
      <TabsContent value={view}>
        {view === 'progress' ? (
          <Progress
            data={data}
            periodLabel={periodLabel}
            onOpen={(cycle, member) => setParams({ view: 'checkin', cycle, member })}
          />
        ) : (
          <div className="checkins-layout">
            <nav className="checkin-members" aria-label={t('checkins.people')}>
              <label className="checkin-mobile-member text-small">
                {t('checkins.people')}
                <select
                  className="checkin-period-select"
                  value={selected?.userId ?? ''}
                  onChange={(e) => setParams({ member: e.target.value })}
                >
                  {data.members.map((m) => (
                    <option key={m.userId} value={m.userId}>
                      {name(m)}
                    </option>
                  ))}
                </select>
              </label>
              <div className="checkin-desktop-members">
                {data.members.map((m, index) => (
                  <React.Fragment key={m.userId}>
                    {index === 0 || m.unitId !== data.members[index - 1]?.unitId ? (
                      <h2 className="px-3 pb-2 pt-4 text-caption font-semibold text-muted-foreground">
                        {m.unitName ?? t('checkins.unassigned')}
                      </h2>
                    ) : null}
                    <button
                      className={cn(
                        'checkin-member',
                        selected?.userId === m.userId && 'is-selected',
                      )}
                      aria-current={selected?.userId === m.userId ? 'true' : undefined}
                      onClick={() => setParams({ member: m.userId })}
                    >
                      <span
                        aria-hidden="true"
                        className={cn('checkin-member-tint', unitColorClass(palette, m.unitId))}
                      />
                      <MemberAvatar member={m} />
                      <span className="relative min-w-0 break-words text-left">{name(m)}</span>
                    </button>
                  </React.Fragment>
                ))}
              </div>
            </nav>
            {selected ? (
              <PersonCheckin
                key={`${selected.userId}:${data.selectedCycleId}`}
                data={data}
                member={selected}
              />
            ) : (
              <StateView kind="empty" titleKey="checkins.noMembers" />
            )}
          </div>
        )}
      </TabsContent>
    </Tabs>
  )
}
