import { describe, expect, it } from 'vitest'
import { resolveNavEntries } from '@devon/ui'
import { NAV_ENTRIES } from '../../src/shell/nav.js'

describe('NAV_ENTRIES visibility (design.md §3.6/§7, I-8b)', () => {
  // `nav.ts` appends every feature manifest's own sidebar entries after the two core ones
  // (MODULE-GUIDE.md "Web features") -- EPIC-008 (events) is the first such feature to land, so
  // "everyone, any role" now includes it too. Role-gating below is about `admin` staying
  // super_admin-only, not about the roster staying frozen at zero features forever.
  it('shows Home and Events (no admin) to a member', () => {
    const visible = resolveNavEntries(NAV_ENTRIES, { role: 'member' })
    expect(visible.map((e) => e.id)).toEqual(['home', 'events'])
  })

  it('shows Home and Events (no admin) to a head (unit roles are labels, never permissions -- I-8b)', () => {
    const visible = resolveNavEntries(NAV_ENTRIES, { role: 'head' })
    expect(visible.map((e) => e.id)).toEqual(['home', 'events'])
  })

  it('shows Boshqaruv (admin) only to super_admin', () => {
    const visible = resolveNavEntries(NAV_ENTRIES, { role: 'super_admin' })
    expect(visible.map((e) => e.id)).toEqual(['home', 'admin', 'events'])
  })

  it('every entry resolves to a route string starting with /', () => {
    for (const entry of NAV_ENTRIES) expect(entry.route.startsWith('/')).toBe(true)
  })
})
