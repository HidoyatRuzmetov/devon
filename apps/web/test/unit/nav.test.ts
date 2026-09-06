import { describe, expect, it } from 'vitest'
import { resolveNavEntries } from '@devon/ui'
import { NAV_ENTRIES } from '../../src/shell/nav.js'

describe('NAV_ENTRIES visibility (design.md §3.6/§7, I-8b)', () => {
  // The `inbox` feature module (MODULE-GUIDE.md "Web features") registers a sidebar entry with no
  // `visibleWhen` -- every notification is a signed-in user's own, regardless of role, so the inbox is
  // visible to everyone (unlike `admin`, gated to `super_admin` below).
  it('shows Home and Inbox to a member', () => {
    const visible = resolveNavEntries(NAV_ENTRIES, { role: 'member' })
    expect(visible.map((e) => e.id)).toEqual(['home', 'inbox'])
  })

  it('shows Home and Inbox, but not admin, to a head (unit roles are labels, never permissions -- I-8b)', () => {
    const visible = resolveNavEntries(NAV_ENTRIES, { role: 'head' })
    expect(visible.map((e) => e.id)).toEqual(['home', 'inbox'])
  })

  it('shows Boshqaruv (admin) only to super_admin', () => {
    const visible = resolveNavEntries(NAV_ENTRIES, { role: 'super_admin' })
    expect(visible.map((e) => e.id)).toEqual(['home', 'admin', 'inbox'])
  })

  it('every entry resolves to a route string starting with /', () => {
    for (const entry of NAV_ENTRIES) expect(entry.route.startsWith('/')).toBe(true)
  })
})
