// A dependency-free, module-level Pomodoro timer store (same pattern as `src/lib/router.tsx`'s
// `useSyncExternalStore` subscribe/notify pair) -- singleton so the mini widget, the settings panel
// and any "start focus on this task" button all observe and drive the exact same running timer,
// including across a full unmount/remount of whichever component happens to render it (state lives
// in `localStorage`, keyed by wall-clock end time, never a `setInterval` countdown that would drift
// or reset). TECH-SPEC §3.3: "Pomodoro timer (defaults 25/5/15, 4 cycles, editable in settings,
// sounds, browser notifications, a mini widget in the shell top bar that keeps running across
// routes, session log and simple stats)".
//
// NOTE for integration (outside this module's allowed paths): mounting `<PomodoroWidget>` from
// `apps/web/src/shell/app-shell.tsx`'s top-bar `trailing` slot is what makes it literally visible on
// every route including `/` and `/admin`, not only `/personal` -- this engine is already
// route-independent and ready for that; see `pomodoro-widget.tsx`'s header for the one-line change.
import * as React from 'react'
import type { PomodoroKind, PomodoroSettings } from './types.js'

export type PomodoroPhase = 'idle' | 'focus' | 'short_break' | 'long_break'

export type PomodoroState = {
  phase: PomodoroPhase
  /** Wall-clock end time (ms since epoch) while running; `null` while idle or paused. */
  endAt: number | null
  /** Remaining ms, frozen, while paused; `null` while idle or running. */
  remainingAtPause: number | null
  /** Completed focus phases since the last long break (0..cyclesBeforeLong-1). */
  cycleIndex: number
  /** The server-side `pomodoro_sessions.id` for the phase in progress, if it has been recorded. */
  sessionId: string | null
  /** The personal task this focus phase is linked to, if any. */
  taskId: string | null
}

const STORAGE_KEY = 'devon.personal.pomodoro.v1'

const IDLE_STATE: PomodoroState = {
  phase: 'idle',
  endAt: null,
  remainingAtPause: null,
  cycleIndex: 0,
  sessionId: null,
  taskId: null,
}

function readState(): PomodoroState {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return IDLE_STATE
    const parsed = JSON.parse(raw) as Partial<PomodoroState>
    return { ...IDLE_STATE, ...parsed }
  } catch {
    return IDLE_STATE
  }
}

function writeState(state: PomodoroState): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch {
    // Storage disabled -- the timer still works for the rest of this tab's session (in-memory only).
  }
}

let state: PomodoroState = typeof window === 'undefined' ? IDLE_STATE : readState()
const listeners = new Set<() => void>()
let tickHandle: ReturnType<typeof setInterval> | null = null

function notify(): void {
  for (const listener of listeners) listener()
}

function setState(patch: Partial<PomodoroState>): void {
  state = { ...state, ...patch }
  writeState(state)
  notify()
}

function ensureTicking(): void {
  if (tickHandle !== null) return
  tickHandle = setInterval(() => {
    if (state.phase !== 'idle' && state.endAt !== null && Date.now() >= state.endAt) {
      notify() // Let a subscribed `PomodoroController` (mounted once) drive the transition + side effects.
    } else {
      notify()
    }
  }, 250)
}

export function getPomodoroState(): PomodoroState {
  return state
}

export function subscribePomodoro(listener: () => void): () => void {
  listeners.add(listener)
  ensureTicking()
  return () => {
    listeners.delete(listener)
    // H4.6/H11.1 ("timers cleared, no leaks across navigation"): `ensureTicking` started a 250ms
    // `setInterval` the moment the *first* ever subscriber (any Pomodoro-showing screen) mounted,
    // but until this line nothing ever paired it with a `clearInterval` -- once any component in the
    // app had shown the Pomodoro panel even once, that interval ran forever, for the rest of the
    // tab's life, even with zero listeners left (every screen that ever rendered the panel
    // unmounted). Stopping it here when the last listener leaves, and letting a future subscriber's
    // `ensureTicking()` restart it, keeps the real invariant ("ticking only while something is
    // listening") instead of "ticking forever after the first listener".
    if (listeners.size === 0 && tickHandle !== null) {
      clearInterval(tickHandle)
      tickHandle = null
    }
  }
}

/** Milliseconds remaining in the current phase, 0 while idle. */
export function remainingMs(now = Date.now()): number {
  if (state.phase === 'idle') return 0
  if (state.remainingAtPause !== null) return state.remainingAtPause
  if (state.endAt === null) return 0
  return Math.max(0, state.endAt - now)
}

export function isPaused(): boolean {
  return state.phase !== 'idle' && state.remainingAtPause !== null
}

function durationMsFor(phase: Exclude<PomodoroPhase, 'idle'>, settings: PomodoroSettings): number {
  const minutes =
    phase === 'focus'
      ? settings.focusMin
      : phase === 'short_break'
        ? settings.shortBreakMin
        : settings.longBreakMin
  return minutes * 60_000
}

/** Exported for the big-ring view (`pomodoro-panel.tsx`): the ring's `value` is
 * `100 - remainingMs/phaseDurationMs*100`, i.e. how much of the current phase has elapsed. */
