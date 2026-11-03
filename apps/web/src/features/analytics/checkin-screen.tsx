import { ViewSkeleton } from '../../lib/view-skeleton.js'
import type { CheckinBoard } from '@devon/contracts'
import { useLocale, useT } from '@devon/i18n'
import { StateView, Tabs, TabsList, TabsContent, TabsTrigger, cn } from '@devon/ui'
import * as React from 'react'
import { navigate, useSearchParams } from '../../lib/router.js'
import { useDepartment, useSession } from '../../lib/session.js'
import { createUnitPalette, unitColorClass } from '../../lib/unit-palette.js'
import { useViewportBoundedHeight } from '../../lib/use-viewport-bounded-height.js'
import { CardPeekDialog } from '../work/components/card-peek-dialog.js'
import { CheckinWorkspace } from './checkin-workspace.js'
import { MemberAvatar, memberName as name, CheckinMemberChooser } from './checkin-member.js'
import { useCheckins } from './checkins-api.js'
import { cycleLockState } from './checkin-locks.js'
import { progressPeriods } from './progress-periods.js'
import './checkins.css'

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
  const periods = React.useMemo(() => progressPeriods(data.cycles), [data.cycles])
  const selectedColumn = React.useRef<HTMLTableCellElement>(null)
  React.useEffect(() => {
    const column = selectedColumn.current
    const scroller = column?.closest('.checkin-progress-scroll')
    if (column && scroller) scroller.scrollLeft = Math.max(0, column.offsetLeft - 280)
  }, [data.selectedCycleId])
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
        <table
          style={{
            width: `calc(var(--progress-person-width) + ${periods.length} * var(--progress-period-width))`,
          }}
        >
          <colgroup>
            <col className="checkin-person-col" />
            {periods.map((p) => (
              <col key={p.id} className="checkin-period-col" />
            ))}
          </colgroup>
          <caption className="sr-only">{t('checkins.progressHint')}</caption>
          <thead>
            <tr>
              <th scope="col">{t('checkins.people')}</th>
              {periods.map((c) => (
                <th
                  scope="col"
                  key={c.id}
                  ref={c.id === data.selectedCycleId ? selectedColumn : undefined}
                  data-current={c.id === data.selectedCycleId}
                >
                  {periodLabel(c.startsOn, c.endsOn)}
                  <span className="mt-1 block text-caption font-normal text-muted-foreground">
                    {c.cycle ? t(`checkins.${cycleLockState(data, c.cycle)}`) : '\u00a0'}
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
                    {periods.map((c) => (
                      <td key={c.id} />
                    ))}
                  </tr>
                ) : null}
                <tr>
                  <th scope="row">
                    <div className="flex items-center gap-2">
                      <MemberAvatar member={m} />
                      <span>{name(m)}</span>
                    </div>
                  </th>
                  {periods.map((c) => {
                    const value = values.get(`${c.id}:${m.userId}`),
                      done = value?.done ?? 0,
                      total = value?.total ?? 0
                    return (
                      <td key={c.id}>
                        {c.cycle ? (
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
                        ) : (
                          <span
                            className="checkin-progress-future"
                            aria-label={t('checkins.noItems')}
                          />
                        )}
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
  const [viewportRef, viewportHeight] = useViewportBoundedHeight<HTMLDivElement>(360)
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
  if (!data) return <ViewSkeleton view="checkin" />
  const selected =
    data.members.find((m) => m.userId === (memberId ?? session.user?.id)) ?? data.members[0]
  return (
    <Tabs value={view} onValueChange={(v) => setParams({ view: v })} className="checkins-page">
      <div className="checkins-toolbar">
        <TabsList aria-label={t('checkins.title')}>
          <TabsTrigger value="checkin">{t('checkins.title')}</TabsTrigger>
          <TabsTrigger value="progress">{t('checkins.progress')}</TabsTrigger>
        </TabsList>
        <div className="checkins-choosers">
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
          {view === 'checkin' ? (
            <CheckinMemberChooser
              data={data}
              selected={selected}
              onChange={(member) => setParams({ member })}
            />
          ) : null}
        </div>
      </div>
      <TabsContent
        value={view}
        ref={viewportRef}
        className="checkins-content"
        style={{ '--checkins-height': `${viewportHeight ?? 640}px` } as React.CSSProperties}
      >
        {view === 'progress' ? (
          <Progress
            data={data}
            periodLabel={periodLabel}
            onOpen={(cycle, member) => setParams({ view: 'checkin', cycle, member })}
          />
        ) : (
          <div className="checkins-layout">
            {selected ? (
              <CheckinWorkspace
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
      <CardPeekDialog />
    </Tabs>
  )
}
