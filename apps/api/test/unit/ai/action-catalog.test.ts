import { describe, expect, it } from 'vitest'
import { ACTIONS, actionInstructions, parseAction } from '../../../src/modules/ai/action-catalog.js'

const id = '11111111-1111-4111-8111-111111111111'
const child = '22222222-2222-4222-8222-222222222222'
describe('deterministic assistant action catalogue', () => {
  it('requires current card version and comment revision before proposing updates', () => {
    expect(() => parseAction('card.update', { id, body: { title: 'New title' } })).toThrow()
    expect(
      parseAction('card.update', { id, body: { title: 'New title', version: 3 } }),
    ).toMatchObject({ body: { version: 3 } })
    expect(() =>
      parseAction('comment.update', { id, commentId: child, body: { text: 'Corrected' } }),
    ).toThrow()
    expect(
      parseAction('comment.update', {
        id,
        commentId: child,
        body: { text: 'Corrected', editedAt: null },
      }),
    ).toMatchObject({ body: { editedAt: null } })
  })
  it('does not allow model-supplied routes, actors, bulk deletes or path injection', () => {
    expect(() =>
      parseAction('event.comment.delete', { id, commentId: child, actorUserId: child }),
    ).toThrow()
    expect(() => parseAction('milestone.delete', { id, milestoneId: '../events' })).toThrow()
    expect(() => parseAction('card.delete', { id, path: '/users' })).toThrow()
    expect(() => parseAction('department.delete', { id })).toThrow('unsupported_action')
    expect(() => parseAction('card.delete', { ids: [id, child] })).toThrow()
  })
  it('validates event dates, RSVP bounds, feedback and comment sizes using real route schemas', () => {
    expect(() =>
      parseAction('event.create', {
        body: {
          title: 'Meeting',
          startsAt: '2026-10-24T12:00:00Z',
          endsAt: '2026-10-24T11:00:00Z',
        },
      }),
    ).toThrow()
    expect(() => parseAction('event.rsvp', { id, body: { status: 'yes', guests: 21 } })).toThrow()
    expect(() => parseAction('event.feedback', { id, body: { rating: 6 } })).toThrow()
    expect(() =>
      parseAction('event.comment.create', { id, body: { body: 'x'.repeat(2001) } }),
    ).toThrow()
  })
  it.each([
    [
      'event.create',
      {
        body: {
          title: 'Meeting',
          startsAt: '2026-10-24T12:00:00Z',
          endsAt: '2026-10-24T13:00:00Z',
        },
      },
      'POST',
      '/events',
    ],
    ['event.update', { id, body: { place: 'Room 2' } }, 'PATCH', `/events/${id}`],
    ['event.cancel', { id, body: { reason: 'Venue unavailable' } }, 'POST', `/events/${id}/cancel`],
    ['event.rsvp', { id, body: { status: 'yes' } }, 'POST', `/events/${id}/rsvp`],
    ['event.comment.create', { id, body: { body: 'Review' } }, 'POST', `/events/${id}/comments`],
    [
      'event.comment.update',
      { id, commentId: child, body: { body: 'Corrected', editedAt: null } },
      'PATCH',
      `/events/${id}/comments/${child}`,
    ],
    ['event.comment.delete', { id, commentId: child }, 'DELETE', `/events/${id}/comments/${child}`],
    [
      'event.feedback',
      { id, body: { rating: 4, comment: 'Useful' } },
      'POST',
      `/events/${id}/feedback`,
    ],
    [
      'comment.update',
      { id, commentId: child, body: { text: 'Corrected', editedAt: null } },
      'PATCH',
      `/cards/${id}/comments/${child}`,
    ],
    ['comment.delete', { id, commentId: child }, 'DELETE', `/cards/${id}/comments/${child}`],
    [
      'milestone.delete',
      { id, milestoneId: 'phase_1' },
      'DELETE',
      `/projects/${id}/milestones/phase_1`,
    ],
  ])('maps %s to its one permitted route', (kind, input, method, path) => {
    const action = ACTIONS[kind as string]!
    const args = parseAction(kind as string, input)
    expect(action.method).toBe(method)
    expect(action.path(args)).toBe(path)
  })
  it('serializes every action schema for the provider without runtime transforms', () => {
    const instructions = actionInstructions()
    expect(instructions).toHaveLength(Object.keys(ACTIONS).length)
    expect(instructions.every((action) => action.arguments.type === 'object')).toBe(true)
  })
})
