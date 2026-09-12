// "Diqqat" -- the Pomodoro companion.
//
// The point of putting a focus timer in a Telegram Mini App is that the phone is where the
// distraction lives. So: the same `app.pomodoro_sessions` rows the personal workspace on the web
// writes (start here, see it in the web's Pomodoro stats and focus minutes), the same settings, and
// one thing the web cannot do -- when the block ends, the **bot** sends the message, so it arrives
// even if the sheet was closed two minutes in.
//
// I-1 throughout: every row here is the viewer's own, owner-only, and the bot message names the phase
// and the length, never a task title.
import * as React from 'react'
import { Pause, Play, RotateCcw } from 'lucide-react'
import { useT } from '@devon/i18n'
import { Button, ProgressRing, cn, toast } from '@devon/ui'
import {
  endPomodoroSession,
  getPomodoroSettings,
  getPomodoroStats,
  sendFocusAlert,
  startPomodoroSession,
  type PomodoroSession,
} from '../lib/api.js'
import { useQuery } from '../lib/use-query.js'
import { tg } from '../lib/telegram.js'
import { ListSkeleton, QueryState, ScreenBody, ScreenHeader } from '../components/screen.js'
import { SectionLabel } from '../components/bits.js'

type Phase = 'focus' | 'short_break' | 'long_break'

