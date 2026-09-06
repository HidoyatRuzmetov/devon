import { describe, expect, it } from 'vitest'
import { resolveNavEntries } from '@devon/ui'
import { NAV_ENTRIES } from '../../src/shell/nav.js'

describe('NAV_ENTRIES visibility (design.md §3.6/§7, I-8b)', () => {
  // EPIC-001/EPIC-002 add the `accounts` and `departments` features, each contributing sidebar
  // entries via its own manifest.ts (MODULE-GUIDE.md "Web features") -- visible to every role because
  // every account has a profile and every account belongs to (or is choosing) a department. Only
  // `department-requests` (the super-admin approval queue) and the core `admin` entry stay gated.
  it('shows Home plus every role-visible feature entry to a member', () => {
    const visible = resolveNavEntries(NAV_ENTRIES, { role: 'member' })
    expect(visible.map((e) => e.id)).toEqual(['home', 'account-settings', 'departments'])
  })

  it('shows the same entries to a head (unit roles are labels, never permissions -- I-8b)', () => {
    const visible = resolveNavEntries(NAV_ENTRIES, { role: 'head' })
    expect(visible.map((e) => e.id)).toEqual(['home', 'account-settings', 'departments'])
  })

  it('shows Boshqaruv (admin) and the department-request queue only to super_admin', () => {
    const visible = resolveNavEntries(NAV_ENTRIES, { role: 'super_admin' })
    expect(visible.map((e) => e.id)).toEqual([
      'home',
      'admin',
      'account-settings',
      'departments',
      'department-requests',
    ])
  })

  it('every entry resolves to a route string starting with /', () => {
    for (const entry of NAV_ENTRIES) expect(entry.route.startsWith('/')).toBe(true)
  })
})
