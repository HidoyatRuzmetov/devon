import { describe, expect, it } from 'vitest'
import { resolveNavEntries } from '@devon/ui'
import { NAV_ENTRIES } from '../../src/shell/nav.js'

describe('NAV_ENTRIES visibility (design.md §3.6/§7, I-8b)', () => {
  // NAV_ENTRIES is core entries + every feature's own `sidebar` entries (MODULE-GUIDE.md "Web
  // features"), so this list grows as modules ship -- 'personal' (EPIC-009) is visible to every
  // authenticated role, head and super_admin included, since a personal workspace belongs to
  // whoever is signed in, never gated by role (I-1: owner-only, no exception, ever).
  it('shows Home and Personal to a member', () => {
    const visible = resolveNavEntries(NAV_ENTRIES, { role: 'member' })
    expect(visible.map((e) => e.id)).toEqual(['home', 'personal'])
  })

  it('shows Home and Personal to a head (unit roles are labels, never permissions -- I-8b)', () => {
    const visible = resolveNavEntries(NAV_ENTRIES, { role: 'head' })
    expect(visible.map((e) => e.id)).toEqual(['home', 'personal'])
  })

  it('shows Boshqaruv (admin) only to super_admin, alongside every role-agnostic entry', () => {
    const visible = resolveNavEntries(NAV_ENTRIES, { role: 'super_admin' })
    expect(visible.map((e) => e.id)).toEqual(['home', 'admin', 'personal'])
  })

  it('every entry resolves to a route string starting with /', () => {
    for (const entry of NAV_ENTRIES) expect(entry.route.startsWith('/')).toBe(true)
  })
})
