// v1.1 SPEC §7 (A3) -- the light time log: estimate, logged, remaining.
//
// "Light" is the whole design. There is no timer to forget to stop and no per-day grid to fill in;
// there is one line that says how long something took, typed in the same natural language the
// estimate field accepts. CLICKUP-RESEARCH §3 is blunt about why: time tracking that demands more
// than this is the first feature a department abandons, and an abandoned tracker makes the workload
// view lie.
import * as React from 'react'
import { Loader2, Plus, Trash2 } from 'lucide-react'
import { MAX_TIME_LOG_MINUTES, parseEstimateMinutes } from '@devon/contracts'
import { useT, useLocale, formatDate } from '@devon/i18n'
import {
  Button,
  IconButton,
  Input,
  Progress,
  Skeleton,
  Stagger,
  StaggerItem,
  StateView,
  cn,
  toast,
} from '@devon/ui'
import { useSession } from '../../../lib/session.js'
import {
  useAddTimeLogMutation,
  useCardTimeLogQuery,
  useDeleteTimeLogMutation,
} from '../hooks-plus.js'
import { formatDuration } from '../lib/estimate.js'
import { shortName } from '../lib/format.js'
import type { MemberSummary } from '../api.js'

function Stat({
  label,
  value,
  tone = 'default',
}: {
  label: string
  value: string
  tone?: 'default' | 'over'
}): React.JSX.Element {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-caption text-muted-foreground">{label}</span>
      <span
        className={cn(
          'text-small font-semibold tabular-nums',
          tone === 'over' ? 'text-destructive' : 'text-foreground',
        )}
      >
        {value}
      </span>
    </div>
  )
}

export interface TimeLogPanelProps {
  cardId: string
  canEdit: boolean
  members: readonly MemberSummary[]
}

