import * as React from 'react'
import { useT } from '@devon/i18n'
import {
  BookOpen,
  Check,
  CalendarDays,
  FolderKanban,
  Home,
  ListChecks,
  UserRound,
  Users,
} from 'lucide-react'

const chapterIcons = [UserRound, Home, ListChecks, FolderKanban, CalendarDays, Users, Check]
export function TourFinale({ onDone }: { onDone: () => void }) {
  const t = useT()
  const done = React.useRef(onDone)
  done.current = onDone
  React.useLayoutEffect(() => {
    const panel = document.querySelector<HTMLElement>('[data-onboarding-finale]')!
    const copy = panel.querySelector<HTMLElement>('.onboarding-finale-copy')!
    const book = panel.querySelector<SVGElement>('.onboarding-finale-book')!
    const atmosphere = document.querySelector<HTMLElement>('.onboarding-finale-atmosphere')!
    const halo = document.querySelector<HTMLElement>('.onboarding-finale-halo')!
    const landing = document.querySelector<HTMLElement>('.onboarding-finale-landing')!
    const anchor = document.querySelector<HTMLElement>('[data-onboarding="help"]')
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const animations: Animation[] = []
    let landed: ReturnType<typeof setTimeout> | undefined
    const animate = (el: Element, frames: Keyframe[], options: KeyframeAnimationOptions) => {
      const animation = el.animate(frames, { fill: 'both', ...options })
      animations.push(animation)
      return animation
    }
    if (reduced) {
      panel.style.opacity = '1'
      copy.style.opacity = '1'
    } else {
      anchor?.scrollIntoView({ block: 'nearest', behavior: 'instant' })
      const from = panel.getBoundingClientRect()
      const destination = (anchor?.querySelector('svg') ?? anchor)?.getBoundingClientRect()
      const dx = destination ? destination.x + destination.width / 2 - from.x - from.width / 2 : 0
      const dy = destination ? destination.y + destination.height / 2 - from.y - from.height / 2 : 0
      const full = { width: `${from.width}px`, height: `${from.height}px`, borderRadius: '28px' }
      const small = { width: '72px', height: '72px', borderRadius: '22px' }
      const frames: Keyframe[] = [
        {
          ...full,
          opacity: 0,
          transform: 'translateY(18px) scale(.97)',
          offset: 0,
          easing: 'cubic-bezier(.2,.8,.2,1)',
        },
        { ...full, opacity: 1, transform: 'translateY(0) scale(1)', offset: 380 / 4300 },
        {
          ...full,
          opacity: 1,
          transform: 'translateY(0) scale(1)',
          offset: 2700 / 4300,
          easing: 'cubic-bezier(.6,0,.2,1)',
        },
        { ...small, opacity: 1, transform: 'translate(0,0) scale(1)', offset: 3500 / 4300 },
      ]
      // A continuous curved flight, landing on the book icon rather than the button's text.
      for (let n = 1; n <= 30; n++) {
        const t = n / 30,
          u = t * t * (3 - 2 * t)
        const x = 2 * (1 - u) * u * (dx * 0.65) + u * u * dx
        const y = 2 * (1 - u) * u * (dy * 0.2 - 55) + u * u * dy
        frames.push({
          ...small,
          offset: (3500 + 800 * t) / 4300,
          transform: `translate(${x}px,${y}px) scale(${1 - 0.55 * u})`,
          opacity: t < 0.8 ? 1 : (1 - t) / 0.2,
        })
      }
      animate(panel, frames, { duration: 4300, easing: 'linear' })
      animate(
        copy,
        [
          { opacity: 0, transform: 'translateY(8px)', offset: 0 },
          { opacity: 1, transform: 'none', offset: 450 / 2700 },
          { opacity: 1, transform: 'none', offset: 2300 / 2700 },
          { opacity: 0, transform: 'translateY(-6px)', offset: 1 },
        ],
        { duration: 2700 },
      )
      animate(
        book,
        [
          { opacity: 0, transform: 'scale(.85)' },
          { opacity: 1, transform: 'scale(1)' },
        ],
        { delay: 3100, duration: 350, easing: 'ease-out' },
      )
      panel.querySelectorAll('.onboarding-finale-chapter').forEach((icon, i) =>
        animate(
          icon,
          [
            { opacity: 0, transform: 'translateY(6px)' },
            { opacity: 1, transform: 'none' },
          ],
          { delay: 200 + i * 70, duration: 300, easing: 'ease-out' },
        ),
      )
      animate(
        atmosphere,
        [
          { opacity: 0, offset: 0 },
          { opacity: 1, offset: 0.12 },
          { opacity: 1, offset: 0.64 },
          { opacity: 0, offset: 1 },
        ],
        { duration: 4500 },
      )
      animate(
        halo,
        [
          { opacity: 0, transform: 'scale(.6)' },
          { opacity: 0.85, transform: 'scale(1.25)', offset: 0.4 },
          { opacity: 0, transform: 'scale(1.7)' },
        ],
        { duration: 4200 },
      )
      if (anchor) {
        const bounds = anchor.getBoundingClientRect()
        Object.assign(landing.style, {
          left: `${bounds.left}px`,
          top: `${bounds.top}px`,
          width: `${bounds.width}px`,
          height: `${bounds.height}px`,
        })
        landing.querySelectorAll('.onboarding-landing-ring').forEach((ring, i) => {
          animate(
            ring,
            [
              { opacity: 0, transform: 'scale(.98)' },
              { opacity: i === 0 ? 0.7 : 0.35, transform: 'scale(1)', offset: 0.12 },
              { opacity: 0, transform: `scale(${i === 0 ? '1.12,1.55' : '1.21,1.95'})` },
            ],
            { delay: 4270 + i * 100, duration: 720, easing: 'cubic-bezier(.16,1,.3,1)' },
          )
        })
        const shine = landing.querySelector('.onboarding-landing-shine')!
        animate(
          shine,
          [
            { opacity: 0, transform: 'translateX(-120%) skewX(-18deg)' },
            { opacity: 0.85, transform: 'translateX(-60%) skewX(-18deg)', offset: 0.2 },
            { opacity: 0.55, transform: 'translateX(180%) skewX(-18deg)', offset: 0.75 },
            { opacity: 0, transform: 'translateX(260%) skewX(-18deg)' },
          ],
          { delay: 4300, duration: 700, easing: 'ease-out' },
        )
        landed = setTimeout(() => {
          animate(
            anchor,
            [
              { boxShadow: '0 0 0 0 transparent', offset: 0 },
              {
                boxShadow: '0 0 22px 4px color-mix(in srgb,var(--color-primary) 24%,transparent)',
                offset: 0.2,
              },
              { boxShadow: '0 0 0 0 transparent', offset: 1 },
            ],
            { duration: 820, easing: 'ease-out' },
          )
          const icon = anchor.querySelector('svg')
          if (icon)
            animate(
              icon,
              [
                { transform: 'scale(1)' },
                { transform: 'scale(1.25)', offset: 0.28 },
                { transform: 'scale(.96)', offset: 0.65 },
                { transform: 'scale(1)' },
              ],
              { duration: 560, easing: 'ease-out' },
            )
        }, 4270)
      }
    }
    const timer = setTimeout(
      () => {
        done.current()
        anchor?.focus({ preventScroll: true })
      },
      reduced ? 1200 : 5150,
    )
    return () => {
      clearTimeout(timer)
      if (landed) clearTimeout(landed)
      animations.forEach((a) => a.cancel())
    }
  }, [])
  return (
    <div
      className="onboarding-finale-scene fixed inset-0 z-[10020] grid place-items-center"
      role="status"
    >
      <div className="onboarding-finale-atmosphere absolute inset-0" />
      <div
        className="onboarding-finale-halo absolute size-96 max-w-[85vw] rounded-full"
        aria-hidden="true"
      />
      <div
        className="onboarding-finale-landing pointer-events-none absolute rounded-xl"
        aria-hidden="true"
      >
        {[0, 1].map((i) => (
          <span
            key={i}
            className="onboarding-landing-ring absolute inset-0 rounded-xl border border-primary/60 opacity-0"
          />
        ))}
        <span className="absolute inset-0 overflow-hidden rounded-xl">
          <span
            className="onboarding-landing-shine absolute inset-y-0 left-0 w-1/2 opacity-0"
            style={{
              background:
                'linear-gradient(90deg,transparent,color-mix(in srgb,var(--color-primary) 22%,transparent),transparent)',
            }}
          />
        </span>
      </div>
      <div
        data-onboarding-finale
        className="onboarding-finale-card relative grid min-w-0 h-[300px] w-[min(550px,92vw)] place-items-center overflow-hidden rounded-[28px] border border-primary/20 bg-card shadow-2xl"
      >
        <BookOpen
          className="onboarding-finale-book absolute size-8 text-primary"
          aria-hidden="true"
        />
        <div className="onboarding-finale-copy w-[min(490px,82vw)] px-5 text-center">
          <div className="mb-6 flex justify-center gap-2" aria-hidden="true">
            {chapterIcons.map((Icon, i) => (
              <span
                key={i}
                className="onboarding-finale-chapter grid size-10 place-items-center rounded-xl border border-primary/15 bg-primary/5 text-primary"
              >
                <Icon className="size-4" />
              </span>
            ))}
          </div>
          <p
            translate="no"
            className="text-caption font-semibold uppercase tracking-[.2em] text-primary"
          >
            WorkPortal
          </p>
          <h2 className="mt-3 font-display text-h2">{t('onboarding.finishedTitle')}</h2>
          <p className="mx-auto mt-3 max-w-sm text-body text-muted-foreground">
            {t('onboarding.finishedBody')}
          </p>
        </div>
      </div>
    </div>
  )
}
