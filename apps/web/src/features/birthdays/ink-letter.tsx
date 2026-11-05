import * as React from 'react'
import { useT } from '@devon/i18n'
import { layoutLetter } from './handwriting.js'
import { WaxSeal } from './wax-seal.js'

export function InkLetter({
  message,
  complete,
  reducedMotion,
  onComplete,
}: {
  message: string
  complete: boolean
  reducedMotion: boolean
  onComplete: () => void
}) {
  const t = useT()
  const host = React.useRef<HTMLDivElement>(null)
  const svg = React.useRef<SVGSVGElement>(null)
  const quill = React.useRef<SVGGElement>(null)
  const finished = React.useRef(onComplete)
  finished.current = onComplete
  const [width, setWidth] = React.useState(680)
  const letter = React.useMemo(() => layoutLetter(message, width), [message, width])
  React.useLayoutEffect(() => {
    const element = host.current
    if (!element) return
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setWidth(Math.max(240, Math.round(entry.contentRect.width)))
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  React.useEffect(() => {
    const paths = [...(svg.current?.querySelectorAll<SVGPathElement>('[data-ink]') ?? [])]
    const lengths = paths.map((path) => path.getTotalLength())
    paths.forEach((path, i) => {
      path.style.strokeDasharray = String(lengths[i])
      path.style.strokeDashoffset = complete || reducedMotion ? '0' : String(lengths[i])
      path.style.opacity = complete || reducedMotion ? '1' : '0'
    })
    if (complete || reducedMotion) {
      if (quill.current) quill.current.style.opacity = '0'
      return
    }
    let frame = 0,
      previous = -1
    const lift = 12
    const distance = lengths.reduce((sum, length, i) => sum + length * letter.strokes[i]!.scale, 0)
    const speed = distance / Math.min(24_000, Math.max(15_000, message.length * 65))
    const timeline = lengths.map((length, i) => (length * letter.strokes[i]!.scale) / speed + lift)
    let start: number | null = null
    let hiddenAt: number | null = null
    const visibility = () => {
      if (document.visibilityState !== 'visible') hiddenAt = performance.now()
      else if (hiddenAt !== null) {
        if (start !== null) start += performance.now() - hiddenAt
        hiddenAt = null
      }
    }
    document.addEventListener('visibilitychange', visibility)
    function draw(now: number) {
      start ??= now
      let elapsed = now - start - 1100
      if (elapsed < 0) {
        frame = requestAnimationFrame(draw)
        return
      }
      let index = 0
      while (index < timeline.length && elapsed > timeline[index]!) {
        elapsed -= timeline[index]!
        index++
      }
      if (index === timeline.length) {
        paths.forEach((path) => {
          path.style.strokeDashoffset = '0'
          path.style.opacity = '1'
        })
        if (quill.current) quill.current.style.opacity = '0'
        finished.current()
        return
      }
      for (let i = previous; i < index; i++) {
        if (paths[i]) {
          paths[i]!.style.strokeDashoffset = '0'
          paths[i]!.style.opacity = '1'
        }
      }
      previous = index
      const path = paths[index]!
      const stroke = letter.strokes[index]!
      const proportion = Math.min(1, elapsed / Math.max(1, timeline[index]! - lift))
      path.style.opacity = '1'
      path.style.strokeDashoffset = String(lengths[index]! * (1 - proportion))
      const point = path.getPointAtLength(lengths[index]! * proportion)
      if (quill.current) {
        quill.current.style.opacity = proportion < 1 ? '1' : '.82'
        quill.current.setAttribute(
          'transform',
          `translate(${stroke.x + point.x * stroke.scale} ${stroke.y - point.y * stroke.scale}) rotate(${Math.sin(now / 180) * 2}) scale(${width < 430 ? 0.7 : 1})`,
        )
      }
      frame = requestAnimationFrame(draw)
    }
    frame = requestAnimationFrame(draw)
    return () => {
      cancelAnimationFrame(frame)
      document.removeEventListener('visibilitychange', visibility)
    }
  }, [letter, complete, reducedMotion, message, width])
  return (
    <div ref={host} className="birthday-ink">
      <p className="sr-only">
        {message} {t('birthday.signatureAccessible')}
      </p>
      <svg
        ref={svg}
        aria-hidden="true"
        viewBox={`0 0 ${width} ${letter.height}`}
        width="100%"
        className="birthday-ink-canvas"
      >
        <defs>
          <linearGradient id="birthday-feather" x1="0" y1="0" x2="1" y2="1">
            <stop stopColor="#f7edce" />
            <stop offset=".5" stopColor="#fffaf0" />
            <stop offset="1" stopColor="#bb9563" />
          </linearGradient>
          <linearGradient id="birthday-nib">
            <stop stopColor="#e9c67e" />
            <stop offset="1" stopColor="#8c602d" />
          </linearGradient>
        </defs>
        <g
          fill="none"
          stroke="#243d51"
          strokeWidth="17"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          {letter.strokes.map((stroke, index) => (
            <path
              key={index}
              data-ink=""
              d={stroke.path}
              strokeWidth={1.05 / stroke.scale}
              transform={`translate(${stroke.x} ${stroke.y}) scale(${stroke.scale} ${-stroke.scale})`}
              opacity={complete || reducedMotion ? 1 : 0}
            />
          ))}
        </g>
        <g ref={quill} className="birthday-quill" opacity="0">
          <path
            d="M11-24C17-67 37-111 84-155C94-115 79-61 27-36L15-24Z"
            fill="url(#birthday-feather)"
            stroke="#c4a575"
            strokeWidth=".7"
          />
          <path
            d="M16-32Q37-75 80-145M32-64L20-73M39-78L29-88M48-94L39-105M56-109L49-117M40-78L63-78M49-94L74-96M58-110L82-117"
            stroke="#b79c74"
            strokeWidth=".8"
            fill="none"
            opacity=".7"
          />
          <path
            d="M0 0L6-26L16-37L20-29L13-15Z"
            fill="url(#birthday-nib)"
            stroke="#9a713b"
            strokeWidth=".6"
          />
          <path d="M0 0L11-23" fill="none" stroke="#72522e" strokeWidth=".65" />
          <circle cx="11" cy="-24" r="1.4" fill="#66503a" />
        </g>
      </svg>
      <WaxSeal {...letter.seal} reducedMotion={reducedMotion} start={complete || reducedMotion} />
    </div>
  )
}
