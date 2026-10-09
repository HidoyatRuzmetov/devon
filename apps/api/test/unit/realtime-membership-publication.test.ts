import { describe, it, expect } from 'vitest'
import { membershipPersonalChannels } from '../../src/modules/realtime/membership-publication.js'
const first = 'ed170a4b-32fc-4fa9-bb57-8f138607a33c'
const second = 'aac53e18-f33f-41f7-b876-40c0454a7a43'
describe('membership changes address only explicitly named people', () => {
  it.each(['departments.membership.changed', 'departments.join_request.decided'])(
    'projects %s to deduplicated, validated personal channels',
    (type) => {
      expect(
        membershipPersonalChannels(type, {
          userId: first,
          userIds: [first, second, '*', null, 12],
          actorUserId: 'actor',
          title: 'Private title',
        }),
      ).toEqual([`personal#${first}`, `personal#${second}`])
    },
  )
  it('never redirects an unrelated domain event or uses actor/profile fields as a destination', () => {
    expect(membershipPersonalChannels('work.card.updated', { userId: first })).toEqual([])
    expect(
      membershipPersonalChannels('departments.membership.changed', {
        actorUserId: first,
        colleagueId: second,
      }),
    ).toEqual([])
    expect(membershipPersonalChannels('departments.join_request.decided', null)).toEqual([])
  })
})