export function phaseDurationMs(
  phase: Exclude<PomodoroPhase, 'idle'>,
  settings: PomodoroSettings,
): number {
  return durationMsFor(phase, settings)
}

/** UI-OVERHAUL.md's "Pomodoro" row ("animated ring stroke, phase colour crossfade"): the one tone
 * class per phase, shared by the mini widget's ring and the big-ring panel so the two never drift on
 * which colour means which phase. */
export const PHASE_RING_TONE: Record<PomodoroPhase, string> = {
  idle: 'text-muted-foreground',
  focus: 'text-primary',
  short_break: 'text-success',
  long_break: 'text-info',
}

export function phaseToKind(phase: Exclude<PomodoroPhase, 'idle'>): PomodoroKind {
  return phase
}

/** Starts a fresh phase (used both for the user pressing "start" and for an automatic transition).
 * `sessionId` is attached once the caller's `onPhaseStart` callback has recorded it server-side. */
export function startPhase(
  phase: Exclude<PomodoroPhase, 'idle'>,
  settings: PomodoroSettings,
  taskId: string | null = null,
): void {
  setState({
    phase,
    endAt: Date.now() + durationMsFor(phase, settings),
    remainingAtPause: null,
    sessionId: null,
    taskId: phase === 'focus' ? taskId : null,
  })
}

export function attachSessionId(sessionId: string): void {
  setState({ sessionId })
}

export function pause(): void {
  if (state.phase === 'idle' || state.remainingAtPause !== null) return
  setState({ remainingAtPause: remainingMs(), endAt: null })
}

export function resume(): void {
  if (state.phase === 'idle' || state.remainingAtPause === null) return
  setState({ endAt: Date.now() + state.remainingAtPause, remainingAtPause: null })
}

export function stopToIdle(): void {
  setState({ ...IDLE_STATE, cycleIndex: state.cycleIndex })
}

export function advanceCycle(completedFocus: boolean, cyclesBeforeLong: number): number {
  const next = completedFocus ? (state.cycleIndex + 1) % cyclesBeforeLong : state.cycleIndex
  setState({ cycleIndex: next })
  return next
}

export function nextPhaseAfterFocus(
  cycleIndexAfter: number,
  cyclesBeforeLong: number,
): Exclude<PomodoroPhase, 'idle'> {
  return cycleIndexAfter === 0 && cyclesBeforeLong > 0 ? 'long_break' : 'short_break'
}

// -- Sound + notifications ------------------------------------------------------------------------

let audioCtx: AudioContext | null = null

function beep(frequencies: number[], sound: PomodoroSettings['sound']): void {
  if (sound === 'none') return
  try {
    audioCtx ??= new (
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    )()
    const ctx = audioCtx
    if (ctx.state === 'suspended') void ctx.resume()
    let t = ctx.currentTime
    for (const freq of frequencies) {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = sound === 'digital' ? 'square' : sound === 'bell' ? 'triangle' : 'sine'
      osc.frequency.value = freq
      gain.gain.setValueAtTime(0.0001, t)
      gain.gain.exponentialRampToValueAtTime(0.2, t + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.28)
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.start(t)
      osc.stop(t + 0.3)
      t += 0.18
    }
  } catch {
    // Web Audio unavailable (locked-down browser context) -- the visual/notification cues still fire.
  }
}

export function playPhaseEndSound(sound: PomodoroSettings['sound'], phase: PomodoroPhase): void {
  beep(phase === 'focus' ? [880, 660] : [523, 659, 784], sound)
}

export function requestNotificationPermission(): void {
  if (typeof Notification === 'undefined') return
  if (Notification.permission === 'default') void Notification.requestPermission()
}

export function notifyPhaseEnd(enabled: boolean, title: string, body: string): void {
  if (!enabled) return
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return
  try {
    new Notification(title, { body, silent: true })
  } catch {
    // Notification construction can throw in some embedded/webview contexts -- non-fatal.
  }
}

/** React binding: re-renders whenever the store's *state object* changes -- start, pause, resume,
 * phase change. It deliberately does NOT re-render on the 250ms tick: `getPomodoroState()` returns
 * the same object reference every tick, so `useSyncExternalStore` compares it with `Object.is` and
 * bails out. Anything that has to advance with the clock (the countdown text, the ring stroke, the
 * end-of-phase effect) must subscribe to `usePomodoroRemainingSec()` as well. */
export function usePomodoroState(): PomodoroState {
  return React.useSyncExternalStore(subscribePomodoro, getPomodoroState, () => IDLE_STATE)
}

/** The snapshot that actually changes on a tick: whole seconds left in the current phase.
 *
 * DESIGN.md §10 ("Pomodoro | animated ring stroke, phase colour crossfade | 1 s per tick") asks the
 * ring and the number to move once a second. Seconds -- not milliseconds -- are the snapshot on
 * purpose: the store notifies 4x/s, `Object.is` collapses three of those four to no-ops, and React
 * re-renders exactly once per second, which is the cadence `sweep="tick"` was written for.
 * `Math.ceil` so a 25:00 phase shows "25:00" on its first frame rather than "24:59". */
export function usePomodoroRemainingSec(): number {
  return React.useSyncExternalStore(
    subscribePomodoro,
    () => Math.ceil(remainingMs() / 1000),
    () => 0,
  )
}
