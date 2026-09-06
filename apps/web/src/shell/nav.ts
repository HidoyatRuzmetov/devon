import { Home, ShieldCheck } from 'lucide-react'
import type { NavEntry } from '@devon/ui'
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
