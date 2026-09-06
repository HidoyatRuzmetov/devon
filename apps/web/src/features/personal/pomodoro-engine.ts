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

/** React binding: re-renders whenever the store changes, plus a steady tick while a phase is
 * running so a countdown display updates every 250ms without each consumer managing its own timer. */
export function usePomodoroState(): PomodoroState {
  return React.useSyncExternalStore(subscribePomodoro, getPomodoroState, () => IDLE_STATE)
}
