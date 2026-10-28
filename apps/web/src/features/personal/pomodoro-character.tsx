import { useReducedMotion } from '@devon/ui'
import * as React from 'react'
import { TomatoDirector, type TomatoActivity, type TomatoContext } from './lib/tomato-director.js'
import atlas from './pomodoro-atlas.json'

// Import URLs, not pixels: only the current/next activity and completion are downloaded.
const sheets = import.meta.glob<string>('./assets/*-sprite.webp', {
  eager: true,
  query: '?url',
  import: 'default',
})
const urlFor = (clip: TomatoActivity) => sheets[`./assets/${clip}-sprite.webp`]!
const decoded = new Map<TomatoActivity, Promise<HTMLImageElement>>()
function prepare(clip: TomatoActivity): Promise<HTMLImageElement> {
  let pending = decoded.get(clip)
  if (!pending) {
    const image = new Image()
    image.src = urlFor(clip)
    pending = image.decode().then(() => image)
    decoded.set(clip, pending)
    void pending.catch(() => decoded.delete(clip))
  }
  return pending
}

type Scene = { clip: TomatoActivity; serial: number; duration: number; hold: number }
const initial: Scene = { clip: 'focus', serial: 0, duration: 3000, hold: 30000 }

/** Frame registration fixes scale/camera drift. Brief temporal blending softens the joins
 * between the 24 original poses; requestAnimationFrame stops entirely during quiet rests. */
function StoryFrames({
  scene,
  enabled,
  active,
  onComplete,
}: {
  scene: Scene
  enabled: boolean
  active: boolean
  onComplete: () => void
}) {
  const canvas = React.useRef<HTMLCanvasElement>(null)
  const elapsed = React.useRef(0)
  const complete = React.useRef(false)
  const onDone = React.useRef(onComplete)
  onDone.current = onComplete
  React.useEffect(() => {
    const node = canvas.current
    if (!node) return
    let live = true,
      frame = 0,
      last: number | null = null
    const context = node.getContext('2d')
    if (!context) return
    const poses = atlas[scene.clip]
    let image: HTMLImageElement | undefined
    const draw = () => {
      if (!image) return
      const size = Math.max(
        256,
        Math.round(node.clientWidth * Math.min(window.devicePixelRatio || 1, 2)),
      )
      if (node.width !== size) {
        node.width = size
        node.height = size
      }
      context.setTransform(size / 256, 0, 0, size / 256, 0, 0)
      context.clearRect(0, 0, 256, 256)
      context.imageSmoothingEnabled = true
      context.imageSmoothingQuality = 'high'
      const position = Math.min(23, (elapsed.current / scene.duration) * 24)
      const index = Math.floor(position)
      // Hold the crisp pose for most of each interval; dissolve only at its end.
      const fraction = Math.max(0, (position - index - 0.55) / 0.45)
      const mix = fraction * fraction * (3 - 2 * fraction)
      const paint = (i: number, opacity: number) => {
        const r = poses[i]!
        context.globalAlpha = opacity
        context.drawImage(image!, r[0]!, r[1]!, r[2]!, r[3]!, r[4]!, r[5]!, r[6]!, r[7]!)
      }
      context.globalCompositeOperation = 'source-over'
      paint(index, 1 - mix)
      if (mix > 0 && index < 23) {
        context.globalCompositeOperation = 'lighter'
        paint(index + 1, mix)
      }
      context.globalAlpha = 1
      context.globalCompositeOperation = 'source-over'
      node.dataset['frame'] = String(index)
      node.dataset['ready'] = 'true'
    }
    const tick = (now: number) => {
      if (!live) return
      if (last !== null) elapsed.current = Math.min(scene.duration, elapsed.current + now - last)
      last = now
      draw()
      if (elapsed.current < scene.duration) frame = requestAnimationFrame(tick)
      else if (!complete.current) {
        complete.current = true
        onDone.current()
      }
    }
    const resize = new ResizeObserver(draw)
    resize.observe(node)
    void prepare(scene.clip)
      .then((loaded) => {
        if (!live) return
        image = loaded
        draw()
        if (enabled && active && !complete.current) frame = requestAnimationFrame(tick)
      })
      .catch(() => {})
    return () => {
      live = false
      cancelAnimationFrame(frame)
      resize.disconnect()
    }
  }, [scene.clip, scene.duration, enabled, active])
  return (
    <canvas
      ref={canvas}
      width={512}
      height={512}
      className="pomodoro-character-sprite"
      data-sequence={scene.clip}
      data-frame-count={24}
    />
  )
}

/** One 24-frame story at a time, separated by quiet rests rather than a continuous showcase.
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
      duration: clip === 'complete' ? 2200 : 2800 + Math.floor(Math.random() * 400),
      hold: 25000 + Math.floor(Math.random() * 30000),
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
            <StoryFrames
              scene={entry}
              enabled={enabled}
              active={entry.serial === scene.serial}
              onComplete={() => {
                if (entry.serial === activeScene.current.serial) setSettled(true)
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
