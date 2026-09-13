import type * as React from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { getLocale, setLocale, translate } from '@devon/i18n'
import { LiveStatusPill, PresenceAvatars, type LiveStatus } from './live-indicators.js'
import { TooltipProvider } from '../primitives/tooltip.js'

// Radix tooltips need their provider; every call site is inside the app shell's one.
function renderWithTooltips(node: React.ReactNode) {
  return render(<TooltipProvider>{node}</TooltipProvider>)
}

const START = getLocale()
afterEach(() => setLocale(START))

describe('LiveStatusPill', () => {
  // The design rule this component exists to enforce: "off" is said as plainly as "live". A pill
  // that only appears when the socket is up is a pill that quietly tells people the board is live
  // when it is polling.
  it.each(['connecting', 'connected', 'off', 'error'] as const)(
    'renders a focusable, labelled pill for status="%s"',
    (status) => {
      renderWithTooltips(<LiveStatusPill status={status} />)
      const button = screen.getByRole('button')
      // Keyboard reachable: the hint lives in a tooltip, and a tooltip on a non-focusable element
      // is a tooltip a keyboard user never sees.
      expect(button).toBeInTheDocument()
      expect(button.tagName).toBe('BUTTON')
      expect(button).toHaveAccessibleName(
        `${translate(getLocale(), `realtime.status.${status === 'connected' ? 'live' : status}`)} — ${translate(
          getLocale(),
          `realtime.status.${status === 'connected' ? 'live' : status}Hint`,
        )}`,
      )
    },
  )

  it('renders nothing at all while the status is idle -- there is nothing honest to say yet', () => {
    const { container } = renderWithTooltips(<LiveStatusPill status="idle" />)
    expect(container).toBeEmptyDOMElement()
  })

  it('has copy for every status it can be handed, so no state renders an invisible pill', () => {
    const statuses: LiveStatus[] = ['idle', 'off', 'connecting', 'connected', 'error']
    for (const status of statuses) {
      if (status === 'idle') continue
      expect(
        translate('en', `realtime.status.${status === 'connected' ? 'live' : status}`),
      ).not.toBe('')
    }
  })

  it('follows the active locale', () => {
    setLocale('uz-Latn')
    const { unmount } = renderWithTooltips(<LiveStatusPill status="connected" />)
    expect(screen.getByRole('button')).toHaveTextContent('Jonli')
    unmount()
    setLocale('ru')
    renderWithTooltips(<LiveStatusPill status="connected" />)
    expect(screen.getByRole('button')).toHaveTextContent('В прямом эфире')
  })
})

describe('PresenceAvatars', () => {
  const members = [
    { userId: 'u1', name: 'Aziz Yusupov' },
    { userId: 'u2', name: 'Dilnoza Karimova' },
    { userId: 'u3', name: 'Bekzod Tursunov' },
    { userId: 'u4', name: 'Nodira Ismoilova' },
    { userId: 'u5', name: 'Sardor Hakimov' },
    { userId: 'u6', name: 'Malika Yoʻldosheva' },
  ]

  it('renders nothing when nobody else is here -- absence of people needs no widget', () => {
    const { container } = renderWithTooltips(<PresenceAvatars members={[]} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('shows at most `max` avatars and collapses the rest into a +N chip', () => {
    renderWithTooltips(<PresenceAvatars members={members} />)
    // Default max is 4 (fits the board header at 390 px), so six members => four + "+2".
    expect(screen.getByText('+2')).toBeInTheDocument()
  })

  it('never collapses when everyone fits', () => {
    renderWithTooltips(<PresenceAvatars members={members.slice(0, 3)} />)
    expect(screen.queryByText(/^\+\d+$/)).not.toBeInTheDocument()
  })

  it('names one colleague directly and counts the rest', () => {
    setLocale('en')
    const { unmount } = renderWithTooltips(<PresenceAvatars members={members.slice(0, 1)} />)
    expect(screen.getByRole('button')).toHaveAccessibleName(
      'Aziz Yusupov is looking at this board too',
    )
    unmount()
    renderWithTooltips(<PresenceAvatars members={members.slice(0, 3)} />)
    expect(screen.getByRole('button')).toHaveAccessibleName(
      'Aziz Yusupov and 2 others are looking at this board',
    )
  })
})
