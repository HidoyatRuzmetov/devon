import * as React from 'react'
import { createPortal } from 'react-dom'
import { useT } from '@devon/i18n'
import { IconButton } from '@devon/ui'
import { Pause, Play, RotateCcw, Volume2, VolumeX } from 'lucide-react'

const DURATION = 120_000
/** A deadline, rather than interval ticks, keeps background tabs and pauses accurate. */
export function CheckinTimer() {
  const t = useT()
  const [remaining, setRemaining] = React.useState(DURATION)
  const [deadline, setDeadline] = React.useState<number | null>(null)
  const [sound, setSound] = React.useState(false)
  const audio = React.useRef<AudioContext | null>(null)
  const announced = React.useRef(new Set<number>())
  const [announcement, setAnnouncement] = React.useState('')
  const seconds = Math.ceil(remaining / 1000)
  const phase =
    seconds === 0
      ? 'done'
      : deadline && seconds <= 10
        ? 'urgent'
        : deadline && seconds <= 20
          ? 'warning'
          : 'quiet'
  React.useEffect(() => {
    if (deadline === null) return
    const tick = () => {
      const next = Math.max(0, deadline - Date.now())
      setRemaining(next)
      if (next === 0) setDeadline(null)
    }
    tick()
    const timer = window.setInterval(tick, 100)
    return () => window.clearInterval(timer)
  }, [deadline])
  React.useEffect(() => {
    if (![20, 10, 0].includes(seconds) || announced.current.has(seconds)) return
    announced.current.add(seconds)
    setAnnouncement(
      seconds ? t('checkins.timer.remaining', { count: seconds }) : t('checkins.timer.finished'),
    )
    const context = audio.current
    if (!sound || !context) return
    const oscillator = context.createOscillator(),
      gain = context.createGain()
    oscillator.connect(gain)
    gain.connect(context.destination)
    oscillator.frequency.setValueAtTime(seconds ? 660 : 880, context.currentTime)
    gain.gain.setValueAtTime(0.07, context.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.5)
    oscillator.start()
    oscillator.stop(context.currentTime + 0.5)
  }, [seconds, sound, t])
  React.useEffect(
    () => () => {
      void audio.current?.close()
    },
    [],
  )
  function reset() {
    setDeadline(null)
    setRemaining(DURATION)
    announced.current.clear()
    setAnnouncement('')
  }
  return (
    <>
      <div className="checkin-timer" data-phase={phase}>
        <span className="checkin-timer-digits" role="timer" aria-label={t('checkins.timer.label')}>
          {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, '0')}
        </span>
        <div className="flex justify-center">
          <IconButton
            aria-label={t(deadline ? 'checkins.timer.pause' : 'checkins.timer.start')}
            onClick={() => {
              if (deadline) {
                setRemaining(Math.max(0, deadline - Date.now()))
                setDeadline(null)
              } else {
                if (!remaining) {
                  announced.current.clear()
                  setRemaining(DURATION)
                }
                setDeadline(Date.now() + (remaining || DURATION))
              }
            }}
          >
            {deadline ? <Pause /> : <Play />}
          </IconButton>
          <IconButton aria-label={t('checkins.timer.reset')} onClick={reset}>
            <RotateCcw />
          </IconButton>
          <IconButton
            aria-label={t('checkins.timer.sound')}
            aria-pressed={sound}
            onClick={() => {
              if (!sound) {
                audio.current ??= new AudioContext()
                void audio.current.resume()
              }
              setSound(!sound)
            }}
          >
            {sound ? <Volume2 /> : <VolumeX />}
          </IconButton>
        </div>
        <span className="sr-only" role="status">
          {announcement}
        </span>
      </div>
      {phase !== 'quiet'
        ? createPortal(
            <div className="checkin-timer-edge" data-phase={phase} aria-hidden="true">
              {phase === 'done' ? <span>✦</span> : null}
            </div>,
            document.body,
          )
        : null}
    </>
  )
}
