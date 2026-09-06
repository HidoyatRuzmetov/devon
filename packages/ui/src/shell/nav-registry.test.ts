import { describe, expect, it } from 'vitest'
import { Home, ShieldCheck } from 'lucide-react'
import { resolveNavEntries, type NavEntry } from './nav-registry.js'

const ENTRIES: NavEntry[] = [
  { id: 'home', labelKey: 'nav.home', icon: Home, route: '/' },
  {
    id: 'admin',
    labelKey: 'nav.admin',
    icon: ShieldCheck,
    route: '/admin',
    visibleWhen: (ctx) => ctx.role === 'super_admin',
  },
]

describe('resolveNavEntries', () => {
  it('always includes an entry with no visibleWhen predicate', () => {
    const result = resolveNavEntries(ENTRIES, { role: 'member' })
    expect(result.map((e) => e.id)).toEqual(['home'])
  })

  it('includes a gated entry only when its predicate passes', () => {
    const result = resolveNavEntries(ENTRIES, { role: 'super_admin' })
    expect(result.map((e) => e.id)).toEqual(['home', 'admin'])
  })

  it('never mutates the input array', () => {
    const before = [...ENTRIES]
    resolveNavEntries(ENTRIES, { role: 'member' })
    expect(ENTRIES).toEqual(before)
  })
})
