// v1.1 SPEC §7.4 -- "remind me at" on a card. The reminder lands in the inbox and, for anyone who
// linked their Telegram account, as a bot message.
//
// Deliberately personal: a reminder is *yours*, never something one person sets on another's behalf
// (that is what assigning and a due date are for). The server scopes every row to its creator, so
// this panel only ever shows your own.
import * as React from 'react'
import { BellRing, Check, Loader2, Trash2 } from 'lucide-react'
import { useT, useLocale, formatDateTime } from '@devon/i18n'
import {
  Button,
  Chip,
  IconButton,
  Input,
  Skeleton,
  Stagger,
  StaggerItem,
  StateView,
  toast,
} from '@devon/ui'
import {
  useAddReminderMutation,
  useCardRemindersQuery,
  useDeleteReminderMutation,
} from '../hooks-plus.js'

/** `<input type="datetime-local">` speaks local wall-clock with no zone; the API wants an instant.
 * `new Date(value)` parses the string in the browser's own zone, which is the zone the person just
 * typed in -- exactly the conversion wanted. */
function localInputToIso(value: string): string | null {
  if (!value) return null
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return null
  return parsed.toISOString()
}

/** A sensible default: tomorrow at 09:00 local, formatted for `datetime-local`. Reaching for a
 * reminder almost always means "not now, but soon" -- an empty field would make everyone type the
 * same thing. */
function defaultRemindAt(): string {
  const date = new Date()
  date.setDate(date.getDate() + 1)
  date.setHours(9, 0, 0, 0)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

export interface RemindersPanelProps {
  cardId: string
}

export function RemindersPanel({ cardId }: RemindersPanelProps): React.JSX.Element {
  const t = useT()
  const locale = useLocale()
  const query = useCardRemindersQuery(cardId)
  const addReminder = useAddReminderMutation(cardId)
  const deleteReminder = useDeleteReminderMutation(cardId)

  const [when, setWhen] = React.useState(defaultRemindAt)
  const [note, setNote] = React.useState('')
  const [pendingDelete, setPendingDelete] = React.useState<string | null>(null)

  const iso = localInputToIso(when)
  const inPast = iso !== null && new Date(iso).getTime() <= Date.now()
  const canSubmit = iso !== null && !inPast && !addReminder.isPending

  function submit(e: React.FormEvent): void {
    e.preventDefault()
    if (!canSubmit || iso === null) return
    addReminder.mutate(
      { remindAt: iso, ...(note.trim() ? { note: note.trim() } : {}) },
      {
        onSuccess: () => {
          setNote((current) => (current === note ? '' : current))
          setWhen((current) => (current === when ? defaultRemindAt() : current))
          toast.success(t('work.reminders.added'))
        },
        onError: () => toast.error(t('work.reminders.addFailed')),
      },
    )
  }

  if (query.isPending) {
    return (
      <div className="flex flex-col gap-2" aria-busy="true">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-8 w-2/3" />
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

  const reminders = query.data

  return (
    <div className="flex flex-col gap-3">
      <form onSubmit={submit} className="flex flex-wrap items-end gap-2">
        <div className="flex min-w-0 grow basis-[12rem] flex-col gap-1">
          <label
            htmlFor={`reminder-when-${cardId}`}
            className="text-caption font-medium text-foreground"
          >
            {t('work.reminders.whenLabel')}
          </label>
          <Input
            id={`reminder-when-${cardId}`}
            type="datetime-local"
            value={when}
            invalid={inPast}
            onChange={(e) => setWhen(e.target.value)}
          />
        </div>
        <div className="flex min-w-0 grow basis-[10rem] flex-col gap-1">
          <label
            htmlFor={`reminder-note-${cardId}`}
            className="text-caption font-medium text-foreground"
          >
            {t('work.reminders.noteLabel')}
          </label>
          <Input
            id={`reminder-note-${cardId}`}
            value={note}
            maxLength={300}
            onChange={(e) => setNote(e.target.value)}
            placeholder={t('work.reminders.notePlaceholder')}
          />
        </div>
        <Button type="submit" disabled={!canSubmit} className="shrink-0">
          {addReminder.isPending ? (
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          ) : (
            <BellRing className="size-4" aria-hidden="true" />
          )}
          {t('work.reminders.add')}
        </Button>
      </form>
      <p aria-live="polite" className="text-caption text-muted-foreground">
        {inPast ? t('work.reminders.inPast') : t('work.reminders.hint')}
      </p>

      {reminders.length === 0 ? (
        <p className="text-caption text-muted-foreground">{t('work.reminders.empty')}</p>
      ) : (
        <Stagger
          presence
          className="flex flex-col gap-1"
          animateKey={`reminders-${reminders.length}`}
        >
          {reminders.map((reminder) => (
            <StaggerItem key={reminder.id} exit="hidden" layout>
              <div className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-x-2 gap-y-1 rounded-md border border-border bg-card px-3 py-2">
                <BellRing className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <span className="min-w-0 text-small tabular-nums text-foreground [overflow-wrap:anywhere]">
                    {formatDateTime(new Date(reminder.remindAt), locale)}
                  </span>
                  {reminder.sentAt ? (
                    <Chip
                      tone="neutral"
                      leading={<Check className="size-3" />}
                      className="text-muted-foreground"
                    >
                      {t('work.reminders.sent')}
                    </Chip>
                  ) : (
                    <Chip tone="outline">{t('work.reminders.pending')}</Chip>
                  )}
                </div>
                <IconButton
                  aria-label={t('work.reminders.delete')}
                  disabled={pendingDelete === reminder.id}
                  onClick={() => {
                    setPendingDelete(reminder.id)
                    deleteReminder.mutate(reminder.id, {
                      onSettled: () => setPendingDelete(null),
                      onError: () => toast.error(t('work.reminders.deleteFailed')),
                    })
                  }}
                  className="shrink-0"
                >
                  {pendingDelete === reminder.id ? (
                    <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                  ) : (
                    <Trash2 className="size-4" aria-hidden="true" />
                  )}
                </IconButton>
                {reminder.note ? (
                  <span className="col-start-2 min-w-0 text-caption text-muted-foreground [overflow-wrap:anywhere]">
                    {reminder.note}
                  </span>
                ) : null}
              </div>
            </StaggerItem>
          ))}
        </Stagger>
      )}
    </div>
  )
}