export function TimeLogPanel({ cardId, canEdit, members }: TimeLogPanelProps): React.JSX.Element {
  const t = useT()
  const locale = useLocale()
  const { user } = useSession()
  const query = useCardTimeLogQuery(cardId)
  const addTimeLog = useAddTimeLogMutation(cardId)
  const deleteTimeLog = useDeleteTimeLogMutation(cardId)

  const [draft, setDraft] = React.useState('')
  const [note, setNote] = React.useState('')
  const [pendingDelete, setPendingDelete] = React.useState<string | null>(null)

  const trimmed = draft.trim()
  const parsed = trimmed === '' ? null : parseEstimateMinutes(trimmed)
  const tooLong = parsed !== null && parsed > MAX_TIME_LOG_MINUTES
  const unreadable = trimmed !== '' && parsed === null
  const canSubmit = parsed !== null && !tooLong && !addTimeLog.isPending

  function submit(e: React.FormEvent): void {
    e.preventDefault()
    if (!canSubmit || parsed === null) return
    addTimeLog.mutate(
      { minutes: parsed, ...(note.trim() ? { note: note.trim() } : {}) },
      {
        onSuccess: () => {
          setDraft('')
          setNote('')
          toast.success(t('work.timeLog.added', { value: formatDuration(parsed, t) }))
        },
        onError: () => toast.error(t('work.timeLog.addFailed')),
      },
    )
  }

  if (query.isPending) {
    return (
      <div className="flex flex-col gap-2" aria-busy="true">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-8 w-3/4" />
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

  const log = query.data
  const { estimateMin, loggedMin, remainingMin, entries } = log
  // Only meaningful against an estimate -- a bar with no estimate behind it would be a made-up
  // number, which is exactly what `remainingMin: null` says.
  const ratio = estimateMin && estimateMin > 0 ? Math.min(1, loggedMin / estimateMin) : null
  const over = estimateMin !== null && estimateMin > 0 && loggedMin > estimateMin

  function nameFor(userId: string): string {
    const member = members.find((m) => m.userId === userId)
    return member ? shortName(member) : t('work.timeLog.someone')
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-6">
        <Stat
          label={t('work.timeLog.estimate')}
          value={estimateMin ? formatDuration(estimateMin, t) : t('work.timeLog.noEstimate')}
        />
        <Stat
          label={t('work.timeLog.logged')}
          value={loggedMin > 0 ? formatDuration(loggedMin, t) : t('work.timeLog.nothingLogged')}
        />
        <Stat
          label={t('work.timeLog.remaining')}
          value={
            remainingMin === null
              ? t('work.timeLog.noEstimate')
              : over
                ? t('work.timeLog.over', {
                    value: formatDuration(loggedMin - (estimateMin ?? 0), t),
                  })
                : formatDuration(remainingMin, t)
          }
          tone={over ? 'over' : 'default'}
        />
      </div>

      {ratio !== null ? (
        <Progress
          value={Math.round(ratio * 100)}
          label={t('work.timeLog.progressLabel')}
          tone={over ? 'destructive' : 'primary'}
        />
      ) : null}

      {canEdit ? (
        <form onSubmit={submit} className="flex flex-col gap-2">
          <div className="flex flex-wrap items-start gap-2">
            <div className="flex min-w-[10rem] flex-1 flex-col gap-1">
              <label htmlFor={`time-log-${cardId}`} className="sr-only">
                {t('work.timeLog.inputLabel')}
              </label>
              <Input
                id={`time-log-${cardId}`}
                value={draft}
                invalid={unreadable || tooLong}
                onChange={(e) => setDraft(e.target.value)}
                placeholder={t('work.timeLog.inputPlaceholder')}
              />
            </div>
            <div className="flex min-w-[10rem] flex-1 flex-col gap-1">
              <label htmlFor={`time-log-note-${cardId}`} className="sr-only">
                {t('work.timeLog.noteLabel')}
              </label>
              <Input
                id={`time-log-note-${cardId}`}
                value={note}
                maxLength={300}
                onChange={(e) => setNote(e.target.value)}
                placeholder={t('work.timeLog.notePlaceholder')}
              />
            </div>
            <Button type="submit" disabled={!canSubmit} className="shrink-0">
              {addTimeLog.isPending ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : (
                <Plus className="size-4" aria-hidden="true" />
              )}
              {t('work.timeLog.add')}
            </Button>
          </div>
          <p
            aria-live="polite"
            className={cn(
              'text-caption',
              unreadable || tooLong ? 'text-destructive' : 'text-muted-foreground',
            )}
          >
            {unreadable
              ? t('work.timeLog.unreadable')
              : tooLong
                ? t('work.timeLog.tooLong')
                : parsed !== null
                  ? t('work.timeLog.understood', { value: formatDuration(parsed, t) })
                  : t('work.timeLog.hint')}
          </p>
        </form>
      ) : null}

      {entries.length === 0 ? (
        <p className="text-caption text-muted-foreground">{t('work.timeLog.empty')}</p>
      ) : (
        <Stagger presence className="flex flex-col gap-1" animateKey={`log-${entries.length}`}>
          {entries.map((entry) => {
            const mine = entry.userId === user?.id
            return (
              <StaggerItem key={entry.id} exit="hidden" layout>
                <div className="flex items-center gap-2 rounded-md px-2 py-1.5 text-small hover:bg-muted/60">
                  <span className="w-24 shrink-0 font-medium tabular-nums text-foreground">
                    {formatDuration(entry.minutes, t)}
                  </span>
                  <span className="shrink-0 text-caption text-muted-foreground">
                    {nameFor(entry.userId)}
                  </span>
                  <span className="shrink-0 text-caption text-muted-foreground">
                    {formatDate(new Date(entry.spentOn), locale)}
                  </span>
                  {entry.note ? (
                    <span className="min-w-0 flex-1 truncate text-caption text-muted-foreground">
                      {entry.note}
                    </span>
                  ) : (
                    <span className="flex-1" />
                  )}
                  {/* Only your own line -- the server enforces the same rule, this only hides
                      a control that would always be refused. */}
                  {mine ? (
                    <IconButton
                      aria-label={t('work.timeLog.delete')}
                      disabled={pendingDelete === entry.id}
                      onClick={() => {
                        setPendingDelete(entry.id)
                        deleteTimeLog.mutate(entry.id, {
                          onSettled: () => setPendingDelete(null),
                          onError: () => toast.error(t('work.timeLog.deleteFailed')),
                        })
                      }}
                      className="shrink-0"
                    >
                      {pendingDelete === entry.id ? (
                        <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                      ) : (
                        <Trash2 className="size-4" aria-hidden="true" />
                      )}
                    </IconButton>
                  ) : null}
                </div>
              </StaggerItem>
            )
          })}
        </Stagger>
      )}
    </div>
  )
}
