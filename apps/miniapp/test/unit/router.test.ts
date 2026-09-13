// The hash router is the contract between the bot and the app: a `web_app` button carries a URL
// built from `MINIAPP_ROUTES` (`@devon/contracts`), and Telegram's `?startapp=` carries a route name
// through a deep link. If either drifts, a button in a months-old chat message opens a blank screen,
// which is exactly the failure this file is here to make impossible.
import { describe, expect, it } from 'vitest'
import { MINIAPP_ROUTES, MINIAPP_ROUTE_KEYS, isMiniappRouteKey } from '@devon/contracts'
import {
  DEFAULT_ROUTE,
  hrefFor,
  parseHash,
  routeFromStartParam,
  type Route,
} from '../../src/lib/router.js'

describe('the shared route list', () => {
  it('round-trips every route the bot can build a button for', () => {
    for (const key of MINIAPP_ROUTE_KEYS) {
      const route: Route = { name: key }
      expect(hrefFor(route)).toBe(MINIAPP_ROUTES[key])
      expect(parseHash(MINIAPP_ROUTES[key])).toEqual(route)
    }
  })

  it('covers every screen the tab bar and the bot menu reference', () => {
    // Adding a screen without adding it here is the drift this asserts against.
    expect([...MINIAPP_ROUTE_KEYS].sort()).toEqual([
      'board',
      'events',
      'fields',
      'focus',
      'inbox',
      'setup',
      'today',
    ])
  })

  it('rejects an unknown key instead of guessing', () => {
    expect(isMiniappRouteKey('inbox')).toBe(true)
    expect(isMiniappRouteKey('inboxx')).toBe(false)
    expect(isMiniappRouteKey('__proto__')).toBe(false)
    expect(isMiniappRouteKey('constructor')).toBe(false)
  })
})

describe('parseHash', () => {
  it('treats an empty, bare or unknown hash as the default screen', () => {
    for (const hash of ['', '#', '#/', '#/nowhere', '#/today/extra/segments/ignored']) {
      expect(parseHash(hash).name).toBe(DEFAULT_ROUTE.name)
    }
  })

  it('reads the id out of a card or an event route', () => {
    expect(parseHash('#/card/9f2a')).toEqual({ name: 'card', cardId: '9f2a' })
    expect(parseHash('#/event/7b11')).toEqual({ name: 'event', eventId: '7b11' })
  })

  it('falls back to the default when the id is missing', () => {
    expect(parseHash('#/card').name).toBe('today')
    expect(parseHash('#/event/').name).toBe('today')
  })

  it('round-trips an id-carrying route through hrefFor', () => {
    const card: Route = { name: 'card', cardId: '11111111-1111-1111-1111-111111111111' }
    expect(parseHash(hrefFor(card))).toEqual(card)
    const event: Route = { name: 'event', eventId: '22222222-2222-2222-2222-222222222222' }
    expect(parseHash(hrefFor(event))).toEqual(event)
  })
})

describe('routeFromStartParam', () => {
  it('opens the tab a bot button named', () => {
    expect(routeFromStartParam('inbox')).toEqual({ name: 'inbox' })
    expect(routeFromStartParam('fields')).toEqual({ name: 'fields' })
  })

  it('opens a specific card or event from a notification deep link', () => {
    expect(routeFromStartParam('card_9f2a')).toEqual({ name: 'card', cardId: '9f2a' })
    expect(routeFromStartParam('event_7b11')).toEqual({ name: 'event', eventId: '7b11' })
  })

  it('answers null for anything it does not recognise, so the sheet keeps its own hash', () => {
    for (const value of [null, '', 'nonsense', 'card', 'card_', '../../etc/passwd']) {
      expect(routeFromStartParam(value)).toBeNull()
    }
  })
})
