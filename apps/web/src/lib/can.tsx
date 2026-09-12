// The client half of the v1.1 permission matrix (SPEC §2, §3.1).
//
// One rule, stated once: **the server decides, the client only hides.** Everything here reads the
// same `APP_ACTIONS` registry `@devon/api` declares its routes against and resolves it through the
// same `can()` -- so a sidebar entry, a palette command, a page-header button and the route that
// backs them can never disagree. If this file were deleted, nothing would become *permitted*; some
// buttons would simply appear that answer 403 when pressed.
//
// `useCan` builds an `Actor` from `/me` (role + memberships + active department). That is exactly
// what the server builds from the session cookie, minus `viewAs`, which the client learns about
// separately (`useIsViewingAs`).
import * as React from 'react'
import {
  canAction,
  type ActionContext,
  type ActionSettings,
  type Actor,
  type AppActionId,
  type Decision,
  type DenyReason,
} from '@devon/contracts'
import { useDepartment, useSession } from './session.js'

/** The department settings that can widen a member's reach (`allowStructureEdit`,
 * `allowSelfAssign`, `whoCanConnectTelegramGroup`). A screen that has loaded
 * `GET /departments/:id` passes them in; a screen that has not gets the strict answer, which is the
 * fail-closed direction. */
const SettingsContext = React.createContext<ActionSettings | null>(null)

export function PermissionSettingsProvider({
  settings,
  children,
}: {
  settings: ActionSettings | null
  children: React.ReactNode
}): React.JSX.Element {
  return <SettingsContext.Provider value={settings}>{children}</SettingsContext.Provider>
}

/** The `Actor` this browser session is, in the department it is currently working in. Memoised on
 * the two facts it derives from so `useCan` is stable across renders. */
export function useActor(): Actor | null {
  const { user, memberships, isAuthenticated } = useSession()
  const { departmentId } = useDepartment()

  return React.useMemo(() => {
    if (!isAuthenticated || !user) return null
    return {
      userId: user.id,
      role: user.role,
      memberships: memberships.map((m) => ({
        departmentId: m.departmentId,
        role: m.role,
      })),
      departmentId,
      actingFor: null,
      // A super admin's read-only lens is a server-side fact carried by a cookie this script cannot
      // read. Leaving it null here only ever makes the client *stricter* about writes than the
      // server, never looser: every write route refuses under view-as regardless.
      viewAs: null,
    }
  }, [isAuthenticated, user, memberships, departmentId])
}

export type UseCanResult = Decision & {
  allowed: boolean
  /** Why not, for the shared no-permission state's copy. `null` when allowed. */
  reason: DenyReason | null
}

/**
 * "May I?" for one action, optionally about one object.
 *
 * ```tsx
 * const canEditCard = useCan('work.card.edit', { ownerUserIds: card.ownerUserIds })
 * const canSeeTable = useCan('people.table.read')
 * ```
 *
 * Omitting the object asks the *capability* question ("does this person ever get to do this here?"),
 * which is what a sidebar entry or a palette command needs. Passing `ownerUserIds` asks about that
 * specific row, which is what a button on a card needs. See `canAction`'s own doc comment.
 */
export function useCan(
  action: AppActionId,
  ctx: Omit<ActionContext, 'settings'> = {},
): UseCanResult {
  const actor = useActor()
  const { departmentId } = useDepartment()
  const settings = React.useContext(SettingsContext)

  const departmentIdForCheck = ctx.departmentId ?? departmentId
  const ownerUserIds = ctx.ownerUserIds
  const subjectUserId = ctx.subjectUserId

  return React.useMemo(() => {
    const decision = canAction(actor, action, {
      departmentId: departmentIdForCheck,
      ownerUserIds: ownerUserIds ?? null,
      subjectUserId: subjectUserId ?? null,
      settings,
    })
    return decision.allowed
      ? { allowed: true as const, reason: null }
      : { allowed: false as const, reason: decision.reason }
  }, [actor, action, departmentIdForCheck, ownerUserIds, subjectUserId, settings])
}

/** Several actions at once, for a screen that gates a whole row of controls. Stable identity as long
 * as the action list is stable -- pass a module-level constant array, not an inline literal. */
export function useCanMany(
  actions: readonly AppActionId[],
  ctx: Omit<ActionContext, 'settings'> = {},
): Readonly<Record<string, boolean>> {
  const actor = useActor()
  const { departmentId } = useDepartment()
  const settings = React.useContext(SettingsContext)
  const departmentIdForCheck = ctx.departmentId ?? departmentId

  return React.useMemo(() => {
    const out: Record<string, boolean> = {}
    for (const action of actions) {
      out[action] = canAction(actor, action, {
        departmentId: departmentIdForCheck,
        ownerUserIds: ctx.ownerUserIds ?? null,
        subjectUserId: ctx.subjectUserId ?? null,
        settings,
      }).allowed
    }
    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps -- ctx fields are read individually above
  }, [actor, actions, departmentIdForCheck, ctx.ownerUserIds, ctx.subjectUserId, settings])
}

export type CanProps = {
  action: AppActionId
  ownerUserIds?: readonly string[] | null
  subjectUserId?: string | null
  departmentId?: string | null
  children: React.ReactNode
  /** Rendered instead when the viewer may not. Omit to render nothing -- the default, because a
   * control a person may never use is noise, not information (DESIGN.md: no disabled-and-unexplained
   * affordances). Inside an already-open detail sheet, prefer passing a disabled copy here so the
   * layout does not jump. */
  fallback?: React.ReactNode
}

/**
 * The declarative form. Use it for whole blocks -- a settings section, a management group, a row of
 * actions -- and `useCan` where the answer changes a single prop.
 *
 * ```tsx
 * <Can action="fields.definition.manage"><FieldManager /></Can>
 * ```
 */
export function Can({
  action,
  ownerUserIds,
  subjectUserId,
  departmentId,
  children,
  fallback = null,
}: CanProps): React.JSX.Element {
  const decision = useCan(action, {
    ownerUserIds: ownerUserIds ?? null,
    subjectUserId: subjectUserId ?? null,
    departmentId: departmentId ?? null,
  })
  return <>{decision.allowed ? children : fallback}</>
}

/** True when the viewer is the boshqarma boshlig'i of the department they are working in. Prefer a
 * named action (`useCan('people.table.read')`) wherever one exists -- this is for the handful of
 * places that genuinely branch on the *role* itself, like which Home to render. */
export function useIsHead(): boolean {
  const { department } = useDepartment()
  return department?.role === 'head'
}
