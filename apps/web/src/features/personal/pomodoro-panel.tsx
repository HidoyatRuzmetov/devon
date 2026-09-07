// The Pomodoro tab (TECH-SPEC §3.3, UI-OVERHAUL.md "Personal workspace": "Pomodoro ring with big
// time and one button"): the big animated ring in the phase's own colour, one primary button, cycle
// dots, a quick sound mute toggle, settings behind a sheet, then stats and the session log.
//
// The live countdown and the *automatic* phase-end handling (recording the session, sound,
// notification, auto-advance) live only in `pomodoro-widget.tsx`'s effect -- it is mounted
// unconditionally at the top of every tab (`personal-screen.tsx`), so it is always present alongside
// this panel and is this feature's single source of truth for "what happens when a phase ends".
// Duplicating that effect here would double-fire it (two components, two `handledEndRef`s, the same
// tick) -- this panel only ever reacts to explicit clicks (start/pause/resume/skip/stop), exactly
// like the widget's own buttons do.
import * as React from 'react'
import { useT, useLocale, formatDate, formatNumber } from '@devon/i18n'
import {
  Flame,
  ListChecks,
  Pause,
  Play,
  Settings2,
  SkipForward,
  Square,
  Timer,
  Volume2,
  VolumeX,
} from 'lucide-react'
import {
  Badge,
  Button,
  IconButton,
  KpiTile,
  ProgressRing,
  Separator,
  Sheet,
  SheetContent,
  SheetTrigger,
  StateView,
  cn,
  toast,
} from '@devon/ui'
import {
  PHASE_RING_TONE,
  attachSessionId,
  pause as pauseEngine,
  phaseDurationMs,
  phaseToKind,
  remainingMs,
  requestNotificationPermission,
  resume as resumeEngine,
  startPhase,
  stopToIdle,
  usePomodoroState,
  type PomodoroPhase,
} from './pomodoro-engine.js'
import {
  useCreatePomodoroSessionMutation,
  usePatchPomodoroSessionMutation,
  usePatchPomodoroSettingsMutation,
  usePomodoroSessionsQuery,
  usePomodoroSettingsQuery,
  usePomodoroStatsQuery,
} from './use-personal.js'
import { groupSessionsByDay, relativeDayLabelKey, sessionDurationMin } from './lib/pomodoro-log.js'
import type { PomodoroKind, PomodoroSession, PomodoroSettings } from './types.js'

const SOUNDS: PomodoroSettings['sound'][] = ['chime', 'bell', 'digital', 'none']

const PHASE_LABEL_KEY: Record<PomodoroPhase, string> = {
  idle: 'personal.pomodoro.phase.idle',
  focus: 'personal.pomodoro.phase.focus',
  short_break: 'personal.pomodoro.phase.shortBreak',
  long_break: 'personal.pomodoro.phase.longBreak',
}

function formatCountdown(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000))
  const m = Math.floor(totalSeconds / 60)
  const s = totalSeconds % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

