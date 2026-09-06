import type * as React from 'react'

/** design.md §7 / spec.md §7: the sidebar (and the command palette's "Oʻtish" group) render from
 * this registry. An epic adds its entry in the same change that makes its route render real
 * content -- there is deliberately no `disabled` or `badge` field, because "no entry may ship
 * disabled, greyed, or badged 'soon'" (spec.md §7) is a rule this *type* enforces, not a convention
 * to remember. */
export interface NavEntry {
  id: string
  labelKey: string
  icon: React.ComponentType<React.SVGProps<SVGSVGElement>>
  route: string
  /** Omitted means "always visible". Kept a plain predicate (not a role list) so a later epic can
   * gate on more than role (e.g. `ctx.hasDepartment`) without changing this type. */
  visibleWhen?: (ctx: NavContext) => boolean
}

export interface NavContext {
  role: 'super_admin' | 'head' | 'member'
  isDemo?: boolean
}

/** The only place entries are filtered. `wp-qa-visual` can assert every entry `resolveNavEntries`
 * returns navigates to a route whose primary state is not Empty-with-no-action (spec.md §7) --
 * that assertion lives in `apps/web`'s e2e suite, not here; this function is the mechanism it
 * depends on. */
export function resolveNavEntries(entries: readonly NavEntry[], ctx: NavContext): NavEntry[] {
  return entries.filter((entry) => (entry.visibleWhen ? entry.visibleWhen(ctx) : true))
}
