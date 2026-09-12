// Query/mutation hooks wrapping `api-client.ts` (design.md §1.7). Kept separate from the client
// itself so components never call `fetch`/`useQuery` with a hand-rolled key -- every consumer of "am
// I signed in" or "what does this instance look like" reads the same cached query.
import * as React from 'react'
import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query'
import { setLocale, type Locale } from '@devon/i18n'
import {
  ApiError,
  fetchInstance,
  fetchMe,
  fetchReadyz,
  logout as apiLogout,
  patchMe,
  setActiveDepartment,
} from './api-client.js'
import type { InstancePublic, Me, Readyz } from './api-schemas.js'
import { persistLocale } from './locale-boot.js'
import { ACTIVE_DEPARTMENT_STORAGE_KEY } from './constants.js'

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

// --- useSession() / useDepartment() (MODULE-GUIDE.md "Web features") -----------------------------
// The one place a feature module reads "who is signed in" / "which department" -- both sit on top of
// `useMeQuery()` above, never a second network call of their own.

export type Session = {
  user: Me['user'] | null
  memberships: Me['memberships']
  membershipCount: number
  /** True while the very first `/me` request is in flight -- render a loading state, never a
   * logged-out one, until this settles (design.md §8.2). */
  isLoading: boolean
  isAuthenticated: boolean
}

export function useSession(): Session {
  const meQuery = useMeQuery()
  const me = meQuery.data
  return {
    user: me?.user ?? null,
    memberships: me?.memberships ?? [],
    membershipCount: me?.membershipCount ?? 0,
    isLoading: meQuery.isPending,
    isAuthenticated: Boolean(me),
  }
}

function readStoredDepartmentId(): string | null {
  try {
    return window.localStorage.getItem(ACTIVE_DEPARTMENT_STORAGE_KEY)
  } catch {
    return null
  }
}

function storeDepartmentId(id: string | null): void {
  try {
    if (id) window.localStorage.setItem(ACTIVE_DEPARTMENT_STORAGE_KEY, id)
    else window.localStorage.removeItem(ACTIVE_DEPARTMENT_STORAGE_KEY)
  } catch {
    // Storage disabled -- the switch still works for the rest of this session (in-memory state).
  }
}

export type Department = {
  departmentId: string
  name: string
  role: 'head' | 'member'
}

export type UseDepartmentResult = {
  /** `null` until memberships load, or for a user with none yet. */
  department: Department | null
  departmentId: string | null
  memberships: readonly Department[]
  /** v1.1 SPEC §2.3: calls `POST /me/active-department`, which sets the signed `devon_dept` cookie
   * the server resolves `actor.departmentId` from, then invalidates every cached query so the whole
   * app re-reads in the new department. The local copy updates first so the switcher's check mark
   * moves immediately; a failed request falls back to whatever the server still says on `/me`. */
  setDepartmentId(id: string | null): void
  /** True while the switch is in flight -- the switcher disables itself rather than letting two
   * departments race. */
  isSwitching: boolean
}

/** Resolution order: the server's `activeDepartmentId` (once a later epic populates it) → this
 * browser's stored switcher choice, if it is still a membership the user actually has → the user's
 * first membership → `null` (no department at all yet). */
export function useDepartment(): UseDepartmentResult {
  const { memberships } = useSession()
  const [override, setOverride] = React.useState<string | null>(readStoredDepartmentId)
  const meQuery = useMeQuery()
  const queryClient = useQueryClient()

  const serverActiveId = meQuery.data?.activeDepartmentId ?? null
  const overrideIsValid = override !== null && memberships.some((m) => m.departmentId === override)
  // The server's answer wins: since v1.1 it is a real per-request decision (the signed `devon_dept`
  // cookie), not a placeholder. The local override only bridges the moment between clicking the
  // switcher and the response landing, and only for a department the user actually belongs to.
  const departmentId =
    serverActiveId ?? (overrideIsValid ? override : (memberships[0]?.departmentId ?? null))
  const department = memberships.find((m) => m.departmentId === departmentId) ?? null

  const switchMutation = useMutation({
    mutationFn: async (id: string) => {
      const me = queryClient.getQueryData<Me | null>(['me'])
      if (!me) return null
      return setActiveDepartment(id, me.csrfToken)
    },
    onSuccess: (updated) => {
      if (updated) queryClient.setQueryData(['me'], updated)
      // Every department-scoped query in the cache is now about the wrong department.
      void queryClient.invalidateQueries()
    },
  })

  const setDepartmentId = React.useCallback(
    (id: string | null) => {
      setOverride(id)
      storeDepartmentId(id)
      if (id) switchMutation.mutate(id)
    },
    [switchMutation],
  )

  return {
    department,
    departmentId,
    memberships,
    setDepartmentId,
    isSwitching: switchMutation.isPending,
  }
}
