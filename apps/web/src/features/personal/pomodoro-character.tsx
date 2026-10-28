import { useReducedMotion } from '@devon/ui'
import * as React from 'react'
import { TomatoDirector, type TomatoActivity, type TomatoContext } from './lib/tomato-director.js'

// Import URLs, not pixels: only the current/next activity and completion are downloaded.
const sheets = import.meta.glob<string>('./assets/*-sprite.webp', {
  eager: true,
  query: '?url',
  import: 'default',
})
const urlFor = (clip: TomatoActivity) => sheets[`./assets/${clip}-sprite.webp`]!
const decoded = new Map<TomatoActivity, Promise<void>>()
function prepare(clip: TomatoActivity): Promise<void> {
  let pending = decoded.get(clip)
  if (!pending) {
    const image = new Image()
    image.src = urlFor(clip)
    pending = image.decode()
    decoded.set(clip, pending)
    void pending.catch(() => decoded.delete(clip))
  }
  return pending
}

type Scene = { clip: TomatoActivity; serial: number; duration: number; hold: number }
const initial: Scene = { clip: 'focus', serial: 0, duration: 2600, hold: 900 }

/** One 24-frame story at a time, with short natural rests and no repeated playlist.
 * Image decoding precedes transitions; hidden/offscreen views pause without advancing the story. */
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
  const [director] = React.useState(() => new TomatoDirector())
  const [pageVisible, setPageVisible] = React.useState(true)
  const [onScreen, setOnScreen] = React.useState(true)
  const [scene, setScene] = React.useState<Scene>(initial)
  const [previous, setPrevious] = React.useState<Scene | null>(null)
  const [settled, setSettled] = React.useState(false)
  const mode = completed ? 'complete' : paused ? 'paused' : phase === 'focus' ? 'focus' : 'break'
  const enabled = animate && !reduced && pageVisible && onScreen
  const activeScene = React.useRef(scene)
  const lastMode = React.useRef('focus')

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

  const show = React.useCallback((clip: TomatoActivity) => {
    const old = activeScene.current
    const next = {
      clip,
      serial: old.serial + 1,
      duration: clip === 'complete' ? 2000 : 2500 + Math.floor(Math.random() * 600),
      hold: 700 + Math.floor(Math.random() * 1100),
    }
    activeScene.current = next
    setPrevious(old)
    setScene(next)
    setSettled(false)
  }, [])

  React.useEffect(() => {
    void prepare('complete').catch(() => {})
  }, [])

  React.useEffect(() => {
    if (!enabled || mode === 'complete' || mode === 'paused') return
    const clip = director.peek(mode)
    void prepare(clip).catch(() => director.exclude(clip))
  }, [director, enabled, mode, scene.serial])

  React.useEffect(() => {
    if (lastMode.current === mode) return
    lastMode.current = mode
    let current = true
    const clip = mode === 'complete' ? 'complete' : mode === 'paused' ? 'nap' : director.next(mode)
    void prepare(clip)
      .then(() => {
        if (current) show(clip)
      })
      .catch(() => {
        director.exclude(clip)
      })
    return () => {
      current = false
    }
  }, [director, mode, show])

  React.useEffect(() => {
    if (!enabled || !settled || mode === 'complete' || mode === 'paused') return
    let current = true
    const timeout = window.setTimeout(async () => {
      const clip = director.next(mode as TomatoContext)
      try {
        await prepare(clip)
        if (current) show(clip)
      } catch {
        director.exclude(clip)
        // A failed optional image cannot leave an empty character or affect the clock.
        if (current) show('focus')
      }
    }, scene.hold)
    return () => {
      current = false
      window.clearTimeout(timeout)
    }
  }, [director, enabled, mode, scene.hold, settled, show])

  return (
    <div
      ref={host}
      className="pomodoro-character-scene"
      aria-hidden="true"
      data-motion={enabled ? 'on' : 'off'}
      data-paused={paused}
      data-mode={mode}
      data-activity={scene.clip}
      data-story-complete={settled}
    >
      <div className="pomodoro-character-halo" />
      <div className="pomodoro-character-platform" />
      {[previous, scene]
        .filter((entry): entry is Scene => entry !== null)
        .map((entry) => (
          <div
            key={entry.serial}
            className="pomodoro-character-layer"
            data-active={entry.serial === scene.serial}
          >
            <div
              className="pomodoro-character-sprite"
              data-sequence={entry.clip}
              style={{
                backgroundImage: `url("${urlFor(entry.clip)}")`,
                animationDuration: `${entry.duration}ms`,
              }}
              onAnimationEnd={(event) => {
                if (
                  entry.serial === activeScene.current.serial &&
                  event.animationName === 'pomodoro-character-frames'
                )
                  setSettled(true)
              }}
            />
          </div>
        ))}
      <span className="pomodoro-particle" />
      <span className="pomodoro-particle" />
      <span className="pomodoro-particle" />
    </div>
  )
}
