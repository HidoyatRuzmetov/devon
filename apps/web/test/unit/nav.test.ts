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
  const featureEntryIds = [
    'account-settings',
    'ai',
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
      'ai',
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
