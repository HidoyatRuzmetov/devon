// Query/mutation hooks wrapping `api-client.ts` (design.md §1.7). Kept separate from the client
// itself so components never call `fetch`/`useQuery` with a hand-rolled key -- every consumer of "am
// I signed in" or "what does this instance look like" reads the same cached query.
import * as React from 'react'
import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
  type UseQueryResult,
  type MutateOptions,
} from '@tanstack/react-query'
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
import {
  LOCALE_PREFERENCE_RECOVERY_KEY,
  readLocalePreferenceRecovery,
  persistLocalePreferenceRecovery,
  type LocalePreferenceRecovery,
} from './locale-preference-recovery.js'

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

type LocalePreferenceInput = { locale: Locale; ownerUserId: string | null }
type LocalePreferenceContext = { version: number }
type LocalePreferenceOptions = MutateOptions<Me | null, Error, Locale, LocalePreferenceContext>
const localePreferenceVersions = new WeakMap<QueryClient, number>()

function setLocalePreferenceRecovery(
  queryClient: QueryClient,
  recovery: LocalePreferenceRecovery | null,
): void {
  queryClient.setQueryData(LOCALE_PREFERENCE_RECOVERY_KEY, recovery)
  persistLocalePreferenceRecovery(recovery)
}

/** Only the exact owner can see or retry a saved local intent. A replacement session never inherits
 * another account's write command, even if its document was reloaded before a response arrived. */
export function useLocalePreferenceRecovery(me: Me | null | undefined) {
  const queryClient = useQueryClient()
  const { data } = useQuery({
    queryKey: LOCALE_PREFERENCE_RECOVERY_KEY,
    queryFn: readLocalePreferenceRecovery,
    initialData: readLocalePreferenceRecovery,
    enabled: false,
    staleTime: Infinity,
    gcTime: Infinity,
  })
  React.useEffect(() => {
    if (me === undefined || !data || data.ownerUserId === me?.user.id) return
    if (queryClient.getQueryData(LOCALE_PREFERENCE_RECOVERY_KEY) === data)
      setLocalePreferenceRecovery(queryClient, null)
  }, [data, me, queryClient])
  return data?.ownerUserId === me?.user.id ? data : null
}

function localePreferenceOptions(
  options?: LocalePreferenceOptions,
): MutateOptions<Me | null, Error, LocalePreferenceInput, LocalePreferenceContext> | undefined {
  if (!options) return undefined
  return {
    ...(options.onSuccess
      ? {
          onSuccess: (data, input, result, context) =>
            options.onSuccess!(data, input.locale, result, context),
        }
      : {}),
    ...(options.onError
      ? {
          onError: (error, input, result, context) =>
            options.onError!(error, input.locale, result, context),
        }
      : {}),
    ...(options.onSettled
      ? {
          onSettled: (data, error, input, result, context) =>
            options.onSettled!(data, error, input.locale, result, context),
        }
      : {}),
  }
}

export function useLocaleMutation() {
  const queryClient = useQueryClient()

  const mutation = useMutation({
    scope: { id: 'locale-preference' },
    mutationFn: async ({ locale, ownerUserId }: LocalePreferenceInput) => {
      const me = queryClient.getQueryData<Me | null>(['me'])
      if (!me || me.user.id !== ownerUserId) return null
      return patchMe({ locale }, me.csrfToken)
    },
    onMutate: ({ locale, ownerUserId }: LocalePreferenceInput): LocalePreferenceContext => {
      const version = (localePreferenceVersions.get(queryClient) ?? 0) + 1
      localePreferenceVersions.set(queryClient, version)
      if ((queryClient.getQueryData<Me | null>(['me'])?.user.id ?? null) !== ownerUserId)
        return { version }
      // Optimistic: the visible language changes instantly (design.md §4.3: "the change is its own
      // feedback, ... no page reload"). The server acknowledgement is tracked separately so a
      // failed save retains the choice and offers an explicit retry, including after reload.
      setLocale(locale)
      persistLocale(locale)
      const previous = queryClient.getQueryData<LocalePreferenceRecovery | null>(
        LOCALE_PREFERENCE_RECOVERY_KEY,
      )
      if (ownerUserId)
        setLocalePreferenceRecovery(queryClient, {
          locale,
          ownerUserId,
          status: 'pending',
          showNotice: Boolean(
            previous?.ownerUserId === ownerUserId &&
            previous.locale === locale &&
            previous.showNotice,
          ),
        })
      return { version }
    },
    onError: (_error, input, context) => {
      if (
        context?.version !== localePreferenceVersions.get(queryClient) ||
        !input.ownerUserId ||
        queryClient.getQueryData<Me | null>(['me'])?.user.id !== input.ownerUserId
      )
        return
      setLocalePreferenceRecovery(queryClient, {
        locale: input.locale,
        ownerUserId: input.ownerUserId,
        status: 'failed',
        showNotice: true,
      })
    },
    onSuccess: (updated, input, context) => {
      if (!updated || context.version !== localePreferenceVersions.get(queryClient)) return
      if (
        queryClient.getQueryData<Me | null>(['me'])?.user.id !== input.ownerUserId ||
        updated.user.id !== input.ownerUserId
      )
        return
      queryClient.setQueryData<Me | null>(['me'], (current) =>
        current?.user.id === input.ownerUserId && updated.user.id === input.ownerUserId
          ? { ...current, user: { ...current.user, locale: updated.user.locale } }
          : current,
      )
      setLocalePreferenceRecovery(queryClient, null)
    },
  })
  const input = (locale: Locale): LocalePreferenceInput => ({
    locale,
    ownerUserId: queryClient.getQueryData<Me | null>(['me'])?.user.id ?? null,
  })
  return {
    ...mutation,
    variables: mutation.variables?.locale,
    mutate: (locale: Locale, options?: LocalePreferenceOptions) =>
      mutation.mutate(input(locale), localePreferenceOptions(options)),
    mutateAsync: (locale: Locale, options?: LocalePreferenceOptions) =>
      mutation.mutateAsync(input(locale), localePreferenceOptions(options)),
  }
}

/** Cancel in-flight reads before dropping every private cache, including mutation results. */
export async function clearSessionCache(queryClient: QueryClient): Promise<void> {
  await queryClient.cancelQueries()
  setLocalePreferenceRecovery(queryClient, null)
  queryClient.clear()
  queryClient.setQueryData(['me'], null)
  storeDepartmentId(null)
}

export function useLogoutMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: apiLogout,
    onSettled: () => clearSessionCache(queryClient),
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