function formatClock(iso: string): string {
  const d = new Date(iso)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function SettingsSheet({ settings }: { settings: PomodoroSettings }) {
  const t = useT()
  const patchSettings = usePatchPomodoroSettingsMutation()
  const [draft, setDraft] = React.useState(settings)
  React.useEffect(() => setDraft(settings), [settings])

  function save(patch: Partial<PomodoroSettings>) {
    const next = { ...draft, ...patch }
    setDraft(next)
    patchSettings.mutate(patch, { onError: () => toast(t('toast.saveError')) })
  }

  return (
    <Sheet direction="right">
      <SheetTrigger asChild>
        <IconButton aria-label={t('personal.pomodoro.settings.title')}>
          <Settings2 className="size-4" aria-hidden="true" />
        </IconButton>
      </SheetTrigger>
      <SheetContent
        title={t('personal.pomodoro.settings.title')}
        side="right"
        className="gap-6 p-5"
      >
        <h2 className="font-display text-h3 text-foreground">
          {t('personal.pomodoro.settings.title')}
        </h2>
        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto">
          <div className="grid grid-cols-2 gap-4">
            <NumberField
              label={t('personal.pomodoro.settings.focusMin')}
              value={draft.focusMin}
              min={1}
              max={180}
              onCommit={(v) => save({ focusMin: v })}
            />
            <NumberField
              label={t('personal.pomodoro.settings.shortBreakMin')}
              value={draft.shortBreakMin}
              min={1}
              max={60}
              onCommit={(v) => save({ shortBreakMin: v })}
            />
            <NumberField
              label={t('personal.pomodoro.settings.longBreakMin')}
              value={draft.longBreakMin}
              min={1}
              max={120}
              onCommit={(v) => save({ longBreakMin: v })}
            />
            <NumberField
              label={t('personal.pomodoro.settings.cyclesBeforeLong')}
              value={draft.cyclesBeforeLong}
              min={1}
              max={20}
              onCommit={(v) => save({ cyclesBeforeLong: v })}
            />
          </div>

          <div className="flex flex-col gap-2">
            <span className="text-small font-medium text-foreground">
              {t('personal.pomodoro.settings.sound')}
            </span>
            <div className="flex flex-wrap gap-2">
              {SOUNDS.map((sound) => (
                <Button
                  key={sound}
                  type="button"
                  size="sm"
                  variant={draft.sound === sound ? 'primary' : 'secondary'}
                  onClick={() => save({ sound })}
                >
                  {t(`personal.pomodoro.sound.${sound}`)}
                </Button>
              ))}
            </div>
          </div>

          <label className="flex items-center gap-2 text-body text-foreground">
            <input
              type="checkbox"
              checked={draft.notifications}
              onChange={(e) => save({ notifications: e.target.checked })}
              className="size-4 rounded-sm border-border"
            />
            {t('personal.pomodoro.settings.notifications')}
          </label>
          <label className="flex items-center gap-2 text-body text-foreground">
            <input
              type="checkbox"
              checked={draft.autoStart}
              onChange={(e) => save({ autoStart: e.target.checked })}
              className="size-4 rounded-sm border-border"
            />
            {t('personal.pomodoro.settings.autoStart')}
          </label>
        </div>
      </SheetContent>
    </Sheet>
  )
}

export function PomodoroPanel() {
  const t = useT()
  const locale = useLocale()
  const settingsQuery = usePomodoroSettingsQuery()
  const sessionsQuery = usePomodoroSessionsQuery()
  const statsQuery = usePomodoroStatsQuery()
  const patchSettings = usePatchPomodoroSettingsMutation()
  const createSession = useCreatePomodoroSessionMutation()
  const patchSession = usePatchPomodoroSessionMutation()
  const state = usePomodoroState()
  const lastSoundRef = React.useRef<PomodoroSettings['sound']>('chime')

  if (settingsQuery.isPending) return <StateView kind="loading" titleKey="state.loading" />
  if (settingsQuery.isError) {
    return (
      <StateView
        kind="error"
        titleKey="state.error.title"
        bodyKey="state.error.body"
        action={{ labelKey: 'state.error.action', onAction: () => settingsQuery.refetch() }}
      />
    )
  }
  const settings = settingsQuery.data
  const stats = statsQuery.data
  if (settings.sound !== 'none') lastSoundRef.current = settings.sound

  const running = state.phase !== 'idle'
  const paused = running && state.remainingAtPause !== null
  const remaining = remainingMs()
  const total = running
    ? phaseDurationMs(state.phase as Exclude<PomodoroPhase, 'idle'>, settings)
    : 0
  const ringValue = running && total > 0 ? 100 - (remaining / total) * 100 : 0
  const displayMs = running ? remaining : settings.focusMin * 60_000

  function start(kind: 'focus' | 'short_break' | 'long_break') {
    startPhase(kind, settings)
    requestNotificationPermission()
    createSession.mutate(
      { kind: phaseToKind(kind), startedAt: new Date().toISOString() },
      { onSuccess: (row) => attachSessionId(row.id) },
    )
  }

  function skip() {
    if (state.phase === 'idle') return
    if (state.sessionId) {
      patchSession.mutate({
        id: state.sessionId,
        input: { completed: false, endedAt: new Date().toISOString() },
      })
    }
    stopToIdle()
  }

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col items-center gap-4 rounded-md border border-border bg-card py-10">
        <div className="flex w-full items-center justify-end px-5">
          <IconButton
            aria-label={t(
              settings.sound === 'none'
                ? 'personal.pomodoro.sound.muteOff'
                : 'personal.pomodoro.sound.muteOn',
            )}
            onClick={() =>
              patchSettings.mutate({
                sound: settings.sound === 'none' ? lastSoundRef.current : 'none',
              })
            }
          >
            {settings.sound === 'none' ? (
              <VolumeX className="size-4" aria-hidden="true" />
            ) : (
              <Volume2 className="size-4" aria-hidden="true" />
            )}
          </IconButton>
          <SettingsSheet settings={settings} />
        </div>

        <ProgressRing
          value={ringValue}
          size={220}
          strokeWidth={10}
          label={t(PHASE_LABEL_KEY[state.phase])}
          toneClassName={PHASE_RING_TONE[state.phase]}
        >
          <div className="flex flex-col items-center gap-1">
            <span className="font-display text-h1 tabular-nums text-foreground">
              {formatCountdown(displayMs)}
            </span>
            <span className="text-eyebrow uppercase tracking-(--text-eyebrow--letter-spacing) text-muted-foreground">
              {t(PHASE_LABEL_KEY[state.phase])}
            </span>
          </div>
        </ProgressRing>

        <div className="flex items-center gap-1.5" aria-hidden="true">
          {Array.from({ length: settings.cyclesBeforeLong }).map((_, i) => (
            <span
              key={i}
              className={cn(
                'size-2 rounded-full transition-colors duration-(--dur-standard)',
                i < state.cycleIndex || (i === state.cycleIndex && state.phase === 'focus')
                  ? 'bg-primary'
                  : 'bg-muted',
              )}
            />
          ))}
        </div>

        <div className="flex items-center gap-3">
          {!running ? (
            <Button size="lg" onClick={() => start('focus')}>
              <Play className="size-5" aria-hidden="true" />
              {t('personal.pomodoro.action.startFocus')}
            </Button>
          ) : (
            <>
              {paused ? (
                <Button size="lg" onClick={resumeEngine}>
                  <Play className="size-5" aria-hidden="true" />
                  {t('personal.pomodoro.action.resume')}
                </Button>
              ) : (
                <Button size="lg" variant="secondary" onClick={pauseEngine}>
                  <Pause className="size-5" aria-hidden="true" />
                  {t('personal.pomodoro.action.pause')}
                </Button>
              )}
              <IconButton
                aria-label={t('personal.pomodoro.action.skip')}
                onClick={skip}
                size="touch"
              >
                <SkipForward className="size-5" aria-hidden="true" />
              </IconButton>
              <IconButton
                aria-label={t('personal.pomodoro.action.stop')}
                onClick={skip}
                size="touch"
              >
                <Square className="size-5" aria-hidden="true" />
              </IconButton>
            </>
          )}
        </div>

        {!running ? (
          <Button size="sm" variant="ghost" onClick={() => start('short_break')}>
            {t('personal.pomodoro.action.startShortBreak')}
          </Button>
        ) : null}
      </div>

      {stats ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <KpiTile
            label={t('personal.pomodoro.stats.todayFocus')}
            value={stats.today.focusMinutes}
            locale={locale}
            suffix={` ${t('personal.pomodoro.stats.minutesShort')}`}
          />
          <KpiTile
            label={t('personal.pomodoro.stats.todaySessions')}
            value={stats.today.focusSessions}
            locale={locale}
          />
          <KpiTile
            label={t('personal.pomodoro.stats.weekFocus')}
            value={stats.week.focusMinutes}
            locale={locale}
            suffix={` ${t('personal.pomodoro.stats.minutesShort')}`}
          />
          <KpiTile
            label={t('personal.pomodoro.stats.weekSessions')}
            value={stats.week.focusSessions}
            locale={locale}
          />
        </div>
      ) : null}

      <Separator />

      <SessionLog
        sessions={sessionsQuery.data}
        isPending={sessionsQuery.isPending}
        locale={locale}
      />
    </div>
  )
}

