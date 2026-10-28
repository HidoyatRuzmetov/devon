import { useReducedMotion } from '@devon/ui'
import * as React from 'react'

/** Three original 24-frame ImageGen sequences. The timer is independent of this decorative
 * player: hidden pages and reduced motion stop animation without affecting the deadline. */
export function PomodoroCharacter({
  phase,
  paused,
  animate,
  completed,
}: {
  phase: string
  paused: boolean
  animate: boolean
  completed: boolean
}) {
  const reduced = useReducedMotion()
  const host = React.useRef<HTMLDivElement>(null)
  const [pageVisible, setPageVisible] = React.useState(true)
  const [onScreen, setOnScreen] = React.useState(true)
  React.useEffect(() => {
    const update = () => setPageVisible(!document.hidden)
    document.addEventListener('visibilitychange', update)
    update()
    return () => document.removeEventListener('visibilitychange', update)
  }, [])
  React.useEffect(() => {
    if (!host.current) return
    const observer = new IntersectionObserver(([entry]) => setOnScreen(!!entry?.isIntersecting))
    observer.observe(host.current)
    return () => observer.disconnect()
  }, [])
  const mode = completed ? 'complete' : phase === 'focus' ? 'focus' : 'break'
  return (
    <div
      ref={host}
      className="pomodoro-character-scene"
      aria-hidden="true"
      data-motion={animate && !reduced && pageVisible && onScreen ? 'on' : 'off'}
      data-paused={paused}
      data-mode={mode}
    >
      <div className="pomodoro-character-halo" />
      <div className="pomodoro-character-platform" />
      {(['focus', 'break', 'complete'] as const).map((sequence) => (
        <div key={sequence} className="pomodoro-character-layer" data-active={mode === sequence}>
          <div className="pomodoro-character-sprite" data-sequence={sequence} />
        </div>
      ))}
      <span className="pomodoro-particle" />
      <span className="pomodoro-particle" />
      <span className="pomodoro-particle" />
    </div>
  )
}
