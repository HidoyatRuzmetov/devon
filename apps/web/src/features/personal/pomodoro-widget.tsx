// The Pomodoro mini widget (TECH-SPEC §3.3: "a mini widget in the shell top bar that keeps running
// across routes"). Mounted today at the top of the Personal screen (`personal-screen.tsx`) -- the
// engine itself (`pomodoro-engine.ts`) is already route-independent (localStorage-backed, wall-clock
// end times), so the ONE remaining step for true cross-route visibility is mounting this same
// component from `apps/web/src/shell/app-shell.tsx`'s `TopBar`'s `trailing` slot
// (`{user ? <PersonalPomodoroWidget /> : null}`, alongside `<LocaleMenu>`) -- a file outside this
// module's allowed paths (MODULE-GUIDE.md: routes/sidebar/commands are the only shell extension
// points a feature manifest gets today; there is no "always-mounted widget" slot yet). Flagged for
// the integration step rather than silently shipped as `/personal`-only.
import * as React from 'react'
import { useT } from '@devon/i18n'
import { Timer, Pause, Play, SkipForward, Square, Volume2, BellRing } from 'lucide-react'
import {
  Button,
  IconButton,
  Popover,
  PopoverContent,
  PopoverTrigger,
  ProgressRing,
  Separator,
  cn,
} from '@devon/ui'
import {
  PHASE_RING_TONE,
  advanceCycle,
  attachSessionId,
  nextPhaseAfterFocus,
  notifyPhaseEnd,
  pause as pauseEngine,
  phaseDurationMs,
  phaseToKind,
  playPhaseEndSound,
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
  usePomodoroSettingsQuery,
} from './use-personal.js'

function formatCountdown(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000))
  const m = Math.floor(totalSeconds / 60)
  const s = totalSeconds % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

const PHASE_LABEL_KEY: Record<PomodoroPhase, string> = {
  idle: 'personal.pomodoro.phase.idle',
  focus: 'personal.pomodoro.phase.focus',
  short_break: 'personal.pomodoro.phase.shortBreak',
  long_break: 'personal.pomodoro.phase.longBreak',
}

