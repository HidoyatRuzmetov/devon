// React-query hooks wrapping `api.ts` (MODULE-GUIDE.md "Web features": session/api-client hooks
// pattern from `src/lib/session.ts`). Every mutation reads its CSRF token from the cached `/me`
// response (`useMeQuery`) exactly like `useLocaleMutation` already does -- never a second network
// call just to fetch a token.
import * as React from 'react'
import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
  type UseQueryResult,
  type MutateOptions,
} from '@tanstack/react-query'
import { useMeQuery } from '../../lib/session.js'
import type { Me } from '../../lib/api-schemas.js'
import {
  archiveNotifications,
  disconnectGroup,
  fetchDepartmentGroups,
  fetchDepartmentSettings,
  fetchIcsUrl,
  fetchNotifications,
  fetchPrefs,
  fetchQuietHours,
  fetchTelegramStatus,
  markAllNotificationsRead,
  markNotificationsRead,
  muteTelegram,
  putDepartmentSettings,
  putGroupKinds,
  putPrefs,
  putQuietHours,
  requestGroupConnectCode,
  requestTelegramLinkCode,
  restoreNotifications,
  snoozeNotification,
  unlinkTelegram,
  type DepartmentSettingsDto,
  type GroupKind,
  type InboxStatus,
  type PrefRow,
  type QuietHoursInput,
} from './api.js'

function useCsrfToken(): string | null {
  const meQuery = useMeQuery()
  return meQuery.data?.csrfToken ?? null
}

// --- Inbox list ------------------------------------------------------------------------------------

/** `active` is false for the two inbox tabs that are mounted but hidden (motion verdict F5: a tab
 * switch has to be a visibility change, not a 30-row unmount/remount). They still fetch once and
 * stay cached -- every mutation on this screen invalidates the whole `['inbox','notifications']`
 * prefix anyway -- but only the tab a person is actually looking at keeps polling, so three mounted
 * lists are still one poll per minute. */
export function useNotificationsQuery(status: InboxStatus, active = true) {
  return useQuery({
    queryKey: ['inbox', 'notifications', status],
    queryFn: () => fetchNotifications(status),
    staleTime: 15_000,
    // Also refresh when live delivery is unavailable; personal publications refresh this cache.
    refetchInterval: active ? 60_000 : false,
  })
}

/** H5.2 "prefetch on hover/focus" -- `nav.ts` calls this on the inbox sidebar entry's hover/focus,
 * for `inbox-screen.tsx`'s own default tab (`'inbox'`), matching its `useNotificationsQuery` key. */
export function prefetchNotifications(qc: QueryClient): Promise<unknown> {
  const status: InboxStatus = 'inbox'
  return qc.prefetchQuery({
    queryKey: ['inbox', 'notifications', status],
    queryFn: () => fetchNotifications(status),
    staleTime: 15_000,
  })
}

function useInvalidateInbox() {
  const queryClient = useQueryClient()
  return React.useCallback(
    () => queryClient.invalidateQueries({ queryKey: ['inbox', 'notifications'] }),
    [queryClient],
  )
}

export function useMarkReadMutation() {
  const csrfToken = useCsrfToken()
  const invalidate = useInvalidateInbox()
  return useMutation({
    mutationFn: (ids: string[]) => markNotificationsRead(ids, csrfToken ?? ''),
    onSuccess: invalidate,
  })
}

export function useMarkAllReadMutation() {
  const csrfToken = useCsrfToken()
  const invalidate = useInvalidateInbox()
  return useMutation({
    mutationFn: () => markAllNotificationsRead(csrfToken ?? ''),
    onSuccess: invalidate,
  })
}

export function useArchiveMutation() {
  const csrfToken = useCsrfToken()
  const invalidate = useInvalidateInbox()
  return useMutation({
    mutationFn: (ids: string[]) => archiveNotifications(ids, csrfToken ?? ''),
    onSuccess: invalidate,
  })
}

export function useSnoozeMutation() {
  const csrfToken = useCsrfToken()
  const invalidate = useInvalidateInbox()
  return useMutation({
    mutationFn: ({ id, minutes }: { id: string; minutes: number }) =>
      snoozeNotification(id, minutes, csrfToken ?? ''),
    onSuccess: invalidate,
  })
}

/** Archive is persisted before announcing success. Undo performs an owner-scoped restore,
 * so navigating away or reloading cannot silently cancel a confirmed action. */
