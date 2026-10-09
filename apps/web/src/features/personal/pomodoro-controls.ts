import * as React from 'react'
import { useIsMutating, useMutation, useQueryClient } from '@tanstack/react-query'
import { useT } from '@devon/i18n'
import { toast } from '@devon/ui'
import { useMeQuery } from '../../lib/session.js'
import type { Me } from '../../lib/api-schemas.js'
import * as api from './api.js'
import type { PomodoroSettings, PatchPomodoroSettingsInput } from './types.js'
import {
  advanceCycle,
  attachSessionId,
  getPomodoroState,
  nextPhaseAfterFocus,
  notifyPhaseEnd,
  playPhaseEndSound,
  preparePomodoroEnd,
  requestNotificationPermission,
  scopePomodoroState,
  setPomodoroBusy,
  startPhase,
  stopToIdle,
  type PomodoroPhase,
} from './pomodoro-engine.js'

type Phase = Exclude<PomodoroPhase, 'idle'>
type Start = {
  owner: string
  phase: Phase
  settings: PomodoroSettings
  taskId: string | null
  startedAt: string
}
type End = {
  owner: string
  id: string
  phase: Phase
  settings: PomodoroSettings
  taskId: string | null
  endedAt: string
  completed: boolean
  next?: Phase
}
const SETTINGS_KEY = ['personal', 'pomodoro', 'settings-write'] as const

/** One operation boundary for the full panel and mini widget. Receipts precede local phase changes. */
export function usePomodoroControls() {
  const me = useMeQuery()
  const qc = useQueryClient()
  const t = useT()
  const owner = me.data?.user.id ?? null
  const csrf = me.data?.csrfToken ?? ''
  React.useEffect(() => scopePomodoroState(owner), [owner])
  const owns = (id: string) =>
    qc.getQueryData<Me | null>(['me'])?.user.id === id && getPomodoroState().userId === id
  const refresh = (id: string) => {
    if (!owns(id)) return
    void qc.invalidateQueries({ queryKey: ['personal', 'pomodoro', 'sessions'] })
    void qc.invalidateQueries({ queryKey: ['personal', 'pomodoro', 'stats'] })
  }
  const acceptStart = (input: Start, sessionId: string) => {
    if (!owns(input.owner)) return
    startPhase(input.phase, input.settings, input.taskId, Date.parse(input.startedAt))
    attachSessionId(sessionId)
    refresh(input.owner)
  }
  const create = useMutation({
    mutationKey: ['personal', 'pomodoro', 'session-write'],
    mutationFn: (input: Start) =>
      api.createPomodoroSession(
        {
          kind: input.phase,
          startedAt: input.startedAt,
          taskId: input.phase === 'focus' ? input.taskId : null,
        },
        csrf,
      ),
    onSuccess: (row, input) => acceptStart(input, row.id),
    onError: async (_error, input) => {
      if (!owns(input.owner)) return
      // A response can be lost after commit. Recover this exact start, never invent success or
      // automatically POST a duplicate session when the transport outcome is unknown.
      try {
        const rows = await api.fetchPomodoroSessions()
        const recorded = rows.find(
          (row) =>
            row.kind === input.phase &&
            row.taskId === (input.phase === 'focus' ? input.taskId : null) &&
            Date.parse(row.startedAt) === Date.parse(input.startedAt) &&
            row.endedAt === null,
        )
        if (recorded && owns(input.owner)) {
          acceptStart(input, recorded.id)
          return
        }
      } catch {
        /* Keep the failed start visibly idle; no receipt is available. */
      }
      if (owns(input.owner)) toast.error(t('toast.saveError'))
    },
    onSettled: (_row, _error, input) => {
      if (owns(input.owner)) setPomodoroBusy(false)
    },
  })
  function start(phase: Phase, settings: PomodoroSettings, taskId: string | null = null) {
    const state = getPomodoroState()
    if (!owner || !owns(owner) || state.busy || state.phase !== 'idle') return
    setPomodoroBusy(true)
    if (settings.notifications) requestNotificationPermission()
    create.mutate({
      owner,
      phase,
      settings,
      taskId,
      startedAt: new Date().toISOString(),
    })
  }
  const end = useMutation({
    mutationKey: ['personal', 'pomodoro', 'session-write'],
    mutationFn: (input: End) =>
      api.patchPomodoroSession(
        input.id,
        { completed: input.completed, endedAt: input.endedAt },
        csrf,
      ),
    onSuccess: (_row, input) => {
      if (!owns(input.owner) || getPomodoroState().sessionId !== input.id) return
      if (input.completed) {
        const cycleAfter =
          input.phase === 'focus'
            ? advanceCycle(true, input.settings.cyclesBeforeLong)
            : getPomodoroState().cycleIndex
        const next =
          input.phase === 'focus'
            ? nextPhaseAfterFocus(cycleAfter, input.settings.cyclesBeforeLong)
            : 'focus'
        if (input.settings.autoStart) input.next = next
        playPhaseEndSound(input.settings.sound, input.phase)
        const key =
          input.phase === 'focus'
            ? 'focus'
            : input.phase === 'short_break'
              ? 'shortBreak'
              : 'longBreak'
        notifyPhaseEnd(
          input.settings.notifications,
          t(`personal.pomodoro.phase.${key}`),
          t('personal.pomodoro.notification.body'),
        )
      }
      stopToIdle()
      refresh(input.owner)
    },
    onError: (_error, input) => {
      if (owns(input.owner)) toast.error(t('toast.saveError'))
    },
    onSettled: (_row, error, input) => {
      if (!owns(input.owner)) return
      setPomodoroBusy(false)
      if (!error && input.next) start(input.next, input.settings, input.taskId)
    },
  })
  function finish(completed: boolean, settings: PomodoroSettings, taskId: string | null = null) {
    const state = getPomodoroState()
    if (!owner || !owns(owner) || state.busy || state.phase === 'idle' || !state.sessionId) return
    const receipt = preparePomodoroEnd(completed)
    setPomodoroBusy(true)
    end.mutate({ owner, id: state.sessionId, phase: state.phase, settings, taskId, ...receipt })
  }
  return { start, finish }
}

export function useSavePomodoroSettings() {
  const qc = useQueryClient()
  const me = useMeQuery()
  const owner = me.data?.user.id
  const pending = useIsMutating({ mutationKey: SETTINGS_KEY }) > 0
  const mutation = useMutation({
    mutationKey: SETTINGS_KEY,
    mutationFn: (input: PatchPomodoroSettingsInput) =>
      api.patchPomodoroSettings(input, me.data?.csrfToken ?? ''),
    onSuccess: (settings) => {
      if (qc.getQueryData<Me | null>(['me'])?.user.id === owner)
        qc.setQueryData(['personal', 'pomodoro', 'settings'], settings)
    },
  })
  return {
    ...mutation,
    isPending: pending,
    mutate: (...args: Parameters<typeof mutation.mutate>) => {
      if (qc.isMutating({ mutationKey: SETTINGS_KEY })) return
      mutation.mutate(...args)
    },
  }
}