const PHASE_KIND_LABEL_KEY: Record<PomodoroKind, string> = {
  focus: 'personal.pomodoro.phase.focus',
  short_break: 'personal.pomodoro.phase.shortBreak',
  long_break: 'personal.pomodoro.phase.longBreak',
}

const DAY_GROUPS_COLLAPSED = 3

/** Package report item 40: the flat 13-row list read as the same handful of clock times repeating
 * with no day separator ("09:00 - 09:30" on Monday looks identical to "09:00 - 09:30" on Tuesday).
 * Grouped by calendar day with a relative heading (Bugun/Kecha/date) instead, each row keeping its
 * focus-vs-break label and clock range but adding the session's actual duration, and the
 * completed/skipped indicator now a tinted pill (item 14) rather than plain coloured text. Only the
 * most recent `DAY_GROUPS_COLLAPSED` days show by default, consistent with the critique's own
 * "show only the last three days with a 'show more'". */
function SessionLog({
  sessions,
  isPending,
  locale,
}: {
  sessions: readonly PomodoroSession[] | undefined
  isPending: boolean
  locale: ReturnType<typeof useLocale>
}) {
  const t = useT()
  const [expanded, setExpanded] = React.useState(false)

  if (isPending) {
    return (
      <section className="flex flex-col gap-3">
        <h3 className="text-h3 text-foreground">{t('personal.pomodoro.log.title')}</h3>
        <StateView kind="loading" titleKey="state.loading" />
      </section>
    )
  }

  if (!sessions || sessions.length === 0) {
    return (
      <section className="flex flex-col gap-3">
        <h3 className="text-h3 text-foreground">{t('personal.pomodoro.log.title')}</h3>
        <StateView
          kind="empty"
          titleKey="personal.pomodoro.log.empty.title"
          bodyKey="personal.pomodoro.log.empty.body"
        />
      </section>
    )
  }

  const groups = groupSessionsByDay(sessions.slice(0, 60))
  const visibleGroups = expanded ? groups : groups.slice(0, DAY_GROUPS_COLLAPSED)
  const hiddenCount = groups.length - visibleGroups.length

  return (
    <section className="flex flex-col gap-3">
      <h3 className="text-h3 text-foreground">{t('personal.pomodoro.log.title')}</h3>
      <div className="flex flex-col gap-4">
        {visibleGroups.map((group) => {
          const relKey = relativeDayLabelKey(group.date)
          const heading =
            relKey === 'today'
              ? t('personal.pomodoro.log.today')
              : relKey === 'yesterday'
                ? t('personal.pomodoro.log.yesterday')
                : formatDate(group.date, locale)
          return (
            <div key={group.key} className="flex flex-col gap-1.5">
              <h4 className="text-eyebrow uppercase tracking-(--text-eyebrow--letter-spacing) text-muted-foreground">
                {heading}
              </h4>
              <ul className="flex flex-col divide-y divide-border rounded-md border border-border">
                {group.sessions.map((session) => {
                  const durationMin = sessionDurationMin(session)
                  return (
                    <li
                      key={session.id}
                      className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-3 py-2 text-small"
                    >
                      <span className="flex min-w-0 items-center gap-2 text-foreground">
                        {session.kind === 'focus' ? (
                          <Flame className="size-3.5 shrink-0 text-primary" aria-hidden="true" />
                        ) : (
                          <Timer className="size-3.5 shrink-0 text-info" aria-hidden="true" />
                        )}
                        <span className="truncate">{t(PHASE_KIND_LABEL_KEY[session.kind])}</span>
                      </span>
                      <span className="flex shrink-0 items-center gap-2 tabular-nums text-muted-foreground">
                        <span>
                          {formatClock(session.startedAt)}
                          {session.endedAt ? ` – ${formatClock(session.endedAt)}` : ''}
                        </span>
                        {durationMin !== null ? (
                          <span>
                            {formatNumber(durationMin, locale)}{' '}
                            {t('personal.pomodoro.stats.minutesShort')}
                          </span>
                        ) : null}
                        {/* DESIGN.md §9.2: a tinted badge, not the solid fill Badge's own `success`
                            tone would give -- a dense day-by-day log repeats this on every row. */}
                        <Badge
                          tone="neutral"
                          className={cn(
                            'gap-1',
                            session.completed ? 'bg-success/10 text-success' : undefined,
                          )}
                        >
                          {session.completed ? (
                            <ListChecks className="size-3" aria-hidden="true" />
                          ) : null}
                          {t(
                            session.completed
                              ? 'personal.pomodoro.log.completed'
                              : 'personal.pomodoro.log.skipped',
                          )}
                        </Badge>
                      </span>
                    </li>
                  )
                })}
              </ul>
            </div>
          )
        })}
      </div>
      {hiddenCount > 0 ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="self-start"
          onClick={() => setExpanded(true)}
        >
          {t('personal.pomodoro.log.showMore', { count: hiddenCount })}
        </Button>
      ) : null}
    </section>
  )
}

function NumberField({
  label,
  value,
  min,
  max,
  onCommit,
}: {
  label: string
  value: number
  min: number
  max: number
  onCommit: (value: number) => void
}) {
  const [text, setText] = React.useState(String(value))
  React.useEffect(() => setText(String(value)), [value])
  return (
    <label className="flex flex-col gap-1">
      <span className="text-small font-medium text-foreground">{label}</span>
      <input
        type="number"
        min={min}
        max={max}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          const parsed = Math.min(max, Math.max(min, Number(text) || value))
          setText(String(parsed))
          if (parsed !== value) onCommit(parsed)
        }}
        className="h-10 w-full rounded-sm border border-border bg-card px-3 text-body text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      />
    </label>
  )
}
