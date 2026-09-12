// H9.1 "stampede protection for analytics aggregates": when several identical, concurrent requests
// (several people opening the analytics page at the same moment, a double-click, a retry racing the
// original) would each trigger the same expensive computation, this coalesces them into one in-flight
// promise -- every caller awaits the same computation and gets the same result, but the expensive work
// (a handful of aggregate queries) runs exactly once instead of once per concurrent caller.
//
// Deliberately NOT a TTL cache: an entry exists only while its computation is in flight, and is
// removed (success or failure) the instant it settles -- the next call, even one millisecond later,
// always recomputes. This sidesteps every staleness/invalidation question a real cache would raise
// (what if a card changes between requests?) while still solving the actual thundering-herd problem
// H9.1 names. In-process, not Valkey, for the same single-server-process reason
// `modules/admin/availability-gate.ts` and `modules/ai/service.ts`'s caches already document.
const inFlight = new Map<string, Promise<unknown>>()

export function singleFlight<T>(key: string, compute: () => Promise<T>): Promise<T> {
  const existing = inFlight.get(key) as Promise<T> | undefined
  if (existing) return existing
  const promise = compute().finally(() => {
    inFlight.delete(key)
  })
  inFlight.set(key, promise)
  return promise
}
