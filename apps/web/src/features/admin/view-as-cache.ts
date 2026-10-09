import type { QueryClient } from '@tanstack/react-query'
import type { Me } from '../../lib/api-schemas.js'

/** A signed view-as cookie changes the scope of every private request. Stop older responses from
 * repopulating the cache; apply the acknowledged actor context before navigation and refresh it in
 * the background without delaying a reachable Exit action. */
export async function refreshViewAsContext(
  queryClient: QueryClient,
  refreshMe: () => Promise<unknown>,
  acknowledgedDepartmentId?: string | null,
  acknowledgedUserId?: string,
): Promise<boolean> {
  const hasSameActor = () =>
    acknowledgedUserId === undefined ||
    queryClient.getQueryData<Me | null>(['me'])?.user.id === acknowledgedUserId
  if (!hasSameActor()) return false
  await queryClient.cancelQueries()
  if (!hasSameActor()) return false
  queryClient.removeQueries({
    predicate: (query) =>
      query.queryKey[0] !== 'me' &&
      query.queryKey[0] !== 'instance' &&
      // The real actor remains the same. An unsaved language is owner-scoped local intent,
      // not a cached read from the previous department.
      query.queryKey[0] !== 'locale-preference-recovery',
  })
  // The successful signed start/stop response already establishes this context. Preserve a
  // reachable exit even if the follow-up read fails; never create a session or change its actor.
  if (acknowledgedDepartmentId !== undefined) {
    queryClient.setQueryData<Me | null>(['me'], (me) =>
      me?.user.role === 'super_admin'
        ? {
            ...me,
            activeDepartmentId: acknowledgedDepartmentId,
            memberships: [],
            membershipCount: 0,
            actingForUserId: null,
          }
        : me,
    )
  }
  // Navigation/Exit availability follows the acknowledged write, never the retry duration of a
  // follow-up read. The query itself reports its failure and supplies the screen's Retry action.
  void refreshMe()
    .catch(() => undefined)
    .finally(() =>
      queryClient.invalidateQueries({ predicate: (query) => query.queryKey[0] !== 'me' }),
    )
    .catch(() => undefined)
  return true
}
