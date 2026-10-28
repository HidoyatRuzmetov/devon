import type { AiChatProposal } from '@devon/contracts'
import { describe, expect, it } from 'vitest'
import { decodeActionJson, proposedActionSchema } from '../../src/modules/ai/action-catalog.js'
import { resolveActionBindings, validateActionPlan } from '../../src/modules/ai/action-plan.js'

const id = 'a0000000-0000-4000-8000-000000000001'
const project = {
  key: 'project',
  kind: 'project.create',
  arguments: { body: { title: 'Release', ownerUserId: id, members: [id] } },
}
const card = {
  key: 'card',
  kind: 'card.withChecklist',
  arguments: {
    body: {
      create: { title: 'Deliver', projectScope: 'subjective' },
      checklist: [{ key: 'one', text: 'Evidence' }],
    },
  },
  bindings: [{ path: 'body.create.projectId', from: 'project' }],
}
describe('reviewed action dependencies', () => {
  it('repairs explicitly flattened create fields but refuses conflicting or unknown fields', () => {
    const raw = {
      ...card,
      title: 'Create task',
      summary: 'Task with checklist',
      arguments: { body: { ...card.arguments.body, assigneeUserId: id } },
    }
    const parsed = proposedActionSchema.parse(raw)
    expect(validateActionPlan([project, parsed])[1]!.arguments['body']).toMatchObject({
      create: { assigneeUserId: id },
    })
    const conflicting = {
      ...raw,
      arguments: {
        body: {
          ...raw.arguments.body,
          create: {
            ...card.arguments.body.create,
            assigneeUserId: 'b0000000-0000-4000-8000-000000000002',
          },
        },
      },
    }
    expect(() => validateActionPlan([project, proposedActionSchema.parse(conflicting)])).toThrow()
    const unknown = { ...raw, arguments: { body: { ...raw.arguments.body, surprise: true } } }
    expect(() => validateActionPlan([project, proposedActionSchema.parse(unknown)])).toThrow()
  })
  it('recovers JSON-encoded arguments and a misplaced explicit identity without guessing values', () => {
    const raw = {
      kind: 'personal.calendar.update',
      title: 'Move appointment',
      summary: 'Move one appointment',
      id,
      arguments: JSON.stringify({
        body: {
          version: 1,
          entry: {
            title: 'Dentist',
            startsAt: '2027-04-07T11:00:00+05:00',
            endsAt: '2027-04-07T12:00:00+05:00',
          },
        },
      }),
    }
    const actions = decodeActionJson(JSON.stringify([raw])) as unknown[]
    const parsed = validateActionPlan(actions.map((a) => proposedActionSchema.parse(a)))
    expect(parsed[0]!.arguments['id']).toBe(id)
    expect(parsed[0]!.arguments['body']).toMatchObject({
      version: 1,
      entry: { allDay: false, remindAt: null },
    })
    expect(() =>
      proposedActionSchema.parse({ ...raw, arguments: { id: 'a different identity' } }),
    ).toThrow()
    expect(() =>
      validateActionPlan([proposedActionSchema.parse({ ...raw, id: undefined })]),
    ).toThrow()
  })
  it('validates typed references without persisting synthetic IDs', () => {
    const plan = validateActionPlan([project, card])
    expect(plan[1]!.arguments).toEqual(card.arguments)
    const result = resolveActionBindings(
      card,
      new Map([
        [
          'project',
          {
            ...project,
            id,
            title: 'Create project',
            summary: '',
            status: 'executed',
            result: { href: '/projects/view?id=' + id, label: 'Release', entityId: id },
          } as AiChatProposal,
        ],
      ]),
    )
    expect(result['body']).toMatchObject({ create: { projectId: id, title: 'Deliver' } })
  })
  it('refuses cycles, unknown keys, type confusion, duplicate keys, and arbitrary paths', () => {
    const invalid = [
      [{ ...card, bindings: [{ path: 'body.existingCardId', from: 'card' }] }],
      [project, project],
      [project, { ...card, bindings: [{ path: 'body.create.projectId', from: 'missing' }] }],
      [project, { ...card, bindings: [{ path: 'body.existingCardId', from: 'project' }] }],
      [project, { ...card, bindings: [{ path: '__proto__.polluted', from: 'project' }] }],
      [project, { ...card, bindings: [{ path: 'body.create.assigneeUserId', from: 'project' }] }],
      [project, { ...card, bindings: [...card.bindings, ...card.bindings] }],
    ]
    for (const actions of invalid) expect(() => validateActionPlan(actions)).toThrow()
    expect(({} as Record<string, unknown>)['polluted']).toBeUndefined()
  })
  it('orders forward references before review without changing independent order', () => {
    expect(validateActionPlan([card, project]).map((p) => p.key)).toEqual(['project', 'card'])
  })
  it('refuses a hidden replacement of a visible ID and preserves strict domain validation', () => {
    expect(() =>
      validateActionPlan([
        project,
        {
          ...card,
          arguments: { body: { create: { title: 'Deliver', projectId: id }, checklist: [] } },
        },
      ]),
    ).toThrow('bound_argument_must_be_omitted')
    expect(() =>
      validateActionPlan([
        project,
        {
          ...card,
          arguments: { body: { create: { title: '', surprise: 'hidden' }, checklist: [] } },
        },
      ]),
    ).toThrow()
  })
  it.each(['pending', 'discarded', 'failed', 'expired', 'executing'] as const)(
    'does not use a %s dependency',
    (status) => {
      const earlier = {
        ...project,
        id,
        title: 'Create project',
        summary: '',
        status,
        result: { href: '/projects/view?id=' + id, label: 'Release', entityId: id },
      } as AiChatProposal
      expect(() => resolveActionBindings(card, new Map([['project', earlier]]))).toThrow(
        'dependency_unavailable',
      )
    },
  )
})
