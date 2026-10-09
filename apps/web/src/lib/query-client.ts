import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query'
import { ApiError } from './api-client.js'

/** A 401 from `GET /api/v1/me` is an expected, steady-state condition for an anonymous visitor
 * (`own_account` denies with `not_authenticated`, design.md §1.6) -- retrying it is pointless and a
 * 403/404 is never going to become a 200 by itself either. Anything else (network blip, 500) gets
 * React Query's normal short retry. */
function shouldRetry(failureCount: number, error: unknown): boolean {
  if (error instanceof ApiError && [401, 403, 404, 410, 422].includes(error.status)) return false
  return failureCount < 2
}

export function createQueryClient(): QueryClient {
  let sessionRevalidation: Promise<void> | null = null
  function revalidateSession(error: unknown): void {
    if (
      !(error instanceof ApiError) ||
      error.status !== 401 ||
      !client.getQueryData(['me']) ||
      sessionRevalidation
    )
      return
    // A feature's refusal may belong to an expired, older request. Ask the authoritative session
    // query using the current cookie instead of signing out a replacement session from that error.
    // Share an existing /me read; concurrent polling/mutation refusals must not cancel it repeatedly.
    sessionRevalidation = client
      .invalidateQueries({ queryKey: ['me'], exact: true }, { cancelRefetch: false })
      .finally(() => {
        sessionRevalidation = null
      })
  }
  const client = new QueryClient({
    queryCache: new QueryCache({
      onError: (error, query) => {
        if (query.queryKey[0] !== 'me') revalidateSession(error)
      },
    }),
    mutationCache: new MutationCache({ onError: revalidateSession }),
    defaultOptions: {
      queries: {
        retry: shouldRetry,
        staleTime: 30_000,
        refetchOnWindowFocus: false,
      },
      mutations: {
        retry: false,
      },
    },
  })
  return client
}

export const queryClient = createQueryClient()
