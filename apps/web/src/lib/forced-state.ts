// `?__state=` forcing (design.md §8 "Frontend shell decisions", this item's handoff: "State forcing
// via ?__state= behind DEVON_E2E"). `import.meta.env.DEVON_E2E` is a statically-replaced Vite env
// (see `src/vite.config.ts`'s `envPrefix`); when it is not `'1'` this whole module's branch folds to
// `null` at build time and Rollup's tree-shaking removes the parsing code from the production bundle
// -- verified by `agentic/scripts/check-bundle.mjs`'s budget (a live grep for the literal string
// `__state` in the shipped bundle is EPIC-000.9's evidence to produce, per this item's handoff).
import type { StateKind } from '@devon/ui'
import { useSearchParams } from './router.js'

const FORCEABLE: readonly StateKind[] = ['empty', 'loading', 'error', 'forbidden', 'offline']

function isForceableState(value: string | null): value is StateKind {
  return value !== null && (FORCEABLE as readonly string[]).includes(value)
}

/** `null` means "render this route's real, organic state" -- every route falls back to that in
 * production, and in dev/test whenever the flag is off or the param is absent/invalid. */
export function useForcedState(): StateKind | null {
  const params = useSearchParams()
  if (import.meta.env.DEVON_E2E !== '1') return null
  const value = params.get('__state')
  return isForceableState(value) ? value : null
}
