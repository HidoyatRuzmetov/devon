// Reads every `src/features/<name>/manifest.ts(x)` via `import.meta.glob` (MODULE-GUIDE.md "Web
// features") so the shell (`app.tsx`, `shell/nav.ts`, `shell/command-palette-controller.tsx`) never
// needs an edit when a feature directory is added or removed -- several agents can each add one in
// parallel without touching this file or each other's.
//
// `eager: true` only loads the *manifest* modules up front (cheap: a manifest is metadata plus a
// `React.lazy(...)` wrapper, never the screen component itself) -- the actual screen code a manifest
// points at is still code-split exactly as `React.lazy` promises, fetched only when its route renders.
import type {
  FeatureCommandEntry,
  FeatureManifest,
  FeatureQuickAddEntry,
  FeatureRoute,
} from './types.js'

const manifestModules = import.meta.glob<{ default: FeatureManifest }>(
  ['./*/manifest.ts', './*/manifest.tsx'],
  { eager: true },
)

/** Directory name a manifest was discovered under, from its glob key (`./people/manifest.tsx` ->
 * `people`) -- used only to catch a manifest whose own `name` field disagrees with where it lives. */
function dirNameOf(globKey: string): string {
  return globKey.split('/')[1] ?? globKey
}

function allManifests(): FeatureManifest[] {
  return Object.keys(manifestModules)
    .sort((a, b) => a.localeCompare(b)) // deterministic order, same reasoning as the API loader
    .map((key) => {
      const manifest = manifestModules[key]!.default
      const dir = dirNameOf(key)
      if (manifest.name !== dir) {
        throw new Error(
          `feature registry: "src/features/${dir}/manifest.ts(x)" exports name "${manifest.name}" -- must match its directory name "${dir}"`,
        )
      }
      return manifest
    })
}

export function getFeatureManifests(): FeatureManifest[] {
  return allManifests()
}

export function getFeatureRoutes(): FeatureRoute[] {
  return allManifests().flatMap((m) => m.routes)
}

/** Exact-path lookup for `app.tsx`'s `RouteOutlet` -- `null` when no feature owns `pathname`, so the
 * caller falls through to the five core routes unchanged. */
export function matchFeatureRoute(pathname: string): FeatureRoute | null {
  return getFeatureRoutes().find((r) => r.path === pathname) ?? null
}

export function getFeatureSidebarEntries(): NonNullable<FeatureManifest['sidebar']>[number][] {
  return allManifests().flatMap((m) => m.sidebar ?? [])
}

export function getFeatureCommandEntries(): FeatureCommandEntry[] {
  return allManifests().flatMap((m) => m.commands ?? [])
}

/** Everything the top bar's quick-add menu offers, in manifest order. */
export function getFeatureQuickAddEntries(): FeatureQuickAddEntry[] {
  return allManifests().flatMap((m) => m.quickAdd ?? [])
}

/** Calls every manifest's `useSidebarCounts` hook and merges the results into one map keyed by
 * sidebar-entry id. Safe as a hook despite the loop: `allManifests()` is derived from an eager
 * `import.meta.glob` sorted by path, so both the list and its order are fixed for the life of the
 * bundle -- the call order can never change between renders. */
export function useFeatureSidebarCounts(): Readonly<Record<string, number>> {
  const counts: Record<string, number> = {}
  for (const manifest of allManifests()) {
    if (!manifest.useSidebarCounts) continue
    Object.assign(counts, manifest.useSidebarCounts())
  }
  return counts
}
