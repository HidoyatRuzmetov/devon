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

/** round2 SEV2: a `super_admin` session with no department membership was rendering all nine of
 * these department-scoped destinations anyway -- confirmed live by signing in as that account and
 * navigating to `/work`, which cannot work with no active department. Every feature manifest still
 * owns its own `visibleWhen` (role gates, etc.); this wraps it with one more condition rather than
 * editing nine manifest files to say the same thing nine times. `departments`/`department-requests`
 * are deliberately not in this set -- discovering or requesting a department is exactly what a
 * membership-less account still needs to reach. */
const DEPARTMENT_SCOPED_ENTRY_IDS = new Set([
  'work',
  'projects',
  'personal',
  'events',
  'people',
  'structure',
  'pages',
  'analytics',
  'ai',
])

function requireDepartmentFor(entries: readonly NavEntry[]): NavEntry[] {
  return entries.map((entry) => {
    if (!DEPARTMENT_SCOPED_ENTRY_IDS.has(entry.id)) return entry
    const original = entry.visibleWhen
    return {
      ...entry,
      visibleWhen: (ctx) => ctx.hasDepartment !== false && (original ? original(ctx) : true),
    }
  })
}

/** Core entries first, then every `src/features/<name>/manifest.ts(x)`'s own `sidebar` entries
 * (MODULE-GUIDE.md "Web features") -- a feature never edits this file to appear in the sidebar. */
export const NAV_ENTRIES: readonly NavEntry[] = requireDepartmentFor([
  ...CORE_NAV_ENTRIES,
  ...getFeatureSidebarEntries(),
])

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
  // v1.1 critique SEV1 #5: every labelled group folds. At 1440x900 the head's nav is 968 px of
  // content in 683 px of space, so BOSHQARUV was cut at "Maqsadlar" (at "Цели" in Russian) and the
  // head's three newest destinations sat below the fold with no affordance at all. Folding is the
  // fix a person can apply themselves; `DEFAULT_COLLAPSED_GROUPS_HEAD` below is the fix that is
  // already applied the first time they sign in.
  {
    id: 'work',
    labelKey: 'shell.nav.group.work',
    entryIds: ['work', 'projects', 'personal'],
    collapsible: true,
  },
  {
    id: 'team',
    labelKey: 'shell.nav.group.team',
    entryIds: ['events', 'people', 'structure'],
    collapsible: true,
  },
  {
    id: 'knowledge',
    labelKey: 'shell.nav.group.knowledge',
    entryIds: ['pages', 'analytics', 'ai'],
    collapsible: true,
  },
  /**
   * v1.1 SPEC §3.1 -- **Boshqaruv**: the boshqarma boshlig'i's half of the product. This is the
   * structural answer to CTO finding #2 ("the head's product is the member's product with more
   * buttons"): the head does not get extra buttons scattered through the working screens, they get a
   * group of their own, and a xodim never sees that the group exists.
   *
   * Every entry in it declares a head-only action, so the group disappears for a member through the
   * same `can()` the server's route uses -- `Sidebar` renders nothing for a group whose entries all
   * resolved away. The ids listed here that no manifest claims yet (`workload`, `goals`, `fields`,
   * `automations`) are the destinations SPEC §7 builds; naming them now means those packages add one
   * sidebar entry to their own manifest and land in the right group with no edit to this file.
   */
  {
    id: 'manage-head',
    labelKey: 'shell.nav.group.manageHead',
    entryIds: ['people-table', 'workload', 'goals', 'fields', 'automations', 'department-settings'],
    collapsible: true,
  },
  {
    id: 'manage',
    labelKey: 'shell.nav.group.manage',
    entryIds: ['departments', 'department-requests', 'account-settings', 'admin'],
    collapsible: true,
  },
]

/**
 * v1.1 critique SEV1 #5. A xodim's nav has four groups and fits; a boshqarma boshligʻi's has six
 * and does not. So the head starts with the three *working* groups folded and Boshqaruv open --
 * which is the same statement SPEC §3 makes about the product ("the head's home is for management,
 * the member's home is for working"), applied to the nav. A folded group still shows the row you
 * are standing on, so a head who is on the board sees Vazifalar in ISH regardless.
 *
 * This is only the first-run default: the moment anyone toggles a group the whole set is persisted
 * per user and this is never consulted again.
 */
export const DEFAULT_COLLAPSED_GROUPS_HEAD: readonly string[] = ['work', 'team', 'knowledge']

/** The five areas the bottom tab bar carries at 390 px (UI-OVERHAUL.md §2: "bottom tab bar for the
 * five most used areas"). Everything else stays one tap away behind ☰, which opens the full sidebar
 * as a sheet. Order matters: it is the order of a working day. */
export const MOBILE_TAB_IDS: readonly string[] = ['home', 'work', 'personal', 'events', 'inbox']

/**
 * v1.1 critique SEV2 #28 -- "on a phone the head gets the member's app".
 *
 * The tab bar was identical for both roles, so nothing managerial was one tap away and "Shaxsiy"
 * (the private personal workspace) outranked "Xodimlar jadvali" for a department head. That is the
 * same complaint as CTO finding #2, applied to the one surface where there are only five slots: if
 * the head's product is a different product, its five most-used areas are different too.
 *
 * Asosiy · Xodimlar · Yuklama · Vazifalar · Xabarlar. Shaxsiy is still one tap away behind ☰ -- a
 * head has a personal workspace like everybody else, it is just not one of the five things they do
 * most on a phone. A head whose department has the workload feature switched off simply gets the
 * entry resolved away and the bar renders four tabs, which is what `mobileTabEntries` already does.
 */
export const MOBILE_TAB_IDS_HEAD: readonly string[] = [
  'home',
  'people-table',
  'workload',
  'work',
  'inbox',
]

/** Shorter labels for those five tabs. A tab is about 78 px wide at 390 px, and "Bildirishnomalar"
 * is not 78 px of anything -- but the shell may not ellipsize (DESIGN.md §3.5), and that rule's own
 * prescription is "a shorter i18n key". These are those keys. The full name stays the tab's
 * accessible name. */
export const MOBILE_TAB_SHORT_LABEL_KEYS: Readonly<Record<string, string>> = {
  home: 'shell.nav.short.home',
  work: 'shell.nav.short.work',
  personal: 'shell.nav.short.personal',
  events: 'shell.nav.short.events',
  inbox: 'shell.nav.short.inbox',
  // SEV2 #28: two more fixed 390 px slots needing short keys. "Xodimlar jadvali" and "Yuklama" are
  // the full names, and they stay as the tabs' accessible names (DESIGN.md §5).
  'people-table': 'shell.nav.short.peopleTable',
  workload: 'shell.nav.short.workload',
}

/** SEV2 #28: the head's five, or the member's five. `departmentRole` rather than `role`, because
 * `Actor.role` is the instance role and is `member` for every real boshqarma boshligʻi (I-8b). */
export function mobileTabEntries(visible: readonly NavEntry[], isHead = false): NavEntry[] {
  const ids = isHead ? MOBILE_TAB_IDS_HEAD : MOBILE_TAB_IDS
  return ids
    .map((id) => visible.find((entry) => entry.id === id))
    .filter((entry): entry is NavEntry => Boolean(entry))
}
