// The Pomodoro mini widget (TECH-SPEC §3.3: "a mini widget in the shell top bar that keeps running
// across routes"). Mounted today at the top of the Personal screen (`personal-screen.tsx`) -- the
// engine itself (`pomodoro-engine.ts`) is already route-independent (localStorage-backed, wall-clock
// end times), so the ONE remaining step for true cross-route visibility is mounting this same
// component from `apps/web/src/shell/app-shell.tsx`'s `TopBar`'s `trailing` slot
// (`{user ? <PersonalPomodoroWidget /> : null}`, alongside `<LocaleMenu>`) -- a file outside this
// module's allowed paths (MODULE-GUIDE.md: routes/sidebar/commands are the only shell extension
// points a feature manifest gets today; there is no "always-mounted widget" slot yet). Flagged for
// the integration step rather than silently shipped as `/personal`-only.
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
  pause as pauseEngine,
  resume as resumeEngine,
  usePomodoroRemainingSec,
  usePomodoroState,
  type PomodoroPhase,
} from './pomodoro-engine.js'
import { usePomodoroSettingsQuery } from './use-personal.js'
import { usePomodoroControls } from './pomodoro-controls.js'

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
  // F3: the per-second snapshot. It drives the mini ring *and* re-arms the end-of-phase effect
  // below -- `state` alone never changes reference on a tick, so that effect used to fire only on
  // start/pause/phase change and a phase could run past zero unnoticed.
  const remainingSec = usePomodoroRemainingSec()
  const settingsQuery = usePomodoroSettingsQuery()
  const controls = usePomodoroControls()

  const settings = settingsQuery.data

  if (!settings) return null

  const running = state.phase !== 'idle'
  const paused = running && state.remainingAtPause !== null
  const remaining = remainingSec * 1000
  const ringValue = running && settings ? 100 - (remaining / state.durationMs) * 100 : 0

  function start(kind: 'focus' | 'short_break' | 'long_break') {
    if (!settings) return
    controls.start(kind, settings, activeTaskId ?? null)
  }

  function skip() {
    if (settings) controls.finish(false, settings, state.taskId)
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
                <Button
                  size="sm"
                  disabled={state.busy}
                  loading={state.busy}
                  onClick={() => start('focus')}
                >
                  <Play className="size-4" aria-hidden="true" />
                  {t('personal.pomodoro.action.startFocus')}
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={state.busy}
                  onClick={() => start('short_break')}
                >
                  {t('personal.pomodoro.action.startShortBreak')}
                </Button>
              </>
            ) : (
              <>
                {paused ? (
                  <Button
                    size="sm"
                    disabled={state.busy || !!state.pendingEnd}
                    onClick={resumeEngine}
                  >
                    <Play className="size-4" aria-hidden="true" />
                    {t('personal.pomodoro.action.resume')}
                  </Button>
                ) : (
                  <Button size="sm" variant="secondary" disabled={state.busy} onClick={pauseEngine}>
                    <Pause className="size-4" aria-hidden="true" />
                    {t('personal.pomodoro.action.pause')}
                  </Button>
                )}
                <IconButton
                  aria-label={t('personal.pomodoro.action.skip')}
                  disabled={state.busy}
                  onClick={skip}
                >
                  <SkipForward className="size-4" aria-hidden="true" />
                </IconButton>
                <IconButton
                  aria-label={t('personal.pomodoro.action.stop')}
                  disabled={state.busy}
                  onClick={skip}
                >
                  <Square className="size-4" aria-hidden="true" />
                </IconButton>
              </>
            )}
          </div>

          <Separator />
          {state.pendingEnd && !state.busy ? (
            <div className="flex flex-col gap-2">
              <p role="alert" className="text-small text-destructive">
                {t('personal.save.error')}
              </p>
              <Button size="sm" onClick={skip}>
                {t('personal.save.retry')}
              </Button>
            </div>
          ) : null}
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
