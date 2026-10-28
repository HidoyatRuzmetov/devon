import { describe, expect, it } from 'vitest'
import { actionTargetIssues } from '../../src/modules/ai/action-targets.js'

describe('proposal identity types', () => {
  it.each([
    ['checkin.update', 'checkin_cycle', 'checkin_entry'],
    ['checkin.remove', 'card', 'checkin_entry'],
    ['checkin.lock', 'checkin_entry', 'checkin_cycle'],
    ['card.update', 'project', 'card'],
    ['personal.calendar.update', 'event', 'personal_calendar'],
    ['checklist.update', 'page', 'card'],
  ])('rejects a known wrong entity for %s', (kind, wrong, expected) => {
    expect(
      actionTargetIssues([{ kind, arguments: { id: 'target' } }], [`${wrong}:target`])[0],
    ).toContain(`requires ${expected}`)
  })
  it('accepts the correct entity and defers unavailable targets to ordinary API checks', () => {
    expect(
      actionTargetIssues(
        [{ kind: 'checkin.update', arguments: { id: 'entry' } }],
        ['checkin_entry:entry'],
      ),
    ).toEqual([])
    expect(
      actionTargetIssues(
        [{ kind: 'card.update', arguments: { id: 'outside-snapshot' } }],
        ['project:project'],
      ),
    ).toEqual([])
    expect(actionTargetIssues([{ kind: 'card.create', arguments: {} }], [])).toEqual([])
  })
})
