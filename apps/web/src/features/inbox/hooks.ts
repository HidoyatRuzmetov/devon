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
} from '@tanstack/react-query'
import { useMeQuery } from '../../lib/session.js'
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

export function useNotificationsQuery(status: InboxStatus) {
  return useQuery({
    queryKey: ['inbox', 'notifications', status],
    queryFn: () => fetchNotifications(status),
    staleTime: 15_000,
    refetchInterval: 60_000, // a lightweight poll -- there is no realtime push transport in this epic
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

/** "Undo over confirm" (CLAUDE.md): archiving does not ask "are you sure?" -- it happens immediately
 * and a toast offers a few seconds to undo. Since the API has no unarchive endpoint, "undo" here means
 * the archive call is delayed (never fired if the caller's own `cancel()` runs first), not reversed
 * after the fact -- the same effect, without a server round-trip either way. */
export function useUndoableArchive(delayMs = 5000) {
  const csrfToken = useCsrfToken()
  const queryClient = useQueryClient()
  const invalidate = useInvalidateInbox()
  const timers = React.useRef(new Map<string, ReturnType<typeof setTimeout>>())

  const commit = React.useCallback(
    (batchId: string, ids: string[]) => {
      timers.current.delete(batchId)
      void archiveNotifications(ids, csrfToken ?? '').then(invalidate)
    },
    [csrfToken, invalidate],
  )

  const archive = React.useCallback(
    (ids: string[]): { batchId: string; cancel: () => void } => {
      const batchId = ids.join(',') + ':' + Date.now()
      // Optimistic: the row disappears from every cached inbox list right away (design's "undo over
      // confirm" means the action *looks* done immediately); `previous` is every list this touched, so
      // `cancel()` below can put the exact same rows back rather than re-fetching.
      const previous = queryClient.getQueriesData<{ items: { id: string }[] }>({
        queryKey: ['inbox', 'notifications'],
      })
      for (const [key, data] of previous) {
        if (!data) continue
        queryClient.setQueryData(key, {
          ...data,
          items: data.items.filter((n) => !ids.includes(n.id)),
        })
      }
      const timer = setTimeout(() => commit(batchId, ids), delayMs)
      timers.current.set(batchId, timer)
      return {
        batchId,
        cancel: () => {
          const t = timers.current.get(batchId)
          if (t) {
            clearTimeout(t)
            timers.current.delete(batchId)
          }
          for (const [key, data] of previous) queryClient.setQueryData(key, data)
        },
      }
    },
    [commit, delayMs, queryClient],
  )

  React.useEffect(() => {
    const map = timers.current
    return () => {
      for (const t of map.values()) clearTimeout(t)
    }
  }, [])

  return archive
}

// --- Preferences -----------------------------------------------------------------------------------

export function usePrefsQuery() {
  return useQuery({ queryKey: ['inbox', 'prefs'], queryFn: fetchPrefs })
}

export function usePutPrefsMutation() {
  const csrfToken = useCsrfToken()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (items: PrefRow[]) => putPrefs(items, csrfToken ?? ''),
    onSuccess: (data) => queryClient.setQueryData(['inbox', 'prefs'], data),
  })
}

// --- Quiet hours -----------------------------------------------------------------------------------

export function useQuietHoursQuery(departmentId: string | null) {
  return useQuery({
    queryKey: ['inbox', 'quiet-hours', departmentId],
    queryFn: () => fetchQuietHours(departmentId),
  })
}

export function usePutQuietHoursMutation(departmentId: string | null) {
  const csrfToken = useCsrfToken()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: QuietHoursInput) => putQuietHours(departmentId, input, csrfToken ?? ''),
    onSuccess: (data) => queryClient.setQueryData(['inbox', 'quiet-hours', departmentId], data),
  })
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

export function useTelegramStatusQuery(): UseQueryResult<
  Awaited<ReturnType<typeof fetchTelegramStatus>>,
  Error
> {
  return useQuery({ queryKey: ['telegram', 'status'], queryFn: fetchTelegramStatus })
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

export function useDepartmentGroupsQuery(departmentId: string | null) {
  return useQuery({
    queryKey: ['telegram', 'groups', departmentId],
    queryFn: () => fetchDepartmentGroups(departmentId as string),
    enabled: Boolean(departmentId),
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
