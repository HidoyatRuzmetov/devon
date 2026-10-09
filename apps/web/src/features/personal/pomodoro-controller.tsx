import * as React from 'react'
import { useMeQuery } from '../../lib/session.js'
import { usePomodoroSettingsQuery } from './use-personal.js'
import { usePomodoroControls } from './pomodoro-controls.js'
import {
  remainingMs,
  scopePomodoroState,
  usePomodoroRemainingSec,
  usePomodoroState,
} from './pomodoro-engine.js'

/** One automatic completion boundary stays mounted across routes, scoped to the current owner. */
export function PomodoroController() {
  const me = useMeQuery()
  const owner = me.data?.user.id ?? null
  React.useEffect(() => scopePomodoroState(owner), [owner])
  return owner ? <OwnedPomodoroController key={owner} /> : null
}

function OwnedPomodoroController() {
  const state = usePomodoroState()
  const remainingSec = usePomodoroRemainingSec()
  const settings = usePomodoroSettingsQuery().data
  const controls = usePomodoroControls()
  const handledEnd = React.useRef(false)
  React.useEffect(() => {
    if (!settings) return
    if (state.phase === 'idle' || state.remainingAtPause !== null || remainingMs() > 0) {
      handledEnd.current = false
      return
    }
    if (handledEnd.current || state.busy || !state.sessionId || state.pendingEnd) return
    handledEnd.current = true
    controls.finish(true, settings, state.taskId)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the receipt boundary reads current owner/state; ticks arm only one automatic end.
  }, [state, remainingSec, settings])
  return null
}
