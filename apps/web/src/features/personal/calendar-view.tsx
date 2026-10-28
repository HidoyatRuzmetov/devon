import {
  personalCalendarListSchema,
  type PersonalCalendarInput,
  type PersonalCalendarItem,
} from '@devon/contracts'
import { useLocale, useT } from '@devon/i18n'
import {
  Button,
  Checkbox,
  Dialog,
  DialogContent,
  IconButton,
  Input,
  StateView,
  Textarea,
  cn,
  toast,
} from '@devon/ui'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Archive,
  Bell,
  CalendarDays,
  CheckSquare,
  ChevronLeft,
  ChevronRight,
  LockKeyhole,
  Plus,
  Trash2,
} from 'lucide-react'
import * as React from 'react'
import { z } from 'zod'
import { apiClient } from '../../lib/api-client.js'
import { RouterLink, navigate, replaceSearchParam, useSearchParams } from '../../lib/router.js'
import { useDepartment, useMeQuery } from '../../lib/session.js'
import { useViewportBoundedHeight } from '../../lib/use-viewport-bounded-height.js'

const TZ = 5 * 3600000,
  DAY = 86400000
const dayKey = (value: Date | string) =>
  new Date(new Date(value).getTime() + TZ).toISOString().slice(0, 10)
const localInput = (value: string) => new Date(Date.parse(value) + TZ).toISOString().slice(0, 16)
const utcInput = (value: string) => new Date(value + '+05:00').toISOString()
const tones = {
  personal: 'border-primary/25 bg-primary/8 text-primary',
  task: 'border-border bg-muted/60 text-foreground',
  event: 'border-info/25 bg-info/8 text-info-text',
}
const icons = { personal: LockKeyhole, task: CheckSquare, event: CalendarDays }

