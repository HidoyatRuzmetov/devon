import { QueryClient } from '@tanstack/react-query'
import { ApiError } from './api-client.js'

/** A 401 from `GET /api/v1/me` is an expected, steady-state condition for an anonymous visitor
 * (`own_account` denies with `not_authenticated`, design.md §1.6) -- retrying it is pointless and a
 * 403/404 is never going to become a 200 by itself either. Anything else (network blip, 500) gets
 * React Query's normal short retry. */
function shouldRetry(failureCount: number, error: unknown): boolean {
  if (error instanceof ApiError && [401, 403, 404, 410, 422].includes(error.status)) return false
  return failureCount < 2
}

export const queryClient = new QueryClient({
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
