import { notificationDestination } from '../../src/features/inbox/notification-destination.js'
import { describe, expect, it } from 'vitest'
import { inboxGroup } from '../../src/features/inbox/groups.js'
import { REASONS } from '../../src/features/inbox/api.js'
describe('Home notification categories', () => {
  it('keeps event updates and mentions with events, not task assignments', () => {
    expect(inboxGroup({ reason: 'updated', subjectType: 'event' })).toBe('events')
    expect(inboxGroup({ reason: 'mentioned', subjectType: 'card' })).toBe('tasks')
    expect(inboxGroup({ reason: 'digest', subjectType: 'department' })).toBe('summaries')
    expect(inboxGroup({ reason: 'field_request', subjectType: 'profile' })).toBe('system')
  })
  it('retains every existing reason in a visible category', () => {
    expect(REASONS.map((reason) => inboxGroup({ reason, subjectType: 'unknown' }))).toEqual([
      'tasks',
      'system',
      'tasks',
      'system',
      'events',
      'events',
      'system',
      'summaries',
      'system',
      'system',
    ])
  })
  it('keeps summaries readable without presenting a link back to the same inbox as a destination', () => {
    expect(notificationDestination({ reason: 'digest', deepLink: '/inbox' })).toBeNull()
    expect(notificationDestination({ reason: 'digest', deepLink: '/?inbox=all' })).toBeNull()
    expect(notificationDestination({ reason: 'digest', deepLink: '/people?person=one' })).toBe(
      '/people?person=one',
    )
    expect(notificationDestination({ reason: 'assigned', deepLink: '/work/card?id=one' })).toBe(
      '/work/card?id=one',
    )
  })
})
