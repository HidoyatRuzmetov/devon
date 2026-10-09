import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  attachSessionId,
  getPomodoroState,
  pause,
  preparePomodoroEnd,
  remainingMs,
  resume,
  scopePomodoroState,
  setPomodoroBusy,
  startPhase,
  stopToIdle,
} from '../../src/features/personal/pomodoro-engine.js'
import type { PomodoroSettings } from '../../src/features/personal/types.js'

const settings: PomodoroSettings = {
  focusMin: 1,
  shortBreakMin: 1,
  longBreakMin: 2,
  cyclesBeforeLong: 2,
  sound: 'none',
  notifications: false,
  autoStart: false,
}
beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-10-08T09:00:00Z'))
  scopePomodoroState(null)
  localStorage.clear()
})
afterEach(() => {
  scopePomodoroState(null)
  localStorage.clear()
  vi.useRealTimers()
})

describe('Pomodoro ownership and receipt recovery', () => {
  it('never imports an ownerless legacy timer into a signed-in account', () => {
    localStorage.setItem(
      'devon.personal.pomodoro.v1',
      JSON.stringify({
        phase: 'focus',
        sessionId: 'private-old-session',
        endAt: Date.now() + 60_000,
      }),
    )
    scopePomodoroState('owner-a')
    expect(getPomodoroState()).toMatchObject({ userId: 'owner-a', phase: 'idle', sessionId: null })
  })

  it('preserves exact completed ending intent across another owner and restoration, excluding transient busy state', () => {
    scopePomodoroState('owner-a')
    startPhase('focus', settings)
    attachSessionId('session-a')
    const intent = preparePomodoroEnd(true)
    setPomodoroBusy(true)
    scopePomodoroState('owner-b')
    expect(getPomodoroState()).toMatchObject({
      userId: 'owner-b',
      phase: 'idle',
      pendingEnd: null,
      busy: false,
    })
    startPhase('short_break', settings)
    attachSessionId('session-b')
    scopePomodoroState('owner-a')
    expect(getPomodoroState()).toMatchObject({
      phase: 'focus',
      sessionId: 'session-a',
      pendingEnd: intent,
      busy: false,
    })
    const before = getPomodoroState()
    resume()
    expect(getPomodoroState()).toBe(before)
    expect(preparePomodoroEnd(false)).toEqual(intent)
    scopePomodoroState('owner-b')
    expect(getPomodoroState()).toMatchObject({
      phase: 'short_break',
      sessionId: 'session-b',
      pendingEnd: null,
    })
  })

  it('uses the recorded start time and preserves paused time independently from ticking', () => {
    scopePomodoroState('owner-a')
    startPhase('focus', settings, null, Date.now() - 10_000)
    expect(remainingMs()).toBe(50_000)
    pause()
    vi.advanceTimersByTime(20_000)
    expect(remainingMs()).toBe(50_000)
    resume()
    expect(remainingMs()).toBe(50_000)
    vi.advanceTimersByTime(5_000)
    expect(remainingMs()).toBe(45_000)
    stopToIdle()
    expect(getPomodoroState()).toMatchObject({
      userId: 'owner-a',
      phase: 'idle',
      sessionId: null,
      pendingEnd: null,
    })
  })

  it('rejects corrupted persisted clock/phase/ending values without exposing a different owner', () => {
    for (const patch of [
      { phase: 'broken' },
      { cycleIndex: -1 },
      { endAt: 'not-a-clock' },
      { pendingEnd: { endedAt: 'invalid', completed: true } },
      { userId: 'owner-b' },
    ]) {
      scopePomodoroState('owner-a')
      startPhase('focus', settings)
      const state = getPomodoroState()
      scopePomodoroState(null)
      localStorage.setItem(
        'devon.personal.pomodoro.v1.owner-a',
        JSON.stringify({ ...state, ...patch }),
      )
      scopePomodoroState('owner-a')
      expect(getPomodoroState()).toMatchObject({
        userId: 'owner-a',
        phase: 'idle',
        sessionId: null,
        pendingEnd: null,
      })
    }
  })
})
