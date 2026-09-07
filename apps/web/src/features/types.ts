// The shape every `src/features/<name>/manifest.ts(x)` must export as its default (MODULE-GUIDE.md
// "Web features"). Kept deliberately small and serialisable-ish: a route is a path, a *lazy* component
// (never imported eagerly -- see `registry.ts`) and a title key; a sidebar/command entry is exactly
// what `@devon/ui`'s `NavEntry`/`CommandPaletteGroup` already expect, so the shell never needs a
// feature-specific adapter.
import type * as React from 'react'
import type { NavEntry } from '@devon/ui'

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
