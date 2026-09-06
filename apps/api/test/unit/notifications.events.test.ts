// Domain-event intake (MODULE-GUIDE.md "Domain events": "define a small registry of expected events
// ... and handle unknown ones gracefully"). Tests the pure parsing this module's handler runs before
// ever touching the database -- no `withContext()` call here, so this needs no Postgres.
import { describe, expect, it } from 'vitest'
import { EVENT_REGISTRY, parseNotifyBlock } from '../../src/modules/notifications/events.js'

describe('EVENT_REGISTRY', () => {
  it('maps every registered event type to one of the nine notification reasons', () => {
    const REASONS = new Set([
      'assigned',
      'mentioned',
      'due',
      'updated',
      'rsvp',
      'poll',
      'decision',
      'digest',
      'system',
    ])
    for (const reason of Object.values(EVENT_REGISTRY)) expect(REASONS.has(reason)).toBe(true)
  })

  it('knows about the vocabulary named in TECH-SPEC for cards, events, polls and decisions', () => {
    expect(EVENT_REGISTRY['work.card.assigned']).toBe('assigned')
    expect(EVENT_REGISTRY['work.card.due']).toBe('due')
    expect(EVENT_REGISTRY['events.event.updated']).toBe('updated')
    expect(EVENT_REGISTRY['events.poll.opened']).toBe('poll')
    expect(EVENT_REGISTRY['pages.decision.recorded']).toBe('decision')
  })
})

const VALID_TITLE = { 'uz-Latn': 'a', 'uz-Cyrl': 'b', ru: 'c', en: 'd' }

describe('parseNotifyBlock ("handle unknown ones gracefully")', () => {
  it('parses a well-formed notify block', () => {
    const parsed = parseNotifyBlock({
      notify: { targetUserIds: ['u1', 'u2'], title: VALID_TITLE, deepLink: '/cards/1', eventAt: '2026-09-06T10:00:00.000Z' },
    })
    expect(parsed).toEqual({
      targetUserIds: ['u1', 'u2'],
      title: VALID_TITLE,
      body: null,
      deepLink: '/cards/1',
      subjectType: null,
      subjectId: null,
      eventAt: new Date('2026-09-06T10:00:00.000Z'),
    })
  })

  it('returns null for a payload with no notify block at all (an event this module does not render yet)', () => {
    expect(parseNotifyBlock({ someOtherField: 'value' })).toBeNull()
  })

  it('returns null for a completely unrelated payload shape (never throws)', () => {
    expect(parseNotifyBlock('a plain string')).toBeNull()
    expect(parseNotifyBlock(42)).toBeNull()
    expect(parseNotifyBlock(null)).toBeNull()
    expect(parseNotifyBlock(undefined)).toBeNull()
    expect(parseNotifyBlock(['array', 'not', 'record'])).toBeNull()
  })

  it('returns null when targetUserIds is missing or empty', () => {
    expect(parseNotifyBlock({ notify: { title: VALID_TITLE } })).toBeNull()
    expect(parseNotifyBlock({ notify: { targetUserIds: [], title: VALID_TITLE } })).toBeNull()
  })

  it('returns null when targetUserIds contains a non-string entry', () => {
    expect(parseNotifyBlock({ notify: { targetUserIds: ['u1', 42], title: VALID_TITLE } })).toBeNull()
  })

  it('returns null when title is missing a locale', () => {
    const incomplete = { 'uz-Latn': 'a', ru: 'c', en: 'd' } // missing uz-Cyrl
    expect(parseNotifyBlock({ notify: { targetUserIds: ['u1'], title: incomplete } })).toBeNull()
  })

  it('ignores a malformed eventAt instead of failing the whole block', () => {
    const parsed = parseNotifyBlock({
      notify: { targetUserIds: ['u1'], title: VALID_TITLE, eventAt: 'not-a-date' },
    })
    expect(parsed?.eventAt).toBeNull()
  })

  it('ignores a malformed body instead of failing the whole block', () => {
    const parsed = parseNotifyBlock({
      notify: { targetUserIds: ['u1'], title: VALID_TITLE, body: { onlyOneLocale: 'x' } },
    })
    expect(parsed?.body).toBeNull()
  })
})
