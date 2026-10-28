import { resolveNavEntries } from '@devon/ui'
import { describe, expect, it } from 'vitest'
import { NAV_ENTRIES } from '../../src/shell/nav.js'

describe('NAV_ENTRIES visibility (design.md §3.6/§7, I-8b)', () => {
  // Navigation retains shared work and people; management tools have been retired.
  const featureEntryIds = [
    'assistant',
    'analytics',
    'events',
    'pages',
    'personal',
    'projects',
    'structure',
    'people',
    'work',
  ]

  it('shows Home plus every role-visible feature entry to a member', () => {
    const visible = resolveNavEntries(NAV_ENTRIES, { role: 'member' })
    expect(visible.map((e) => e.id)).toEqual(['home', ...featureEntryIds])
  })

  it('shows the same entries to a head (unit roles are labels, never permissions -- I-8b)', () => {
    const visible = resolveNavEntries(NAV_ENTRIES, { role: 'head' })
    expect(visible.map((e) => e.id)).toEqual(['home', ...featureEntryIds])
  })

  it('shows Boshqaruv (admin) and the department-request queue only to super_admin', () => {
    const visible = resolveNavEntries(NAV_ENTRIES, { role: 'super_admin' })
    expect(visible.map((e) => e.id)).toEqual([
      'home',
      'admin',
      'assistant',
      'analytics',
      'department-requests',
      'events',
      'pages',
      'personal',
      'projects',
      'structure',
      'people',
      'work',
    ])
  })

  it('every entry resolves to a route string starting with /', () => {
    for (const entry of NAV_ENTRIES) expect(entry.route.startsWith('/')).toBe(true)
  })
})

// v1.1 SPEC §3.1: the head/member split in the sidebar. `ctx.can` is the app's `canAction` in
// production; here it is a stub over the same action ids, which is the point -- the entry declares an
// id, the resolver asks, and nothing in `nav.ts` knows what a head is.
describe('v1.1 -- the Boshqaruv group is resolved by action, not by role', () => {
  const HEAD_ONLY_ACTIONS = new Set([
    'people.table.read',
    'departments.settings.edit',
    'fields.definition.manage',
    // v1.1 integration: the other three Boshqaruv destinations. SPEC §3.1 names six, and a set that
    // listed three of them could pass while half the group leaked.
    'work.workload.read',
    'goals.read',
    'automations.read',
  ])

  function ctxFor(role: 'head' | 'member') {
    return {
      role: 'member' as const,
      departmentRole: role,
      hasDepartment: true,
      can: (action: string) => (HEAD_ONLY_ACTIONS.has(action) ? role === 'head' : true),
    }
  }

  it('a xodim never sees the people table or the department settings entry', () => {
    const ids = resolveNavEntries(NAV_ENTRIES, ctxFor('member')).map((e) => e.id)
    expect(ids).not.toContain('people-table')
    expect(ids).not.toContain('department-settings')
    // v1.1 SPEC §5: the custom-field manager is a Boshqaruv destination, never a xodim's.
    expect(ids).not.toContain('fields')
    // SPEC §3.1 names six Boshqaruv entries; all six are asserted, so the group can never half-leak.
    expect(ids).not.toContain('workload')
    expect(ids).not.toContain('goals')
    expect(ids).not.toContain('automations')
  })

  it('a xodim keeps the whole working set', () => {
    const ids = resolveNavEntries(NAV_ENTRIES, ctxFor('member')).map((e) => e.id)
    for (const id of [
      'home',
      'work',
      'projects',
      'personal',
      'events',
      'people',
      'structure',
      'pages',
      'analytics',
      'assistant',
    ]) {
      expect(ids).toContain(id)
    }
  })

  it('heads also have no retired management destinations', () => {
    const ids = resolveNavEntries(NAV_ENTRIES, ctxFor('head')).map((e) => e.id)
    for (const id of ['people-table', 'fields', 'workload', 'goals', 'automations'])
      expect(ids).not.toContain(id)
    expect(ids).toContain('people')
  })

  it('the instance role is never what decides it (I-8b)', () => {
    // A head's `role` is `member`; a member's is too. Only `can`/`departmentRole` separates them.
    const head = resolveNavEntries(NAV_ENTRIES, ctxFor('head')).map((e) => e.id)
    const member = resolveNavEntries(NAV_ENTRIES, ctxFor('member')).map((e) => e.id)
    expect(head).toEqual(member)
  })
})
