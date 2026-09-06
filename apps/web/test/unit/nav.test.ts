import { describe, expect, it } from 'vitest'
import { resolveNavEntries } from '@devon/ui'
import { NAV_ENTRIES } from '../../src/shell/nav.js'

describe('NAV_ENTRIES visibility (design.md §3.6/§7, I-8b)', () => {
  // Core entries (`home`, `admin`) plus whatever `src/features/*/manifest.ts(x)` registers
  // (MODULE-GUIDE.md "Web features") -- feature sidebar entries carry no `visibleWhen` gate of their
  // own here, so every signed-in role sees them; only `admin` stays super_admin-only.
  const featureEntryIds = ['structure', 'people']

  it('shows Home plus every registered feature to a member (no admin)', () => {
    const visible = resolveNavEntries(NAV_ENTRIES, { role: 'member' })
    expect(visible.map((e) => e.id)).toEqual(['home', ...featureEntryIds])
  })

  it('shows Home plus every registered feature to a head, still no admin (unit roles are labels, never permissions -- I-8b)', () => {
    const visible = resolveNavEntries(NAV_ENTRIES, { role: 'head' })
    expect(visible.map((e) => e.id)).toEqual(['home', ...featureEntryIds])
  })

  it('shows Boshqaruv (admin) only to super_admin', () => {
    const visible = resolveNavEntries(NAV_ENTRIES, { role: 'super_admin' })
    expect(visible.map((e) => e.id)).toEqual(['home', 'admin', ...featureEntryIds])
  })

  it('every entry resolves to a route string starting with /', () => {
    for (const entry of NAV_ENTRIES) expect(entry.route.startsWith('/')).toBe(true)
  })
})