export function useUndoableArchive() {
  const csrfToken = useCsrfToken()
  const { mutateAsync } = useArchiveMutation()
  const invalidate = useInvalidateInbox()
  return React.useCallback(
    async (id: string) => {
      const result = await mutateAsync([id])
      return {
        cancel:
          result.updated > 0
            ? async () => {
                await restoreNotifications([id], csrfToken ?? '')
                await invalidate()
              }
            : null,
      }
    },
    [mutateAsync, csrfToken, invalidate],
  )
}

// --- Preferences -----------------------------------------------------------------------------------

type PersonalSettingCommand<T, TScope> = {
  input: T
  ownerUserId: string | null
  csrfToken: string
  scope: TScope
}
class PersonalSettingScopeChanged extends Error {}
export function isPersonalSettingScopeChanged(error: unknown): boolean {
  return error instanceof PersonalSettingScopeChanged
}

/** Capture the actual owner at the public call boundary; a late receipt cannot enter another
 * account's cache, and a command delayed until after replacement cannot send under its session. */
function usePersonalSettingMutation<TInput, TData, TScope>(
  send: (input: TInput, csrfToken: string, scope: TScope) => Promise<TData>,
  merge: (data: TData, scope: TScope) => void,
  scope: TScope,
) {
  const queryClient = useQueryClient()
  const currentScope = React.useRef(scope)
  React.useLayoutEffect(() => {
    currentScope.current = scope
  }, [scope])
  const owns = (id: string | null) =>
    Boolean(id && queryClient.getQueryData<Me | null>(['me'])?.user.id === id)
  const current = (command: PersonalSettingCommand<TInput, TScope>) =>
    owns(command.ownerUserId) && Object.is(command.scope, currentScope.current)
  const mutation = useMutation({
    mutationFn: (command: PersonalSettingCommand<TInput, TScope>) => {
      if (!current(command)) throw new PersonalSettingScopeChanged('The settings context changed')
      return send(command.input, command.csrfToken, command.scope)
    },
    onSuccess: (data, command) => {
      if (owns(command.ownerUserId)) merge(data, command.scope)
    },
  })
  const command = (input: TInput): PersonalSettingCommand<TInput, TScope> => {
    const current = queryClient.getQueryData<Me | null>(['me'])
    return {
      input,
      ownerUserId: current?.user.id ?? null,
      csrfToken: current?.csrfToken ?? '',
      scope,
    }
  }
  const optionsFor = (options?: MutateOptions<TData, Error, TInput, unknown>) => ({
    ...(options?.onSuccess
      ? {
          onSuccess: (
            data: TData,
            variables: PersonalSettingCommand<TInput, TScope>,
            result: unknown,
            context: Parameters<NonNullable<typeof options.onSuccess>>[3],
          ) => {
            if (current(variables)) options.onSuccess!(data, variables.input, result, context)
          },
        }
      : {}),
    ...(options?.onError
      ? {
          onError: (
            error: Error,
            variables: PersonalSettingCommand<TInput, TScope>,
            result: unknown,
            context: Parameters<NonNullable<typeof options.onError>>[3],
          ) => {
            if (current(variables)) options.onError!(error, variables.input, result, context)
          },
        }
      : {}),
    ...(options?.onSettled
      ? {
          onSettled: (
            data: TData | undefined,
            error: Error | null,
            variables: PersonalSettingCommand<TInput, TScope>,
            result: unknown,
            context: Parameters<NonNullable<typeof options.onSettled>>[4],
          ) => {
            if (current(variables))
              options.onSettled!(data, error, variables.input, result, context)
          },
        }
      : {}),
  })
  return {
    ...mutation,
    variables: mutation.variables?.input,
    mutate: (input: TInput, options?: MutateOptions<TData, Error, TInput, unknown>) =>
      mutation.mutate(command(input), optionsFor(options)),
    mutateAsync: async (input: TInput, options?: MutateOptions<TData, Error, TInput, unknown>) => {
      const submitted = command(input)
      try {
        const data = await mutation.mutateAsync(submitted, optionsFor(options))
        if (!current(submitted))
          throw new PersonalSettingScopeChanged('The settings context changed')
        return data
      } catch (error) {
        if (!current(submitted))
          throw new PersonalSettingScopeChanged('The settings context changed')
        throw error
      }
    },
  }
}

export function usePrefsQuery() {
  return useQuery({ queryKey: ['inbox', 'prefs'], queryFn: fetchPrefs })
}

