import { Home, ShieldCheck } from 'lucide-react'
import type { NavEntry, NavGroup } from '@devon/ui'
import { getFeatureSidebarEntries } from '../features/registry.js'

/** design.md §7: the sidebar (and the command palette's "Oʻtish" group) render from this registry.
 * "Boshqaruv" only exists for `super_admin` (design.md §3.6) -- `visibleWhen` is the mechanism,
 * `resolveNavEntries` (`@devon/ui`) is where it is actually applied, never a second, ad-hoc check. */
const CORE_NAV_ENTRIES: readonly NavEntry[] = [
  { id: 'home', labelKey: 'shell.nav.home', icon: Home, route: '/' },
  {
    id: 'admin',
    labelKey: 'shell.nav.admin',
    icon: ShieldCheck,
    route: '/admin',
    visibleWhen: (ctx) => ctx.role === 'super_admin',
  },
]

/** Core entries first, then every `src/features/<name>/manifest.ts(x)`'s own `sidebar` entries
 * (MODULE-GUIDE.md "Web features") -- a feature never edits this file to appear in the sidebar. */
export const NAV_ENTRIES: readonly NavEntry[] = [...CORE_NAV_ENTRIES, ...getFeatureSidebarEntries()]

/** UI-OVERHAUL.md §2 row 1: Linear, Huly, Notion and Vercel all *group* a nav past about six items.
 * Fifteen flat rows is the single biggest reason the blitz shell read as "software built module by
 * module".
 *
 * Grouping lives here, not in the manifests, for the same reason ordering does: a group is a
 * statement about the whole product ("what a civil servant does here falls into four kinds of
 * work"), and no single feature can make it. An entry this map has not heard of still renders --
 * `Sidebar` appends whatever no group claimed, so a new feature is never invisible while waiting for
 * a line here. */
export const NAV_GROUPS: readonly NavGroup[] = [
  // No heading: the top of a sidebar never needs one to be understood.
  { id: 'top', entryIds: ['home', 'inbox'] },
  { id: 'work', labelKey: 'shell.nav.group.work', entryIds: ['work', 'projects', 'personal'] },
  { id: 'team', labelKey: 'shell.nav.group.team', entryIds: ['events', 'people', 'structure'] },
  {
    id: 'knowledge',
    labelKey: 'shell.nav.group.knowledge',
    entryIds: ['pages', 'analytics', 'ai'],
  },
  {
    id: 'manage',
    labelKey: 'shell.nav.group.manage',
    entryIds: ['departments', 'department-requests', 'account-settings', 'admin'],
  },
]

/** The five areas the bottom tab bar carries at 390 px (UI-OVERHAUL.md §2: "bottom tab bar for the
 * five most used areas"). Everything else stays one tap away behind ☰, which opens the full sidebar
 * as a sheet. Order matters: it is the order of a working day. */
export const MOBILE_TAB_IDS: readonly string[] = ['home', 'work', 'personal', 'events', 'inbox']

export function mobileTabEntries(visible: readonly NavEntry[]): NavEntry[] {
  return MOBILE_TAB_IDS.map((id) => visible.find((entry) => entry.id === id)).filter(
    (entry): entry is NavEntry => Boolean(entry),
  )
}
