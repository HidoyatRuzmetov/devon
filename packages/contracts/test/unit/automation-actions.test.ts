import { describe, expect, it } from 'vitest'
import {
  AUTOMATION_ACTION_KINDS,
  automationActionSchema,
  automationWritableActionSchema,
  automationRuleBodySchema,
} from '../../src/work-plus.js'

const userId = '7e149155-257e-43b2-af57-04bb386a8a96'
const complete = [
  { kind: 'assign', userId },
  { kind: 'notify_user', userId },
  { kind: 'notify_head' },
  { kind: 'set_priority', priority: 'none' },
  { kind: 'set_status', status: 'done' },
  { kind: 'add_label', labelId: userId },
  { kind: 'add_checklist', checklist: ['Review the data'] },
  { kind: 'create_followup', title: 'Prepare the report', dueInDays: 0 },
]
describe('automation action write requirements and legacy compatibility', () => {
  it.each(complete)('accepts complete $kind action', (action) => {
    expect(automationWritableActionSchema.safeParse(action).success).toBe(true)
    expect(
      automationRuleBodySchema.safeParse({
        name: 'Local valid rule',
        trigger: 'card_created',
        actions: [action],
      }).success,
    ).toBe(true)
  })
  it.each(AUTOMATION_ACTION_KINDS.filter((kind) => kind !== 'notify_head'))(
    'rejects missing input for %s while keeping its legacy data readable',
    (kind) => {
      expect(automationActionSchema.safeParse({ kind }).success).toBe(true)
      expect(automationWritableActionSchema.safeParse({ kind }).success).toBe(false)
      expect(
        automationRuleBodySchema.safeParse({
          name: 'Incomplete rule',
          trigger: 'card_created',
          actions: [{ kind }],
        }).success,
      ).toBe(false)
    },
  )
  it.each([
    { kind: 'assign', userId: null },
    { kind: 'notify_user', userId: null },
    { kind: 'add_checklist', checklist: [] },
    { kind: 'add_checklist', checklist: ['   '] },
    { kind: 'create_followup', title: '   ' },
  ])('rejects an empty or whitespace-only $kind input', (action) => {
    expect(automationWritableActionSchema.safeParse(action).success).toBe(false)
  })
  it('still rejects a forbidden trigger/action pairing with complete input', () => {
    expect(
      automationRuleBodySchema.safeParse({
        name: 'Status loop',
        trigger: 'card_status_changed',
        actions: [{ kind: 'set_status', status: 'done' }],
      }).success,
    ).toBe(false)
  })
})
