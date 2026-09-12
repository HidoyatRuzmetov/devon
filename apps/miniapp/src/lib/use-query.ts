// A 70-line data hook instead of TanStack Query.
//
// The web app carries a full query cache because it has dozens of interdependent screens, background
// refetching and optimistic board moves. This app has seven screens, each of which loads one thing
// when it opens, and it runs on a phone over a mobile network -- 13 kB of cache machinery buys
// nothing here and costs first paint inside a sheet the user opened two seconds ago. What it does
// need is exactly what this gives: the four states every screen must render (DESIGN.md §4 /I-10),
// a refetch, and cancellation when the screen closes.
import * as React from 'react'
import { ApiError } from './api.js'

// `error` is present (as `null`) on every member, not only on the failed one. A screen asks
// `query.error` while rendering, long after it has already branched on `data`; forcing each of those
// call sites to re-narrow on `status` first would buy nothing and cost a `status === 'error' ?`
// ternary in eight places.
export type QueryState<T> =
  | { status: 'loading'; data: T | null; error: null }
  | { status: 'ready'; data: T; error: null }
  | { status: 'error'; data: T | null; error: ApiError | null }

export type Query<T> = QueryState<T> & {
  /** Re-runs the fetch, keeping the current data on screen while it does (so a pull-to-refresh does
   * not blank the list). */
  refetch: () => void
  /** Writes a new value straight into the state -- for a mutation that already returned the updated
   * object, so the screen never has to round-trip twice. */
  set: (next: T) => void
}

export function useQuery<T>(fetcher: () => Promise<T>, deps: React.DependencyList): Query<T> {
  const [state, setState] = React.useState<QueryState<T>>({
    status: 'loading',
    data: null,
    error: null,
  })
  const [attempt, setAttempt] = React.useState(0)
  // The fetcher is rebuilt on every render by design (it closes over screen state); `deps` is what
  // decides when the request actually re-runs, exactly like an effect.
  const fetcherRef = React.useRef(fetcher)
  fetcherRef.current = fetcher

  React.useEffect(() => {
    let cancelled = false
    setState((prev) => ({ status: 'loading', data: prev.data, error: null }))
    fetcherRef
      .current()
      .then((data) => {
        if (!cancelled) setState({ status: 'ready', data, error: null })
      })
      .catch((error: unknown) => {
        if (cancelled) return
        setState((prev) => ({
          status: 'error',
          data: prev.data,
          error: error instanceof ApiError ? error : null,
        }))
      })
    return () => {
      cancelled = true
    }
    // `deps` is spread deliberately: the fetcher closes over screen state and is rebuilt every
    // render, so the caller's `deps` -- not the closure -- is what decides when the request re-runs.
  }, [...deps, attempt])

  return React.useMemo<Query<T>>(
    () => ({
      ...state,
      refetch: () => setAttempt((n) => n + 1),
      set: (next: T) => setState({ status: 'ready', data: next, error: null }),
    }),
    [state],
  )
}