export function usePutPrefsMutation() {
  const queryClient = useQueryClient()
  return usePersonalSettingMutation(
    (items: PrefRow[], csrf: string) => putPrefs(items, csrf),
    (data) => queryClient.setQueryData(['inbox', 'prefs'], data),
    'preferences',
  )
}

// --- Quiet hours -----------------------------------------------------------------------------------

export function useQuietHoursQuery(departmentId: string | null) {
  return useQuery({
    queryKey: ['inbox', 'quiet-hours', departmentId],
    queryFn: () => fetchQuietHours(departmentId),
  })
}

export function usePutQuietHoursMutation(departmentId: string | null) {
  const queryClient = useQueryClient()
  return usePersonalSettingMutation(
    (input: QuietHoursInput, csrf: string, capturedDepartmentId: string | null) =>
      putQuietHours(capturedDepartmentId, input, csrf),
    (data, capturedDepartmentId) => {
      queryClient.setQueryData(['inbox', 'quiet-hours', capturedDepartmentId], data)
      void queryClient.invalidateQueries({ queryKey: ['inbox', 'quiet-hours'] })
    },
    departmentId,
  )
}

// --- ICS -------------------------------------------------------------------------------------------

export function useIcsUrlQuery(enabled: boolean) {
  return useQuery({ queryKey: ['inbox', 'ics-url'], queryFn: fetchIcsUrl, enabled })
}

// --- Department notification settings (head-only writes) -------------------------------------------

export function useDepartmentSettingsQuery(departmentId: string | null) {
  return useQuery({
    queryKey: ['inbox', 'department-settings', departmentId],
    queryFn: () => fetchDepartmentSettings(departmentId as string),
    enabled: Boolean(departmentId),
  })
}

export function usePutDepartmentSettingsMutation(departmentId: string | null) {
  const csrfToken = useCsrfToken()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (patch: Partial<DepartmentSettingsDto>) =>
      putDepartmentSettings(departmentId as string, patch, csrfToken ?? ''),
    onSuccess: (data) =>
      queryClient.setQueryData(['inbox', 'department-settings', departmentId], data),
  })
}

// --- Telegram: personal ------------------------------------------------------------------------------

export function useTelegramStatusQuery(
  pollWhileLinking = false,
): UseQueryResult<Awaited<ReturnType<typeof fetchTelegramStatus>>, Error> {
  return useQuery({
    queryKey: ['telegram', 'status'],
    queryFn: fetchTelegramStatus,
    refetchInterval: (query) => (pollWhileLinking && !query.state.data?.linked ? 3000 : false),
  })
}

export function useTelegramLinkCodeMutation() {
  const csrfToken = useCsrfToken()
  return useMutation({ mutationFn: () => requestTelegramLinkCode(csrfToken ?? '') })
}

export function useTelegramUnlinkMutation() {
  const csrfToken = useCsrfToken()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => unlinkTelegram(csrfToken ?? ''),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['telegram', 'status'] }),
  })
}

export function useTelegramMuteMutation() {
  const csrfToken = useCsrfToken()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (minutes: number) => muteTelegram(minutes, csrfToken ?? ''),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['telegram', 'status'] }),
  })
}

// --- Telegram: department groups ----------------------------------------------------------------

export function useDepartmentGroupsQuery(departmentId: string | null, pollWhileConnecting = false) {
  return useQuery({
    queryKey: ['telegram', 'groups', departmentId],
    queryFn: () => fetchDepartmentGroups(departmentId as string),
    enabled: Boolean(departmentId),
    refetchInterval: pollWhileConnecting ? 5000 : false,
  })
}

export function useGroupConnectCodeMutation(departmentId: string | null) {
  const csrfToken = useCsrfToken()
  return useMutation({
    mutationFn: () => requestGroupConnectCode(departmentId as string, csrfToken ?? ''),
  })
}

export function usePutGroupKindsMutation(departmentId: string | null) {
  const csrfToken = useCsrfToken()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ groupId, kinds }: { groupId: string; kinds: GroupKind[] }) =>
      putGroupKinds(departmentId as string, groupId, kinds, csrfToken ?? ''),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ['telegram', 'groups', departmentId] }),
  })
}

export function useDisconnectGroupMutation(departmentId: string | null) {
  const csrfToken = useCsrfToken()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (groupId: string) =>
      disconnectGroup(departmentId as string, groupId, csrfToken ?? ''),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ['telegram', 'groups', departmentId] }),
  })
}