export function PomodoroWidget({ activeTaskId }: { activeTaskId?: string | null }) {
  const t = useT()
  const state = usePomodoroState()
  const settingsQuery = usePomodoroSettingsQuery()
  const createSession = useCreatePomodoroSessionMutation()
  const patchSession = usePatchPomodoroSessionMutation()
  const handledEndRef = React.useRef(false)

  const settings = settingsQuery.data

  // Drives the one moment a running phase's countdown reaches zero: end the recorded session,
  // sound + notify, and either auto-advance or park at idle for the user to start the next phase.
  React.useEffect(() => {
    if (!settings) return
    if (state.phase === 'idle' || state.remainingAtPause !== null) {
      handledEndRef.current = false
      return
    }
    if (remainingMs() > 0) {
      handledEndRef.current = false
      return
    }
    if (handledEndRef.current) return
    handledEndRef.current = true

    const finishedPhase = state.phase
    if (state.sessionId) {
      patchSession.mutate({
        id: state.sessionId,
        input: { completed: true, endedAt: new Date().toISOString() },
      })
    }
    playPhaseEndSound(settings.sound, finishedPhase)
    notifyPhaseEnd(
      settings.notifications,
      t(PHASE_LABEL_KEY[finishedPhase === 'focus' ? 'focus' : finishedPhase]),
      t('personal.pomodoro.notification.body'),
    )

    let next: Exclude<PomodoroPhase, 'idle'>
    if (finishedPhase === 'focus') {
      const cycleAfter = advanceCycle(true, settings.cyclesBeforeLong)
      next = nextPhaseAfterFocus(cycleAfter, settings.cyclesBeforeLong)
    } else {
      next = 'focus'
    }

    if (settings.autoStart) {
      const nextTaskId = next === 'focus' ? (activeTaskId ?? null) : null
      startPhase(next, settings, nextTaskId)
      createSession.mutate(
        { kind: phaseToKind(next), startedAt: new Date().toISOString(), taskId: nextTaskId },
        { onSuccess: (row) => attachSessionId(row.id) },
      )
    } else {
      stopToIdle()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fires on the tick, not on every dep change.
  }, [state, settings, activeTaskId])

  if (!settings) return null

  const running = state.phase !== 'idle'
  const paused = running && state.remainingAtPause !== null
  const remaining = remainingMs()
  const ringValue =
    running && settings
      ? 100 -
        (remaining / phaseDurationMs(state.phase as Exclude<PomodoroPhase, 'idle'>, settings)) * 100
      : 0

  function start(kind: 'focus' | 'short_break' | 'long_break') {
    if (!settings) return
    const taskId = kind === 'focus' ? (activeTaskId ?? null) : null
    startPhase(kind, settings, taskId)
    requestNotificationPermission()
    createSession.mutate(
      { kind: phaseToKind(kind), startedAt: new Date().toISOString(), taskId },
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
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            'inline-flex h-9 items-center gap-1.5 rounded-md border border-border px-2.5 text-small',
            'text-foreground transition-colors duration-(--dur-micro) hover:bg-accent',
            running && !paused && 'border-primary/40 text-primary',
          )}
          aria-label={t('personal.pomodoro.widget.aria')}
        >
          {running ? (
            <ProgressRing
              value={ringValue}
              size={16}
              strokeWidth={2}
              sweep="tick"
              label={t(PHASE_LABEL_KEY[state.phase])}
              toneClassName={PHASE_RING_TONE[state.phase]}
            />
          ) : (
            <Timer className="size-4" aria-hidden="true" />
          )}
          {running ? (
            <span className="tabular-nums">{formatCountdown(remaining)}</span>
          ) : (
            <span className="hidden sm:inline">{t('personal.pomodoro.widget.label')}</span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72">
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <span className="text-small font-medium text-foreground">
              {t(PHASE_LABEL_KEY[state.phase])}
            </span>
            <span className="font-mono text-h3 tabular-nums text-foreground">
              {formatCountdown(remaining)}
            </span>
          </div>

          <div className="flex items-center gap-1" aria-hidden="true">
            {Array.from({ length: settings.cyclesBeforeLong }).map((_, i) => (
              <span
                key={i}
                className={cn(
                  'h-1.5 flex-1 rounded-full',
                  i < state.cycleIndex || (i === state.cycleIndex && state.phase === 'focus')
                    ? 'bg-primary'
                    : 'bg-accent',
                )}
              />
            ))}
          </div>

          <div className="flex flex-wrap gap-2">
            {!running ? (
              <>
                <Button size="sm" onClick={() => start('focus')}>
                  <Play className="size-4" aria-hidden="true" />
                  {t('personal.pomodoro.action.startFocus')}
                </Button>
                <Button size="sm" variant="secondary" onClick={() => start('short_break')}>
                  {t('personal.pomodoro.action.startShortBreak')}
                </Button>
              </>
            ) : (
              <>
                {paused ? (
                  <Button size="sm" onClick={resumeEngine}>
                    <Play className="size-4" aria-hidden="true" />
                    {t('personal.pomodoro.action.resume')}
                  </Button>
                ) : (
                  <Button size="sm" variant="secondary" onClick={pauseEngine}>
                    <Pause className="size-4" aria-hidden="true" />
                    {t('personal.pomodoro.action.pause')}
                  </Button>
                )}
                <IconButton aria-label={t('personal.pomodoro.action.skip')} onClick={skip}>
                  <SkipForward className="size-4" aria-hidden="true" />
                </IconButton>
                <IconButton aria-label={t('personal.pomodoro.action.stop')} onClick={skip}>
                  <Square className="size-4" aria-hidden="true" />
                </IconButton>
              </>
            )}
          </div>

          <Separator />
          <div className="flex items-center gap-3 text-caption text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <Volume2 className="size-3.5" aria-hidden="true" />
              {t(`personal.pomodoro.sound.${settings.sound}`)}
            </span>
            <span className="inline-flex items-center gap-1">
              <BellRing className="size-3.5" aria-hidden="true" />
              {t(
                settings.notifications
                  ? 'personal.pomodoro.notifications.on'
                  : 'personal.pomodoro.notifications.off',
              )}
            </span>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}
