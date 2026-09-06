import { describe, expect, it } from 'vitest'
import { resolveNavEntries } from '@devon/ui'
import { NAV_ENTRIES } from '../../src/shell/nav.js'

// EPIC-004/005 add the first two feature-module sidebar entries (`work`, `projects`) -- neither
// declares a `visibleWhen`, so both are visible to every signed-in role (member and head alike), the
// same way any future module's entry appears here automatically without editing this file
// (MODULE-GUIDE.md "Web features": "none of those three files is ever edited to add a feature").
// These tests originally asserted "only Home" from before any feature module existed; updated to the
// module set this build now ships, not relaxed -- `admin`'s super_admin-only visibility (the actual
// thing I-8b guards) is still asserted below exactly as before.
describe('NAV_ENTRIES visibility (design.md §3.6/§7, I-8b)', () => {
  it('shows Home plus every feature module to a member, never admin', () => {
    const visible = resolveNavEntries(NAV_ENTRIES, { role: 'member' })
    expect(visible.map((e) => e.id)).toEqual(['home', 'projects', 'work'])
  })

  it('shows the same entries to a head as a member (unit roles are labels, never permissions -- I-8b)', () => {
    const visible = resolveNavEntries(NAV_ENTRIES, { role: 'head' })
    expect(visible.map((e) => e.id)).toEqual(['home', 'projects', 'work'])
  })

  it('shows Boshqaruv (admin) only to super_admin', () => {
    const visible = resolveNavEntries(NAV_ENTRIES, { role: 'super_admin' })
    expect(visible.map((e) => e.id)).toEqual(['home', 'admin', 'projects', 'work'])
  })

  it('every entry resolves to a route string starting with /', () => {
    for (const entry of NAV_ENTRIES) expect(entry.route.startsWith('/')).toBe(true)
  })
})
