import { describe, expect, it } from 'vitest'
import { resolveNavEntries } from '@devon/ui'
import { NAV_ENTRIES } from '../../src/shell/nav.js'

describe('NAV_ENTRIES visibility (design.md §3.6/§7, I-8b)', () => {
  // Core entries (`home`, `admin`) plus whatever `src/features/*/manifest.ts(x)` registers
  // (MODULE-GUIDE.md "Web features"), flattened in alphabetical directory order
  // (`registry.ts`'s `import.meta.glob` sort): accounts, analytics, departments, events, inbox,
  // pages, personal, projects, structure, work. Every one of those sidebar entries is visible to
  // every signed-in role except `department-requests` (the super-admin approval queue) and the core
  // `admin` entry, which stay `super_admin`-only -- 'personal' (EPIC-009), 'inbox' (EPIC-010),
  // 'analytics' and 'pages' (EPIC-010/011) included: a personal workspace, a notification inbox,
  // department-wide analytics and department pages all belong to whoever is signed in, never gated
  // by role (member/head/super_admin are all active members of a department they can see).
  const featureEntryIds = [
    'account-settings',
    'analytics',
    'departments',
    'events',
    'inbox',
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
      'account-settings',
      'analytics',
      'departments',
      'department-requests',
      'events',
      'inbox',
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
