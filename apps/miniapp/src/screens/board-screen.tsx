// "Doska" -- the board peek. Two views behind the segmented control the web board uses
// ("Mening | Jamoa", v1.1 SPEC §3.3), because a phone cannot show 26 columns and should not try.
//
// "Mening" is the viewer's own column. "Jamoa" is the department summary: one row per person with
// their open / overdue / done-this-week counts, straight from the batched endpoint. A member sees it
// too -- SPEC §2.2 keeps department aggregates open to everyone and only gates the *person axis*
// screens (the people table, someone else's person page), which this is not: it is the same public
// board, counted.
import * as React from 'react'
import { AlertTriangle, ChevronRight } from 'lucide-react'
import { useT } from '@devon/i18n'
import {
  Badge,
  cn,
  SegmentedControl,
  strikethroughClass,
} from '@devon/ui'
import { getBoardPeek } from '../lib/api.js'
import { useQuery } from '../lib/use-query.js'
import { useSession } from '../lib/session.js'
import { navigate } from '../lib/router.js'
import {
  ListSkeleton,
  QueryState,
  ScreenBody,
  ScreenHeader,
  ScreenList,
} from '../components/screen.js'
import { DueChip, PriorityBadge, SectionLabel, personName, rowSurface } from '../components/bits.js'

type View = 'mine' | 'team'

export function BoardScreen(): React.ReactElement {
  const t = useT()
  const session = useSession()
  const query = useQuery(() => getBoardPeek(), [])
  const [view, setView] = React.useState<View>('mine')

  const peek = query.data
  const mine = peek?.mine ?? []
  const team = peek?.team ?? []

  return (
    <>
      <ScreenHeader
        title={t('miniapp.board.title')}
        eyebrow={session.department?.name ?? t('miniapp.noDepartment')}
      />
      <ScreenBody>
        <SegmentedControl
          className="mb-3 w-full"
          value={view}
          onValueChange={setView}
          label={t('miniapp.board.viewAria')}
          options={[
            { value: 'mine', label: t('miniapp.board.mine') },
            { value: 'team', label: t('miniapp.board.team') },
          ]}
        />

        {query.status === 'loading' && peek === null ? (
          <ListSkeleton rows={5} />
        ) : query.status === 'error' && peek === null ? (
          <QueryState error={query.error} onRetry={query.refetch} />
        ) : view === 'mine' ? (
          mine.length === 0 ? (
            <QueryState
              error={null}
              emptyTitleKey="miniapp.board.empty.title"
              emptyBodyKey="miniapp.board.empty.body"
              onRetry={query.refetch}
            />
          ) : (
            <>
              <SectionLabel count={mine.length}>{t('miniapp.board.myCards')}</SectionLabel>
              <ScreenList>
                {mine.map((card) => (
                  <button
                    key={card.id}
                    type="button"
                    onClick={() => navigate({ name: 'card', cardId: card.id })}
                    className={cn(rowSurface, 'flex flex-col gap-1.5')}
                  >
                    <span className="flex items-start gap-2">
                      <span
                        className={cn(
                          'min-w-0 flex-1 text-[14px] leading-5 font-medium text-foreground',
                          strikethroughClass(card.status === 'done'),
                        )}
                      >
                        {card.title}
                      </span>
                      <ChevronRight className="text-muted-foreground mt-0.5 size-4" aria-hidden />
                    </span>
                    <span className="flex flex-wrap items-center gap-1.5">
                      {card.status === 'done' ? (
                        <Badge tone="success">{t('miniapp.card.done')}</Badge>
                      ) : null}
                      <PriorityBadge priority={card.priority} />
                      <DueChip dueAt={card.dueAt} risk={card.risk} />
                      {card.projectTitle ? (
                        <span className="text-muted-foreground truncate text-[12px]">
                          {card.projectTitle}
                        </span>
                      ) : null}
                      {card.checklistTotal > 0 ? (
                        <span className="text-muted-foreground text-[12px] tabular-nums">
                          {card.checklistDone}/{card.checklistTotal}
                        </span>
                      ) : null}
                    </span>
                  </button>
                ))}
              </ScreenList>
            </>
          )
        ) : (
          <>
            <div className="border-border bg-card shadow-1 mb-3 flex gap-4 rounded-md border px-3 py-3">
              <div className="flex-1">
                <p className="text-muted-foreground text-[11px] tracking-[0.08em] uppercase">
                  {t('miniapp.board.openTotal')}
                </p>
                <p className="font-display text-[24px] leading-8 tabular-nums">
                  {peek?.departmentOpenCards ?? 0}
                </p>
              </div>
              <div className="flex-1">
                <p className="text-muted-foreground text-[11px] tracking-[0.08em] uppercase">
                  {t('miniapp.board.overdueTotal')}
                </p>
                <p
                  className={cn(
                    'font-display text-[24px] leading-8 tabular-nums',
                    (peek?.departmentOverdueCards ?? 0) > 0 ? 'text-destructive' : '',
                  )}
                >
                  {peek?.departmentOverdueCards ?? 0}
                </p>
              </div>
            </div>
            {team.length === 0 ? (
              <QueryState
                error={null}
                emptyTitleKey="miniapp.board.emptyTeam.title"
                emptyBodyKey="miniapp.board.emptyTeam.body"
                onRetry={query.refetch}
              />
            ) : (
              <ScreenList>
                {team.map((person) => (
                  <div key={person.userId} className={cn(rowSurface, 'flex items-center gap-3')}>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[14px] leading-5 font-medium">
                        {personName(person)}
                        {person.userId === session.user.id ? ` · ${t('miniapp.board.you')}` : ''}
                      </p>
                      <p className="text-muted-foreground truncate text-[12px] leading-4">
                        {[person.title, person.unitName].filter(Boolean).join(' · ') ||
                          t(`miniapp.role.${person.role}`)}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                      {person.overdueCards > 0 ? (
                        <Badge tone="destructive">
                          <AlertTriangle className="size-3" aria-hidden />
                          {t('miniapp.board.overdueCount', { count: person.overdueCards })}
                        </Badge>
                      ) : null}
                      <Badge tone="neutral">
                        {t('miniapp.board.openCount', { count: person.openCards })}
                      </Badge>
                    </div>
                  </div>
                ))}
              </ScreenList>
            )}
          </>
        )}
      </ScreenBody>
    </>
  )
}
