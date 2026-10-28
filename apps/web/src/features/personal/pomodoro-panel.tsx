// A dedicated timer. The shared controller owns phase transitions and recovery receipts.
import { useT } from '@devon/i18n'
import {
  Button,
  IconButton,
  Sheet,
  SheetContent,
  SheetTrigger,
  StateView,
  cn,
  toast,
} from '@devon/ui'
import { Pause, Play, Settings2, Sparkles, Square, Volume2, VolumeX } from 'lucide-react'
import * as React from 'react'
import { usePomodoroControls, useSavePomodoroSettings } from './pomodoro-controls.js'
import { PomodoroCharacter } from './pomodoro-character.js'
import {
  pause as pauseEngine,
  resume as resumeEngine,
  usePomodoroRemainingSec,
  usePomodoroState,
  type PomodoroPhase,
} from './pomodoro-engine.js'
import type { PomodoroSettings } from './types.js'
import { usePomodoroSettingsQuery } from './use-personal.js'

import './pomodoro-studio.css'

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

function SettingsSheet({ settings }: { settings: PomodoroSettings }) {
  const t = useT()
  const patchSettings = useSavePomodoroSettings()
  const [draft, setDraft] = React.useState(settings)
  const [failedPatch, setFailedPatch] = React.useState<Partial<PomodoroSettings> | null>(null)
  React.useEffect(() => {
    if (!failedPatch && !patchSettings.isPending) setDraft(settings)
  }, [settings, failedPatch, patchSettings.isPending])

  function save(patch: Partial<PomodoroSettings>) {
    if (patchSettings.isPending) return
    const next = { ...draft, ...patch }
    setDraft(next)
    const combined = { ...failedPatch, ...patch }
    patchSettings.mutate(combined, {
      onSuccess: () => setFailedPatch(null),
      onError: () => {
        setFailedPatch(combined)
        toast.error(t('toast.saveError'))
      },
    })
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
          {failedPatch ? (
            <div className="flex flex-wrap items-center gap-2">
              <p role="alert" className="w-full text-small text-destructive">
                {t('personal.save.error')}
              </p>
              <Button
                size="sm"
                disabled={patchSettings.isPending}
                onClick={() => save(failedPatch)}
              >
                {t('personal.save.retry')}
              </Button>
              <Button
                size="sm"
                variant="secondary"
                disabled={patchSettings.isPending}
                onClick={() => {
                  setDraft(settings)
                  setFailedPatch(null)
                  patchSettings.reset()
                }}
              >
                {t('personal.pomodoro.settings.revert')}
              </Button>
            </div>
          ) : null}
          <div className="grid grid-cols-2 gap-4">
            <NumberField
              label={t('personal.pomodoro.settings.focusMin')}
              value={draft.focusMin}
              disabled={patchSettings.isPending}
              min={1}
              max={180}
              onCommit={(v) => save({ focusMin: v })}
            />
            <NumberField
              label={t('personal.pomodoro.settings.shortBreakMin')}
              value={draft.shortBreakMin}
              disabled={patchSettings.isPending}
              min={1}
              max={60}
              onCommit={(v) => save({ shortBreakMin: v })}
            />
            <NumberField
              label={t('personal.pomodoro.settings.longBreakMin')}
              value={draft.longBreakMin}
              disabled={patchSettings.isPending}
              min={1}
              max={120}
              onCommit={(v) => save({ longBreakMin: v })}
            />
            <NumberField
              label={t('personal.pomodoro.settings.cyclesBeforeLong')}
              value={draft.cyclesBeforeLong}
              disabled={patchSettings.isPending}
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
                  disabled={patchSettings.isPending}
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
              disabled={patchSettings.isPending}
              onChange={(e) => save({ notifications: e.target.checked })}
              className="size-4 rounded-sm border-border"
            />
            {t('personal.pomodoro.settings.notifications')}
          </label>
          <label className="flex items-center gap-2 text-body text-foreground">
            <input
              type="checkbox"
              checked={draft.autoStart}
              disabled={patchSettings.isPending}
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
  const settingsQuery = usePomodoroSettingsQuery()
  const patchSettings = useSavePomodoroSettings()
  const controls = usePomodoroControls()
  const state = usePomodoroState()
  // The snapshot that changes on the tick (F3): `usePomodoroState()` alone hands back the same
  // object reference 4x/s, so the ring and the clock below would never re-render without this.
  const remainingSec = usePomodoroRemainingSec()
  const lastSoundRef = React.useRef<PomodoroSettings['sound']>('chime')
  const [selectedPhase, setSelectedPhase] = React.useState<Exclude<PomodoroPhase, 'idle'>>('focus')
  const [animate, setAnimate] = React.useState(true)
  const [completed, setCompleted] = React.useState(false)
  const previousCompletion = React.useRef(state.completedFocusId)
  React.useEffect(() => {
    const advanced =
      !!state.completedFocusId && state.completedFocusId !== previousCompletion.current
    previousCompletion.current = state.completedFocusId
    if (!advanced) return
    setCompleted(true)
    const timeout = setTimeout(() => setCompleted(false), 2600)
    return () => clearTimeout(timeout)
  }, [state.completedFocusId])

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
  if (settings.sound !== 'none') lastSoundRef.current = settings.sound

  const running = state.phase !== 'idle'
  const paused = running && state.remainingAtPause !== null
  const remaining = remainingSec * 1000
  const total = running ? state.durationMs : 0
  const ringValue = running && total > 0 ? 100 - (remaining / total) * 100 : 0
  const activePhase = running ? state.phase : selectedPhase
  const minutes =
    selectedPhase === 'focus'
      ? settings.focusMin
      : selectedPhase === 'short_break'
        ? settings.shortBreakMin
        : settings.longBreakMin
  const displayMs = running ? remaining : minutes * 60_000

  function start(kind: 'focus' | 'short_break' | 'long_break') {
    controls.start(kind, settings)
  }

  function skip() {
    controls.finish(false, settings)
  }

  return (
    <div className="pomodoro-studio" data-phase={activePhase} data-running={running && !paused}>
      <section className="pomodoro-stage" aria-label={t('personal.tabs.pomodoro')}>
        <div className="pomodoro-toolbar">
          <div className="pomodoro-modes" role="group" aria-label={t('pomodoroStudio.mode')}>
            {(['focus', 'short_break', 'long_break'] as const).map((phase) => (
              <button
                key={phase}
                type="button"
                disabled={running || state.busy}
                aria-pressed={activePhase === phase}
                onClick={() => setSelectedPhase(phase)}
              >
                {t(PHASE_LABEL_KEY[phase])}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1">
            <IconButton
              aria-label={t('pomodoroStudio.animation')}
              aria-pressed={animate}
              onClick={() => setAnimate((value) => !value)}
            >
              <Sparkles className="size-4" aria-hidden="true" />
            </IconButton>
            <IconButton
              disabled={patchSettings.isPending}
              aria-label={t(
                settings.sound === 'none'
                  ? 'personal.pomodoro.sound.muteOff'
                  : 'personal.pomodoro.sound.muteOn',
              )}
              onClick={() =>
                patchSettings.mutate(
                  {
                    sound: settings.sound === 'none' ? lastSoundRef.current : 'none',
                  },
                  { onError: () => toast.error(t('toast.saveError')) },
                )
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
        </div>

        <div className="pomodoro-centerpiece">
          <PomodoroCharacter
            phase={activePhase}
            paused={paused}
            animate={animate}
            completed={completed}
          />
          <div className="pomodoro-dial">
            <div className="pomodoro-clock-face">
              <span className="pomodoro-phase">{t(PHASE_LABEL_KEY[activePhase])}</span>
              <span
                className="pomodoro-clock"
                role="timer"
                aria-label={t(PHASE_LABEL_KEY[activePhase])}
              >
                {formatCountdown(displayMs)}
              </span>
              <span className="pomodoro-caption">
                {t(
                  paused
                    ? 'pomodoroStudio.paused'
                    : activePhase === 'focus'
                      ? 'pomodoroStudio.focusHint'
                      : 'pomodoroStudio.breakHint',
                )}
              </span>
            </div>
            <div className="pomodoro-time-track" aria-hidden="true">
              <span
                style={{ transform: `scaleX(${Math.min(100, Math.max(0, ringValue)) / 100})` }}
              />
            </div>
          </div>
        </div>

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

        <div className="pomodoro-main-controls">
          {!running ? (
            <Button
              size="lg"
              disabled={state.busy}
              loading={state.busy}
              onClick={() => start(selectedPhase)}
            >
              <Play className="size-5" aria-hidden="true" />
              {t('pomodoroStudio.start')}
            </Button>
          ) : (
            <>
              {paused ? (
                <Button
                  size="lg"
                  disabled={state.busy || !!state.pendingEnd}
                  onClick={resumeEngine}
                >
                  <Play className="size-5" aria-hidden="true" />
                  {t('personal.pomodoro.action.resume')}
                </Button>
              ) : (
                <Button size="lg" variant="secondary" disabled={state.busy} onClick={pauseEngine}>
                  <Pause className="size-5" aria-hidden="true" />
                  {t('personal.pomodoro.action.pause')}
                </Button>
              )}
              <IconButton
                aria-label={t('personal.pomodoro.action.stop')}
                onClick={skip}
                disabled={state.busy}
                size="touch"
              >
                <Square className="size-5" aria-hidden="true" />
              </IconButton>
            </>
          )}
        </div>

        {state.pendingEnd && !state.busy ? (
          <div className="flex flex-col items-center gap-2 px-4">
            <p role="alert" className="text-small text-destructive">
              {t('personal.save.error')}
            </p>
            <Button size="sm" onClick={skip}>
              {t('personal.save.retry')}
            </Button>
          </div>
        ) : null}
      </section>
    </div>
  )
}

function NumberField({
  label,
  value,
  min,
  max,
  onCommit,
  disabled,
}: {
  label: string
  value: number
  min: number
  max: number
  onCommit: (value: number) => void
  disabled: boolean
}) {
  const t = useT()
  const errorId = React.useId()
  const [invalid, setInvalid] = React.useState(false)
  const [text, setText] = React.useState(String(value))
  React.useEffect(() => setText(String(value)), [value])
  return (
    <label className="flex flex-col gap-1">
      <span className="text-small font-medium text-foreground">{label}</span>
      <input
        type="number"
        aria-label={label}
        disabled={disabled}
        min={min}
        max={max}
        value={text}
        aria-invalid={invalid || undefined}
        aria-describedby={invalid ? errorId : undefined}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          const parsed = text.trim() ? Number(text) : NaN
          if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
            setInvalid(true)
            return
          }
          setInvalid(false)
          setText(String(parsed))
          if (parsed !== value) onCommit(parsed)
        }}
        className="h-10 w-full rounded-sm border border-border bg-card px-3 text-body text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      />
      {invalid ? (
        <span id={errorId} role="alert" className="text-small text-destructive">
          {t('personal.pomodoro.settings.invalidRange', { min, max })}
        </span>
      ) : null}
    </label>
  )
}
