import { describe, expect, it } from 'vitest'
import { resolveNavEntries } from '@devon/ui'
import { NAV_ENTRIES } from '../../src/shell/nav.js'

describe('NAV_ENTRIES visibility (design.md §3.6/§7, I-8b)', () => {
  // Core entries (`home`, `admin`) plus whatever `src/features/*/manifest.ts(x)` registers
  // (MODULE-GUIDE.md "Web features"), flattened in alphabetical directory order
  // (`registry.ts`'s `import.meta.glob` sort): accounts, ai, analytics, departments, events, inbox,
  // pages, personal, projects, structure, work. Every one of those sidebar entries is visible to
  // every signed-in role except `department-requests` (the super-admin approval queue) and the core
  // `admin` entry, which stay `super_admin`-only -- 'personal' (EPIC-009), 'inbox' (EPIC-010), 'ai'
  // (EPIC-012), 'analytics' and 'pages' (EPIC-010/011) included: a personal workspace, a notification
  // inbox, the AI assistant/settings screen, department-wide analytics and department pages all
  // belong to whoever is signed in, never gated by role (a head-only action inside the `ai` screen,
  // like editing the budget, is enforced by `can()` on the route, not by hiding the sidebar entry).
  //
  // v1.1: entries may also declare an `action` id, resolved through `ctx.can` (the app supplies it
  // from `canAction`). A context with no `can` -- as in the first three cases below -- does no action
  // gating at all, which is why the head-only entries still appear there; the dedicated block at the
  // bottom of this file is where the real head/member split is asserted.
  const featureEntryIds = [
    'account-settings',
    'ai',
    'analytics',
    'departments',
    'department-settings',
    'events',
    'fields',
    'inbox',
    'pages',
    'people-table',
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
      'account-settings',
      'ai',
      'analytics',
      'departments',
      'department-requests',
      'department-settings',
      'events',
      'fields',
      'inbox',
      'pages',
      'people-table',
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
  })

  it('a xodim keeps the whole working set', () => {
    const ids = resolveNavEntries(NAV_ENTRIES, ctxFor('member')).map((e) => e.id)
    for (const id of [
      'home',
      'inbox',
      'work',
      'projects',
      'personal',
      'events',
      'people',
      'structure',
      'pages',
      'analytics',
      'ai',
    ]) {
      expect(ids).toContain(id)
    }
  })

  it('a boshqarma boshligʻi sees both management destinations', () => {
    const ids = resolveNavEntries(NAV_ENTRIES, ctxFor('head')).map((e) => e.id)
    expect(ids).toContain('people-table')
    expect(ids).toContain('department-settings')
    expect(ids).toContain('fields')
  })

  it('the instance role is never what decides it (I-8b)', () => {
    // A head's `role` is `member`; a member's is too. Only `can`/`departmentRole` separates them.
    const head = resolveNavEntries(NAV_ENTRIES, ctxFor('head')).map((e) => e.id)
    const member = resolveNavEntries(NAV_ENTRIES, ctxFor('member')).map((e) => e.id)
    expect(head.length).toBeGreaterThan(member.length)
  })
})