function mmss(totalSeconds: number): string {
  const clamped = Math.max(0, Math.round(totalSeconds))
  const minutes = Math.floor(clamped / 60)
  const seconds = clamped % 60
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

const PHASE_TONE: Record<Phase, string> = {
  focus: 'text-primary',
  short_break: 'text-info',
  long_break: 'text-info',
}

export function FocusScreen(): React.ReactElement {
  const t = useT()
  const settings = useQuery(() => getPomodoroSettings(), [])
  const stats = useQuery(() => getPomodoroStats(), [])

  const [phase, setPhase] = React.useState<Phase>('focus')
  const [running, setRunning] = React.useState(false)
  const [endsAt, setEndsAt] = React.useState<number | null>(null)
  const [remaining, setRemaining] = React.useState(0)
  const [session, setSession] = React.useState<PomodoroSession | null>(null)
  const [starting, setStarting] = React.useState(false)

  const minutesFor = React.useCallback(
    (which: Phase): number => {
      const s = settings.data
      if (!s) return which === 'focus' ? 25 : which === 'short_break' ? 5 : 15
      return which === 'focus'
        ? s.focusMin
        : which === 'short_break'
          ? s.shortBreakMin
          : s.longBreakMin
    },
    [settings.data],
  )

  // Reset the clock whenever the phase (or the settings behind it) changes and nothing is running.
  React.useEffect(() => {
    if (!running) setRemaining(minutesFor(phase) * 60)
  }, [phase, minutesFor, running])

  const finish = React.useCallback(
    (completed: boolean) => {
      setRunning(false)
      setEndsAt(null)
      const open = session
      setSession(null)
      setRemaining(minutesFor(phase) * 60)
      if (!open) return
      endPomodoroSession(open.id, new Date().toISOString(), completed)
        .then(() => stats.refetch())
        .catch(() => toast.error(t('miniapp.focus.saveFailed')))
      if (!completed) return
      tg.haptic.success()
      // The bot is the thing that reaches the person when the sheet is closed. A failure here is
      // reported quietly: the session itself is already recorded, which is the part that matters.
      sendFocusAlert(phase, minutesFor(phase))
        .then((result) => {
          if (result.sent) return
          if (result.reason === 'not_linked') toast.message(t('miniapp.focus.alertNotLinked'))
          else if (result.reason === 'muted') toast.message(t('miniapp.focus.alertMuted'))
        })
        .catch(() => undefined)
    },
    [session, phase, minutesFor, stats, t],
  )

  // One interval, driven by an absolute end timestamp rather than a decrementing counter: a webview
  // that Telegram backgrounds stops firing timers, and a counter would silently drift behind by
  // exactly the time the app was hidden.
  React.useEffect(() => {
    if (!running || endsAt === null) return undefined
    const tick = (): void => {
      const left = (endsAt - Date.now()) / 1000
      setRemaining(left)
      if (left <= 0) finish(true)
    }
    tick()
    const handle = window.setInterval(tick, 500)
    return () => window.clearInterval(handle)
  }, [running, endsAt, finish])

  const start = React.useCallback(() => {
    if (starting) return
    setStarting(true)
    const startedAt = new Date()
    startPomodoroSession(phase, startedAt.toISOString())
      .then((created) => {
        setSession(created)
        setEndsAt(startedAt.getTime() + minutesFor(phase) * 60_000)
        setRunning(true)
        tg.haptic.tap()
      })
      .catch(() => toast.error(t('miniapp.focus.startFailed')))
      .finally(() => setStarting(false))
  }, [starting, phase, minutesFor, t])

  const total = minutesFor(phase) * 60
  const progress = total > 0 ? ((total - Math.max(0, remaining)) / total) * 100 : 0

  if (settings.status === 'loading' && settings.data === null) {
    return (
      <>
        <ScreenHeader title={t('miniapp.focus.title')} eyebrow={t('miniapp.focus.eyebrow')} />
        <ScreenBody>
          <ListSkeleton rows={3} />
        </ScreenBody>
      </>
    )
  }
  if (settings.data === null) {
    return (
      <>
        <ScreenHeader title={t('miniapp.focus.title')} eyebrow={t('miniapp.focus.eyebrow')} />
        <ScreenBody>
          <QueryState error={settings.error} onRetry={settings.refetch} />
        </ScreenBody>
      </>
    )
  }

  return (
    <>
      <ScreenHeader title={t('miniapp.focus.title')} eyebrow={t('miniapp.focus.eyebrow')} />
      <ScreenBody>
        <div
          role="group"
          aria-label={t('miniapp.focus.phaseAria')}
          className="mb-4 grid grid-cols-3 gap-1.5"
        >
          {(['focus', 'short_break', 'long_break'] as const).map((option) => (
            <Button
              key={option}
              size="sm"
              variant={phase === option ? 'primary' : 'secondary'}
              aria-pressed={phase === option}
              disabled={running}
              onClick={() => setPhase(option)}
            >
              {t(`miniapp.focus.phase.${option}`)}
            </Button>
          ))}
        </div>

        <div className="flex flex-col items-center gap-4 py-2">
          <ProgressRing
            value={progress}
            size={196}
            strokeWidth={10}
            label={t('miniapp.focus.ringAria', { phase: t(`miniapp.focus.phase.${phase}`) })}
            toneClassName={PHASE_TONE[phase]}
          >
            <span className="font-display text-[40px] leading-11 tabular-nums">
              {mmss(remaining)}
            </span>
          </ProgressRing>

          <div className="flex w-full gap-2">
            {running ? (
              <Button
                variant="secondary"
                size="lg"
                className="flex-1"
                onClick={() => finish(false)}
              >
                <Pause className="size-4" aria-hidden />
                {t('miniapp.focus.stop')}
              </Button>
            ) : (
              <Button size="lg" className="flex-1" loading={starting} onClick={start}>
                <Play className="size-4" aria-hidden />
                {t('miniapp.focus.start')}
              </Button>
            )}
            <Button
              variant="ghost"
              size="lg"
              aria-label={t('miniapp.focus.reset')}
              disabled={running}
              onClick={() => setRemaining(minutesFor(phase) * 60)}
            >
              <RotateCcw className="size-4" aria-hidden />
            </Button>
          </div>
          <p className="text-muted-foreground text-center text-[12px] leading-4">
            {t('miniapp.focus.botNote')}
          </p>
        </div>

        <SectionLabel>{t('miniapp.focus.stats')}</SectionLabel>
        <div className="grid grid-cols-2 gap-2">
          {(
            [
              ['miniapp.focus.today', stats.data?.today.focusMinutes ?? 0],
              ['miniapp.focus.week', stats.data?.week.focusMinutes ?? 0],
            ] as const
          ).map(([labelKey, minutes]) => (
            <div
              key={labelKey}
              className={cn('border-border bg-card shadow-1 rounded-md border px-3 py-3')}
            >
              <p className="text-muted-foreground text-[11px] tracking-[0.08em] uppercase">
                {t(labelKey)}
              </p>
              <p className="font-display text-[24px] leading-8 tabular-nums">
                {t('miniapp.focus.minutes', { count: Math.round(minutes) })}
              </p>
            </div>
          ))}
        </div>
      </ScreenBody>
    </>
  )
}
