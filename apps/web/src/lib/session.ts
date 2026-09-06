// Query/mutation hooks wrapping `api-client.ts` (design.md §1.7). Kept separate from the client
// itself so components never call `fetch`/`useQuery` with a hand-rolled key -- every consumer of "am
// I signed in" or "what does this instance look like" reads the same cached query.
import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query'
import { setLocale, type Locale } from '@devon/i18n'
import {
  ApiError,
  fetchInstance,
  fetchMe,
  fetchReadyz,
  logout as apiLogout,
  patchMe,
} from './api-client.js'
import type { InstancePublic, Me, Readyz } from './api-schemas.js'
import { persistLocale } from './locale-boot.js'

export function useInstanceQuery(): UseQueryResult<InstancePublic, Error> {
  return useQuery({ queryKey: ['instance'], queryFn: fetchInstance })
}

/** design.md §6.4: the `/admin` health card's three rows (API · Database · Queue) are fed by
 * `/readyz`. Enabled only while the caller is (or might be) `super_admin` -- `/admin` passes
 * `enabled` so an anonymous or `member` visitor never issues this request at all. */
export function useReadyzQuery(enabled: boolean): UseQueryResult<Readyz, Error> {
  return useQuery({ queryKey: ['readyz'], queryFn: fetchReadyz, enabled })
}

/** `error` is only ever a genuine failure here -- an anonymous visitor's 401 is modelled as
 * `data: undefined, isError: false` (see `queryFn` below), because "nobody is signed in" is not an
 * error condition for the shell to show `<StateView kind="error">` over (design.md §6.2: the pristine
 * login form, not an error screen, is what an anonymous visitor sees). */
export function useMeQuery(): UseQueryResult<Me | null, Error> {
  return useQuery({
    queryKey: ['me'],
    queryFn: async () => {
      try {
        return await fetchMe()
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) return null
        throw err
      }
    },
  })
}

export function useLocaleMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (locale: Locale) => {
      const me = queryClient.getQueryData<Me | null>(['me'])
      if (!me) return null
      return patchMe({ locale }, me.csrfToken)
    },
    onMutate: async (locale: Locale) => {
      // Optimistic: the visible language changes instantly (design.md §4.3: "the change is its own
      // feedback, ... no page reload"); the PATCH below is a best-effort sync of the server-side
      // preference, not a precondition for the switch to have happened.
      setLocale(locale)
      persistLocale(locale)
    },
    onSuccess: (updated) => {
      if (updated) queryClient.setQueryData(['me'], updated)
    },
  })
}

export function useLogoutMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: apiLogout,
    onSettled: () => {
      // The session is gone server-side (or was already) either way; drop every cached response that
      // could have carried a signed-in shape (AC-13: a captured cookie must not keep working, and the
      // client must not keep rendering as if it did).
      queryClient.setQueryData(['me'], null)
      queryClient.removeQueries({ queryKey: ['admin'] })
    },
  })
}
