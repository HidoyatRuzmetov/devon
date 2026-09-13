// The shape every `src/features/<name>/manifest.ts(x)` must export as its default (MODULE-GUIDE.md
// "Web features"). Kept deliberately small and serialisable-ish: a route is a path, a *lazy* component
// (never imported eagerly -- see `registry.ts`) and a title key; a sidebar/command entry is exactly
// what `@devon/ui`'s `NavEntry`/`CommandPaletteGroup` already expect, so the shell never needs a
// feature-specific adapter.
import type * as React from 'react'
import type { NavContext, NavEntry } from '@devon/ui'

export type FeatureRoute = {
  /** Exact pathname this route matches, e.g. `/people`. No params/wildcards in this first version --
   * the same "small router" tradeoff `src/lib/router.tsx` already documents for the five core routes. */
  path: string
  /** `React.lazy(() => import('./screen.js'))` -- never a static import, or every feature would end up
   * in the app's initial bundle regardless of which routes a given session ever visits. */
  component: React.LazyExoticComponent<React.ComponentType>
  /** i18n key for the browser tab title / breadcrumb -- never a literal string (I-9). */
  titleKey: string
}

export type FeatureCommandEntry = {
  id: string
  labelKey: string
  path: string
  icon?: React.ComponentType<React.SVGProps<SVGSVGElement>>
  /** v1.1 SPEC §3.1 / HANDOFFS #1: the app action this destination needs (`'work.workload.read'`).
   * The palette resolves it through the same `can()` the sidebar and the server's route use, so a
   * head-only command is invisible to a xodim instead of being a Ctrl+K shortcut to a 403. A plain
   * `string` for the same reason `NavEntry.action` is one; an id the registry does not know resolves
   * to "cannot". Omit for a destination every active member may reach. */
  action?: string
  /** v1.1 critique SEV2 #11: the session condition this entry needs, evaluated against the same
   * `NavContext` the sidebar's own `visibleWhen` gets. Some entries are gated by *state* rather than
   * by permission -- "Boʻlim yaratish" is the whole example: creating a department raises a
   * super-admin approval request, and SPEC §2.2 says the CTA exists only in the no-department state.
   * `can()` has nothing to say about that, because it is not a permission question. */
  visibleWhen?: (ctx: NavContext) => boolean
}

/** A "create this" entry for the shell's quick-add button (UI-OVERHAUL.md §2 row 1). Declarative on
 * purpose: a manifest names a path, the shell navigates there -- a feature never hands the shell a
 * callback that closes over its own screen state. */
export type FeatureQuickAddEntry = {
  id: string
  labelKey: string
  /** Where "create" lives, e.g. `/events?new=1`. */
  path: string
  icon?: React.ComponentType<React.SVGProps<SVGSVGElement>>
  /** Keycap shown in the menu, e.g. `C`. Display only -- the shell does not bind it. */
  shortcut?: string
  /** As `FeatureCommandEntry.action`: the create permission this row needs, resolved by the shell. */
  action?: string
  /** As `FeatureCommandEntry.visibleWhen`. */
  visibleWhen?: (ctx: NavContext) => boolean
}

export type FeatureManifest = {
  /** Must equal the directory name (`src/features/<name>/`) -- asserted by `registry.ts` so a typo
   * here fails loudly instead of silently mis-attributing an error message. */
  name: string
  routes: readonly FeatureRoute[]
  /** Rendered in the sidebar (and the command palette's "Go to" group) via `resolveNavEntries` --
   * omit for a feature with no sidebar presence (e.g. a settings-only screen reached another way). */
  sidebar?: readonly NavEntry[]
  /** Extra command-palette entries beyond the automatic one per sidebar entry (e.g. a "Create X"
   * action). Most features need none -- the sidebar entries already appear in the palette's
   * "Go to" group for free (see `registry.ts`). */
  commands?: readonly FeatureCommandEntry[]
  /** Entries for the top bar's quick-add menu. Omit for a feature with nothing to create. */
  quickAdd?: readonly FeatureQuickAddEntry[]
  /** A *hook* returning live counts for this feature's own sidebar entries, keyed by entry id --
   * the mechanism behind "grouped items and counts" in UI-OVERHAUL.md §2 row 1.
   *
   * It is called unconditionally, once per manifest, from the shell: the manifest list comes from an
   * eager `import.meta.glob` and never changes at runtime, so the hook order is stable (the Rules of
   * Hooks are satisfied by that invariant, not by luck). Keep it cheap -- a `useQuery` over data the
   * feature already fetches, never a request that exists only to draw a badge. A count is a fact
   * about the user's work; it is never a "soon" badge (`nav-registry.ts` still refuses those).
   */
  useSidebarCounts?: () => Readonly<Record<string, number>>
}
