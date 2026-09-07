import { describe, expect, it, vi, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import * as React from 'react'
import { MotionProvider } from './motion-provider.js'
import { PageTransition } from './page-transition.js'
import { Stagger, StaggerItem } from './stagger.js'
import { Reveal, BlurFade } from './reveal.js'
import { HoverLift, PressScale } from './hover-lift.js'
import { Collapsible } from './collapsible.js'
import { Shimmer } from './shimmer.js'
import { Celebrate } from './celebrate.js'
import { AnimatedCheck } from './animated-check.js'
import { ProgressRing } from './progress-ring.js'
import { AmbientGradient, IdleFloat } from './ambient-gradient.js'
import { HoverCard, HoverCardTrigger, HoverCardContent } from './hover-card.js'
import { supportsViewTransitions, startViewTransition } from './view-transition.js'
import { STAGGER_STEP, RISE_PX, S_MICRO, DUR_MICRO } from './tokens.js'

/** Every test below asserts a *contract*, not a frame: the piece renders its content, and the
 * reduced-motion branch still renders that same content (DESIGN.md §2.5 -- motion is replaced,
 * never deleted, so nothing may disappear when the OS setting flips). */

function mockReducedMotion(reduce: boolean): void {
  window.matchMedia = ((query: string) => ({
    matches: reduce && query.includes('prefers-reduced-motion'),
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia
}

afterEach(() => {
  mockReducedMotion(false)
  vi.restoreAllMocks()
})

describe('motion tokens (DESIGN.md §2.5)', () => {
  it('converts the CSS millisecond tokens to the seconds `motion` wants', () => {
    expect(S_MICRO).toBe(DUR_MICRO / 1000)
  })

  it('keeps the catalogue numbers UI-OVERHAUL.md §3 names', () => {
    expect(STAGGER_STEP).toBe(0.024)
    expect(RISE_PX).toBe(8)
  })
})

describe('every catalogue piece renders its content in both motion modes', () => {
  // Factories, not elements: an array literal of JSX would need a `key` on every entry, which says
  // nothing about the contract under test.
  const cases: Array<[string, () => React.ReactElement]> = [
    ['PageTransition', () => <PageTransition routeKey="/a">content</PageTransition>],
    [
      'Stagger',
      () => (
        <Stagger>
          <StaggerItem>content</StaggerItem>
        </Stagger>
      ),
    ],
    ['Reveal', () => <Reveal>content</Reveal>],
    ['BlurFade', () => <BlurFade>content</BlurFade>],
    ['HoverLift', () => <HoverLift>content</HoverLift>],
    ['PressScale', () => <PressScale>content</PressScale>],
    ['Collapsible', () => <Collapsible open>content</Collapsible>],
    [
      'AnimatedCheck',
      () => (
        <span>
          content
          <AnimatedCheck checked />
        </span>
      ),
    ],
    [
      'ProgressRing',
      () => (
        <ProgressRing value={40} label="Progress">
          content
        </ProgressRing>
      ),
    ],
    ['IdleFloat', () => <IdleFloat>content</IdleFloat>],
  ]

  for (const [name, node] of cases) {
    it(`${name} keeps its children with motion on`, () => {
      mockReducedMotion(false)
      render(<MotionProvider>{node()}</MotionProvider>)
      expect(screen.getByText(/content/)).toBeInTheDocument()
    })

    it(`${name} keeps its children under prefers-reduced-motion`, () => {
      mockReducedMotion(true)
      render(<MotionProvider>{node()}</MotionProvider>)
      expect(screen.getByText(/content/)).toBeInTheDocument()
    })
  }
})

describe('Collapsible', () => {
  it('removes its content when closed and restores it when open', () => {
    const { rerender } = render(<Collapsible open={false}>panel</Collapsible>)
    expect(screen.queryByText('panel')).not.toBeInTheDocument()
    rerender(<Collapsible open>panel</Collapsible>)
    expect(screen.getByText('panel')).toBeInTheDocument()
  })
})

describe('Shimmer', () => {
  it('animates by default and goes static (but still visible) under reduced motion', () => {
    mockReducedMotion(false)
    const { container, unmount } = render(<Shimmer className="h-4 w-20" />)
    expect(container.firstElementChild).toHaveClass('devon-shimmer')
    unmount()

    mockReducedMotion(true)
    const reduced = render(<Shimmer className="h-4 w-20" />)
    const el = reduced.container.firstElementChild as HTMLElement
    expect(el).not.toHaveClass('devon-shimmer')
    // Replaced, not deleted: the block is still clearly a placeholder.
    expect(el.style.opacity).toBe('0.75')
  })
})

describe('Celebrate (DESIGN.md §2.5: a coin-sized 12-particle burst, nothing more)', () => {
  it('renders exactly twelve particles when it fires', () => {
    mockReducedMotion(false)
    const { container } = render(
      <span className="relative">
        <Celebrate play />
      </span>,
    )
    const burst = container.querySelector('[aria-hidden="true"]')
    expect(burst?.querySelectorAll('span').length).toBe(12)
  })

  it('renders nothing while idle', () => {
    const { container } = render(
      <span className="relative">
        <Celebrate play={false} />
      </span>,
    )
    const burst = container.querySelector('[aria-hidden="true"]')
    expect(burst?.querySelectorAll('span').length).toBe(0)
  })

  it('replaces the burst with a single ring under reduced motion', () => {
    mockReducedMotion(true)
    const { container } = render(
      <span className="relative">
        <Celebrate play />
      </span>,
    )
    const burst = container.querySelector('[aria-hidden="true"]')
    expect(burst?.querySelectorAll('span').length).toBe(1)
  })
})

describe('ProgressRing', () => {
  it('exposes a progressbar role with a clamped value and a name', () => {
    render(<ProgressRing value={140} label="Sprint" />)
    const bar = screen.getByRole('progressbar', { name: 'Sprint' })
    expect(bar).toHaveAttribute('aria-valuenow', '100')
  })

  it('clamps a negative value to zero rather than drawing a reversed arc', () => {
    render(<ProgressRing value={-20} label="Sprint" />)
    expect(screen.getByRole('progressbar', { name: 'Sprint' })).toHaveAttribute(
      'aria-valuenow',
      '0',
    )
  })
})

describe('AmbientGradient (UI-OVERHAUL.md §3: auth and hub only, reduced-motion safe)', () => {
  it('drifts by default and is completely static under reduced motion', () => {
    mockReducedMotion(false)
    const { container, unmount } = render(<AmbientGradient />)
    expect(container.querySelectorAll('.devon-ambient-drift').length).toBe(2)
    unmount()

    mockReducedMotion(true)
    const reduced = render(<AmbientGradient />)
    expect(reduced.container.querySelectorAll('.devon-ambient-drift').length).toBe(0)
    // The gradient itself stays -- only the drift stops.
    expect(reduced.container.querySelectorAll('span').length).toBe(2)
  })

  it('is hidden from assistive technology', () => {
    const { container } = render(<AmbientGradient />)
    expect(container.firstElementChild).toHaveAttribute('aria-hidden', 'true')
  })
})

describe('HoverCard', () => {
  it('renders its trigger and keeps the card closed until hovered', () => {
    render(
      <HoverCard>
        <HoverCardTrigger>Person</HoverCardTrigger>
        <HoverCardContent>Details</HoverCardContent>
      </HoverCard>,
    )
    expect(screen.getByText('Person')).toBeInTheDocument()
    expect(screen.queryByText('Details')).not.toBeInTheDocument()
  })
})

describe('view transitions', () => {
  it('reports no support in jsdom and still runs the update', () => {
    expect(supportsViewTransitions()).toBe(false)
    const update = vi.fn()
    void startViewTransition(update)
    expect(update).toHaveBeenCalledOnce()
  })

  it('runs the update inside the transition when the API exists', async () => {
    const update = vi.fn()
    const start = vi.fn((cb: () => void) => {
      cb()
      return { finished: Promise.resolve() }
    })
    Object.defineProperty(document, 'startViewTransition', {
      configurable: true,
      writable: true,
      value: start,
    })
    await startViewTransition(update)
    expect(start).toHaveBeenCalledOnce()
    expect(update).toHaveBeenCalledOnce()
    // @ts-expect-error -- removing the test double again
    delete document.startViewTransition
  })

  it('does not start one when the user asked for reduced motion', () => {
    mockReducedMotion(true)
    const start = vi.fn()
    Object.defineProperty(document, 'startViewTransition', {
      configurable: true,
      writable: true,
      value: start,
    })
    const update = vi.fn()
    void startViewTransition(update)
    expect(start).not.toHaveBeenCalled()
    expect(update).toHaveBeenCalledOnce()
    // @ts-expect-error -- removing the test double again
    delete document.startViewTransition
  })
})
