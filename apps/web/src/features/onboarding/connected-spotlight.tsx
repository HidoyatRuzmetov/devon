import * as React from 'react'
import { spotlightPath, type SpotlightRect } from './spotlight-shape.js'

export function visibleElement(selector: string): HTMLElement | undefined {
  return [...document.querySelectorAll<HTMLElement>(selector)].find((el) => {
    const r = el.getBoundingClientRect()
    return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden'
  })
}
export function contentTop() {
  const header = visibleElement('[data-onboarding-topbar]')?.getBoundingClientRect()
  return Math.max(6, header ? header.bottom + 8 : 6)
}
export function spotlightRects(
  target: HTMLElement,
  navigation?: string,
  tab?: string,
): SpotlightRect[] {
  const elements = [target]
  if (navigation) {
    const nav =
      visibleElement(`[data-onboarding-nav="${navigation}"], nav a[href="${navigation}"]`) ??
      (navigation.startsWith('/account')
        ? visibleElement('[data-onboarding-settings-picker]')
        : undefined) ??
      visibleElement('[data-onboarding-menu]')
    if (nav) elements.push(nav)
  }
  if (tab) {
    const selected = visibleElement(tab)
    if (selected) elements.push(selected)
  }
  const rects = elements
    .map((el) => {
      const r = el.getBoundingClientRect(),
        p = el === target ? 7 : 4
      const x = Math.max(6, r.left - p),
        y = Math.max(el.closest('#main') ? contentTop() : 6, r.top - p)
      return {
        x,
        y,
        width: Math.max(0, Math.min(window.innerWidth - 6, r.right + p) - x),
        height: Math.max(0, Math.min(window.innerHeight - 6, r.bottom + p) - y),
      }
    })
    .filter((r) => r.width > 0 && r.height > 0) as SpotlightRect[]
  return rects
}

export function ConnectedSpotlight({
  target,
  navigation,
  tab,
}: {
  target: HTMLElement
  navigation?: string | undefined
  tab?: string | undefined
}) {
  const [shape, setShape] = React.useState('')
  React.useLayoutEffect(() => {
    let frame = 0
    const measure = () => {
      const rects = spotlightRects(target, navigation, tab)
      setShape(spotlightPath(rects))
    }
    const update = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(measure)
    }
    const observer = new ResizeObserver(update)
    observer.observe(target)
    measure()
    window.addEventListener('resize', update)
    window.addEventListener('scroll', update, true)
    return () => {
      observer.disconnect()
      cancelAnimationFrame(frame)
      window.removeEventListener('resize', update)
      window.removeEventListener('scroll', update, true)
    }
  }, [target, navigation, tab])
  return (
    <svg
      data-onboarding-connected
      aria-hidden="true"
      className="onboarding-connected-spotlight"
      width="100%"
      height="100%"
    >
      <path
        d={`M0 0 H${innerWidth} V${innerHeight} H0 Z ${shape}`}
        fill="rgba(9,18,32,.58)"
        fillRule="evenodd"
      />
      <path
        d={shape}
        fill="none"
        stroke="var(--color-primary)"
        strokeOpacity=".7"
        strokeWidth="1.5"
      />
    </svg>
  )
}
