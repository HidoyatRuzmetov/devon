import { contentTop, spotlightRects, visibleElement } from './connected-spotlight.js'
import type { SpotlightRect } from './spotlight-shape.js'

function intersection(a: SpotlightRect, b: SpotlightRect) {
  return (
    Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)) *
    Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y))
  )
}

/** Prefer clear space alongside the page. Use the least obstructive position only when it cannot fit. */
export function placeTourPopover(
  popover: HTMLElement,
  target: HTMLElement,
  navigation?: string,
  tab?: string,
) {
  let frame = 0
  const position = () => {
    const margin = 16,
      gap = 16
    const floor = contentTop()
    const bottom = Math.min(
      innerHeight - margin,
      visibleElement('[data-onboarding-tabbar]')?.getBoundingClientRect().top ??
        innerHeight - margin,
    )
    const rects = spotlightRects(target, navigation, tab)
    const main = rects[0]
    if (!main) return
    popover.style.maxHeight = `${Math.max(180, bottom - floor)}px`
    const widths = [
      ...new Set(
        [Math.min(360, innerWidth - margin * 2), 280, 248].filter(
          (w) => w <= innerWidth - margin * 2,
        ),
      ),
    ]
    let best: { score: number; x: number; y: number; width: number } | undefined
    widths.forEach((width) => {
      popover.style.width = `${width}px`
      const height = popover.getBoundingClientRect().height
      const clampX = (x: number) => Math.max(margin, Math.min(innerWidth - width - margin, x))
      const clampY = (y: number) => Math.max(floor, Math.min(bottom - height, y))
      const centerX = main.x + (main.width - width) / 2,
        centerY = main.y + (main.height - height) / 2
      const points = [
        [main.x - width - gap, centerY],
        [main.x + main.width + gap, centerY],
        [main.x - width - gap, main.y],
        [main.x + main.width + gap, main.y],
        [main.x + main.width - width, main.y + main.height + gap],
        [centerX, main.y - height - gap],
        [margin, bottom - height],
        [innerWidth - width - margin, bottom - height],
        [margin, floor],
        [innerWidth - width - margin, floor],
      ]
      points.forEach(([x = 0, y = 0], index) => {
        const candidate = { x: clampX(x), y: clampY(y), width, height }
        const covered = rects.reduce(
          (sum, r, i) => sum + intersection(candidate, r) * (i === 0 ? 4 : 1),
          0,
        )
        const score = covered * 20 + (widths[0]! - width) * 3 + index * 2
        if (!best || score < best.score) best = { score, x: candidate.x, y: candidate.y, width }
      })
    })
    if (best) {
      popover.style.width = `${best.width}px`
      popover.style.setProperty('--tour-left', `${best.x}px`)
      popover.style.setProperty('--tour-top', `${best.y}px`)
      popover.classList.add('onboarding-positioned-popover')
    }
  }
  const update = () => {
    cancelAnimationFrame(frame)
    frame = requestAnimationFrame(position)
  }
  const observer = new ResizeObserver(update)
  observer.observe(target)
  observer.observe(popover)
  update()
  window.addEventListener('resize', update)
  window.addEventListener('scroll', update, true)
  return () => {
    cancelAnimationFrame(frame)
    observer.disconnect()
    window.removeEventListener('resize', update)
    window.removeEventListener('scroll', update, true)
  }
}