function CalendarEditor({
  item,
  date,
  onClose,
}: {
  item: PersonalCalendarItem | null
  date: string
  onClose: () => void
}) {
  const t = useT(),
    me = useMeQuery(),
    qc = useQueryClient()
  const [title, setTitle] = React.useState(item?.title ?? ''),
    [notes, setNotes] = React.useState(item?.notes ?? '')
  const [start, setStart] = React.useState(item ? localInput(item.startsAt) : date + 'T09:00')
  const [end, setEnd] = React.useState(item ? localInput(item.endsAt) : date + 'T10:00')
  const [allDay, setAllDay] = React.useState(item?.allDay ?? false)
  const [remind, setRemind] = React.useState(item?.remindAt ? localInput(item.remindAt) : '')
  const [confirmDelete, setConfirmDelete] = React.useState(false)
  const save = useMutation({
    mutationFn: async (remove: boolean) => {
      const csrf = me.data?.csrfToken ?? ''
      if (remove && item)
        return apiClient.delete(
          `/api/v1/personal/calendar/${item.id}?version=${item.version}`,
          csrf,
        )
      const body: PersonalCalendarInput = {
        title,
        notes,
        startsAt: utcInput(allDay ? start.slice(0, 10) + 'T00:00' : start),
        endsAt: utcInput(allDay ? end.slice(0, 10) + 'T23:59' : end),
        allDay,
        remindAt: remind ? utcInput(remind) : null,
      }
      const schema = z.object({ id: z.string().uuid() })
      return item
        ? apiClient.patch(
            `/api/v1/personal/calendar/${item.id}`,
            { version: item.version, entry: body },
            schema,
            csrf,
          )
        : apiClient.post('/api/v1/personal/calendar', body, schema, csrf)
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['personal', 'calendar'] })
      toast(t('personalCalendar.saved'))
      onClose()
    },
  })
  const valid =
    title.trim().length > 0 &&
    start &&
    end &&
    end >= start &&
    (!remind ||
      (remind <= start && Date.parse(utcInput(remind)) > Date.now()) ||
      (item?.remindAt && remind === localInput(item.remindAt)))
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !save.isPending) onClose()
      }}
    >
      <DialogContent title={t(item ? 'personalCalendar.edit' : 'personalCalendar.add')}>
        <form
          className="mt-4 flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            if (valid) save.mutate(false)
          }}
        >
          <label className="grid gap-1.5 text-small">
            <span>{t('personalCalendar.titleField')}</span>
            <Input
              autoFocus
              value={title}
              maxLength={160}
              required
              onChange={(e) => setTitle(e.target.value)}
            />
          </label>
          <label className="flex items-center gap-2 text-small">
            <Checkbox checked={allDay} onCheckedChange={(v) => setAllDay(v === true)} />
            {t('personalCalendar.allDay')}
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            {(
              [
                { value: start, set: setStart, label: 'start' },
                { value: end, set: setEnd, label: 'end' },
              ] as const
            ).map((field) => (
              <label key={field.label} className="grid gap-1.5 text-small">
                <span>{t(`personalCalendar.${field.label}`)}</span>
                <Input
                  type={allDay ? 'date' : 'datetime-local'}
                  required
                  value={allDay ? field.value.slice(0, 10) : field.value}
                  onChange={(e) => field.set(allDay ? e.target.value + 'T09:00' : e.target.value)}
                />
              </label>
            ))}
          </div>
          <label className="grid gap-1.5 text-small">
            <span>{t('personalCalendar.notes')}</span>
            <Textarea
              rows={3}
              maxLength={4000}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </label>
          <label className="grid gap-1.5 text-small">
            <span className="flex items-center gap-2">
              <Bell className="size-4" />
              {t('personalCalendar.reminder')}
            </span>
            <Input
              type="datetime-local"
              value={remind}
              max={start}
              onChange={(e) => setRemind(e.target.value)}
            />
          </label>
          <p className="text-caption text-muted-foreground">
            {t('personalCalendar.timezone')}
            {' · '}
            <RouterLink
              className="text-primary underline underline-offset-2"
              href="/account/telegram"
            >
              {t('personalCalendar.telegram')}
            </RouterLink>
          </p>
          {save.isError ? (
            <p role="alert" className="text-small text-destructive">
              {t('personalCalendar.error')}
            </p>
          ) : null}
          <div className="flex items-center justify-between gap-3 border-t border-border pt-3">
            {item ? (
              <Button
                type="button"
                variant={confirmDelete ? 'destructive' : 'ghost'}
                size="sm"
                disabled={save.isPending}
                onClick={() => (confirmDelete ? save.mutate(true) : setConfirmDelete(true))}
              >
                <Trash2 className="size-4" />
                {t(confirmDelete ? 'personalCalendar.confirmDelete' : 'personalCalendar.delete')}
              </Button>
            ) : (
              <span />
            )}
            <Button type="submit" disabled={!valid || save.isPending} loading={save.isPending}>
              {t('personalCalendar.save')}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export function PersonalCalendarView() {
  const t = useT(),
    locale = useLocale(),
    search = useSearchParams(),
    { departmentId } = useDepartment(),
    me = useMeQuery()
  const requested = search.get('month'),
    today = dayKey(new Date())
  const month =
    requested && /^\d{4}-(0[1-9]|1[0-2])$/.test(requested) ? requested : today.slice(0, 7)
  const start = new Date(month + '-01T00:00:00Z'),
    first = new Date(start.getTime() - ((start.getUTCDay() + 6) % 7) * DAY)
  const monthLength = new Date(
    Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0),
  ).getUTCDate()
  const weekCount = Math.ceil((((start.getUTCDay() + 6) % 7) + monthLength) / 7)
  const days = Array.from({ length: weekCount * 7 }, (_, i) =>
    new Date(first.getTime() + i * DAY).toISOString().slice(0, 10),
  )
  const from = days[0]!,
    to = new Date(first.getTime() + weekCount * 7 * DAY).toISOString().slice(0, 10)
  const [calendarRef, calendarHeight] = useViewportBoundedHeight<HTMLDivElement>(360)
  // Reserve the date and overflow action before allocating entry rows. Dense days open in a
  // dialog, so neither their content nor a six-week month can stretch the calendar grid.
  const entrySlots = Math.max(
    1,
    Math.min(4, Math.floor((((calendarHeight ?? 600) - 36) / weekCount - 44) / 32)),
  )
  const query = useQuery({
    queryKey: ['personal', 'calendar', me.data?.user?.id, departmentId, from, to],
    queryFn: () =>
      apiClient.get(`/api/v1/personal/calendar?from=${from}&to=${to}`, personalCalendarListSchema),
  })
  const [editor, setEditor] = React.useState<{
    item: PersonalCalendarItem | null
    date: string
  } | null>(null)
  const [chosenDay, setChosenDay] = React.useState(today)
  const mobileDay = chosenDay.slice(0, 7) === month ? chosenDay : month + '-01'
  const [expandedDay, setExpandedDay] = React.useState<string | null>(null)
  const consumed = React.useRef<string | null>(null)
  React.useEffect(() => {
    const entry = search.get('entry')
    if (!entry || entry === consumed.current || !query.data) return
    const item = query.data.find((row) => row.kind === 'personal' && row.id === entry)
    if (item) {
      consumed.current = entry
      setEditor({ item, date: dayKey(item.startsAt) })
    }
  }, [search, query.data])
  function move(delta: number) {
    const date = new Date(start)
    date.setUTCMonth(date.getUTCMonth() + delta)
    replaceSearchParam('month', date.toISOString().slice(0, 7))
  }
  function open(item: PersonalCalendarItem) {
    setExpandedDay(null)
    if (item.kind === 'personal') setEditor({ item, date: dayKey(item.startsAt) })
    else if (item.href) navigate(`${item.href}&month=${month}`)
  }
  const dateLabel = (day: string) =>
    new Intl.DateTimeFormat(locale, { dateStyle: 'long', timeZone: 'UTC' }).format(
      new Date(day + 'T12:00:00Z'),
    )
  function entries(day: string) {
    return (query.data ?? [])
      .filter((row) => dayKey(row.startsAt) <= day && dayKey(row.endsAt) >= day)
      .sort(
        (a, b) =>
          a.startsAt.localeCompare(b.startsAt) ||
          a.kind.localeCompare(b.kind) ||
          a.id.localeCompare(b.id),
      )
  }
  function itemRow(item: PersonalCalendarItem, compact = false) {
    const Icon = item.kind === 'task' && item.status === 'archived' ? Archive : icons[item.kind]
    return (
      <button
        key={item.kind + item.id}
        type="button"
        onClick={() => open(item)}
        title={item.title}
        className={cn(
          'flex w-full items-start gap-1.5 rounded-sm border px-2 text-left text-caption transition-colors hover:brightness-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          compact ? 'h-7 min-h-7 items-center py-0.5' : 'min-h-8 py-1.5',
          tones[item.kind],
        )}
      >
        <Icon className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
        <span className="min-w-0 flex-1">
          <span
            className={cn(
              compact ? 'block truncate' : 'line-clamp-2 [overflow-wrap:anywhere]',
              item.kind === 'task' && item.status === 'done' && 'line-through',
            )}
          >
            {item.title}
          </span>
          {!compact && !item.allDay ? (
            <span className="mt-0.5 block opacity-75">
              {new Intl.DateTimeFormat(locale, {
                hour: '2-digit',
                minute: '2-digit',
                timeZone: 'Asia/Tashkent',
              }).format(new Date(item.startsAt))}
            </span>
          ) : null}
          {!compact && item.kind === 'task' && item.status === 'archived' ? (
            <span className="block font-medium">{t('work.status.archived')}</span>
          ) : null}
          {!compact && item.status === 'waitlist' ? (
            <span className="block font-medium">{t('personalCalendar.waitlist')}</span>
          ) : null}
        </span>
      </button>
    )
  }
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <IconButton aria-label={t('personalCalendar.previous')} onClick={() => move(-1)}>
            <ChevronLeft />
          </IconButton>
          <h2 className="min-w-36 text-title font-semibold capitalize">
            {new Intl.DateTimeFormat(locale, {
              month: 'long',
              year: 'numeric',
              timeZone: 'UTC',
            }).format(start)}
          </h2>
          <IconButton aria-label={t('personalCalendar.next')} onClick={() => move(1)}>
            <ChevronRight />
          </IconButton>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => replaceSearchParam('month', today.slice(0, 7))}
          >
            {t('personalCalendar.today')}
          </Button>
        </div>
        <Button size="sm" onClick={() => setEditor({ item: null, date: today })}>
          <Plus className="size-4" />
          {t('personalCalendar.add')}
        </Button>
      </div>
      <div className="flex flex-wrap gap-x-5 gap-y-2 text-caption text-muted-foreground">
        {(['personal', 'task', 'event'] as const).map((kind) => {
          const Icon = icons[kind]
          return (
            <span key={kind} className="inline-flex items-center gap-1.5">
              <Icon className="size-3.5" />
              {t(`personalCalendar.kind.${kind === 'task' ? 'card' : kind}`)}
            </span>
          )
        })}
      </div>
      {query.isError ? (
        <StateView
          kind="error"
          titleKey="state.error.title"
          action={{ labelKey: 'state.error.action', onAction: () => void query.refetch() }}
        />
      ) : query.isPending ? (
        <StateView kind="loading" titleKey="state.loading" />
      ) : (
        <>
          <div
            ref={calendarRef}
            style={{ height: calendarHeight }}
            className="personal-calendar-month hidden flex-col overflow-hidden rounded-lg border border-border md:flex"
          >
            <div className="grid grid-cols-7 border-b border-border bg-muted/40">
              {days.slice(0, 7).map((day) => (
                <div key={day} className="px-3 py-2 text-caption font-medium text-muted-foreground">
                  {new Intl.DateTimeFormat(locale, { weekday: 'short', timeZone: 'UTC' }).format(
                    new Date(day + 'T12:00:00Z'),
                  )}
                </div>
              ))}
            </div>
            <div
              style={{ gridTemplateRows: `repeat(${weekCount}, minmax(0, 1fr))` }}
              className="grid min-h-0 flex-1 grid-cols-7 gap-px bg-border"
            >
              {days.map((day) => {
                const items = entries(day)
                const visibleEntries = items.length > entrySlots ? entrySlots - 1 : entrySlots
                return (
                  <div
                    key={day}
                    className={cn(
                      'group relative isolate flex min-h-0 min-w-0 flex-col gap-1 bg-card p-1.5',
                      day.slice(0, 7) !== month && 'bg-muted/50',
                    )}
                  >
                    <button
                      type="button"
                      aria-label={t('personalCalendar.addOn', { date: dateLabel(day) })}
                      onClick={() => setEditor({ item: null, date: day })}
                      className="absolute inset-0 z-0 flex items-start justify-between rounded-none p-2 hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                    >
                      <span
                        className={cn(
                          'inline-flex size-6 items-center justify-center rounded-full text-caption',
                          day === today
                            ? 'bg-primary font-semibold text-primary-foreground'
                            : 'text-muted-foreground',
                        )}
                      >
                        {Number(day.slice(-2))}
                      </span>
                      <Plus className="size-3.5 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" />
                    </button>
                    <div className="pointer-events-none relative z-10 mt-7 flex flex-col gap-1 [&>button]:pointer-events-auto">
                      {items.slice(0, visibleEntries).map((item) => itemRow(item, true))}
                    </div>
                    {items.length > visibleEntries ? (
                      <button
                        type="button"
                        onClick={() => setExpandedDay(day)}
                        className="relative z-10 mt-auto min-h-6 text-left text-caption font-medium text-primary"
                      >
                        {t('personalCalendar.more', { count: items.length - visibleEntries })}
                      </button>
                    ) : null}
                  </div>
                )
              })}
            </div>
          </div>
          <div className="flex flex-col gap-4 md:hidden">
            <div className="grid grid-cols-7 gap-1 rounded-lg border border-border bg-card p-2">
              {days.map((day) => (
                <button
                  type="button"
                  key={day}
                  aria-label={dateLabel(day)}
                  aria-pressed={day === mobileDay}
                  onClick={() => {
                    setChosenDay(day)
                    if (day.slice(0, 7) !== month) replaceSearchParam('month', day.slice(0, 7))
                  }}
                  className={cn(
                    'flex min-h-11 flex-col items-center justify-center gap-1 rounded-md text-small focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    day === mobileDay
                      ? 'bg-primary text-primary-foreground'
                      : day.slice(0, 7) !== month
                        ? 'text-muted-foreground/50'
                        : 'hover:bg-primary/5',
                  )}
                >
                  {Number(day.slice(-2))}
                  <span
                    className={cn(
                      'size-1 rounded-full',
                      entries(day).length ? 'bg-current' : 'bg-transparent',
                    )}
                  />
                </button>
              ))}
            </div>
            <section className="rounded-lg border border-border bg-card p-4">
              <div className="mb-3 flex items-center justify-between gap-2">
                <h3 className="text-small font-semibold">{dateLabel(mobileDay)}</h3>
                <IconButton
                  aria-label={t('personalCalendar.addOn', { date: dateLabel(mobileDay) })}
                  onClick={() => setEditor({ item: null, date: mobileDay })}
                >
                  <Plus />
                </IconButton>
              </div>
              <div className="flex flex-col gap-2">
                {entries(mobileDay).map((item) => itemRow(item))}
                {!entries(mobileDay).length ? (
                  <p className="py-3 text-small text-muted-foreground">
                    {t('personalCalendar.free')}
                  </p>
                ) : null}
              </div>
            </section>
          </div>
        </>
      )}
      {editor ? (
        <CalendarEditor
          key={editor.item?.id ?? editor.date}
          {...editor}
          onClose={() => setEditor(null)}
        />
      ) : null}
      <Dialog
        open={expandedDay !== null}
        onOpenChange={(open) => {
          if (!open) setExpandedDay(null)
        }}
      >
        <DialogContent title={expandedDay ? dateLabel(expandedDay) : ''}>
          <div className="mt-4 flex max-h-[60dvh] flex-col gap-2 overflow-y-auto">
            {expandedDay ? entries(expandedDay).map((item) => itemRow(item)) : null}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
