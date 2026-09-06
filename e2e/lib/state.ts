// `?__state=` forcing (design.md §8, AC-7's evidence producer, this item's handoff: "State forcing
// reads ?__state=empty|loading|error|forbidden|offline (behind DEVON_E2E=1)"). Mirrors
// `apps/web/src/lib/forced-state.ts`'s `StateKind` union so a typo here fails `tsc`, not a silent
// no-op screenshot of the organic page.
export const FORCEABLE_STATES = ['empty', 'loading', 'error', 'forbidden', 'offline'] as const
export type ForceableState = (typeof FORCEABLE_STATES)[number]

export function withForcedState(path: string, state: ForceableState): string {
  const url = new URL(path, 'http://placeholder.invalid')
  url.searchParams.set('__state', state)
  return `${url.pathname}${url.search}`
}
