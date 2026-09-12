// The v1.1 permission matrix as data (SPEC §2.2, PERMISSIONS-AUDIT §4).
//
// `can()` (./permissions.ts) decides; this file is the *vocabulary* both sides speak. Every feature
// area names the actions it has, each action names the subject kind it reduces to, and both the
// server (route declarations, `assertCan`) and the client (`useCan`, `<Can>`, sidebar entries,
// palette commands, page-header actions) resolve the same id through `canAction()`. That is how a
// member's sidebar and the server's 403 can never drift apart: one table, two readers.
//
// Deliberately NOT a second decision function. `canAction()` builds a `Subject` and calls `can()`;
// nothing here re-implements a rule, and no module is allowed to hand-roll `role === 'head'` (I-7).
import { can, type Action, type Actor, type Decision, type Subject } from './permissions.js'

/** One per product area. Matches the API module names and the web feature directories, so
 * `actionsForArea('work')` is answerable from either side. */
export const FEATURE_AREAS = [
  'accounts',
  'departments',
  'structure',
  'work',
  'projects',
  'events',
  'personal',
  'inbox',
  'analytics',
  'pages',
  'ai',
  'people',
  'fields',
  'goals',
  'automations',
  'admin',
] as const

export type FeatureAreaId = (typeof FEATURE_AREAS)[number]

/** The subject kinds an app action may reduce to. `instance_exit_view_as`, `audit` and `public` are
 * deliberately absent: no product surface declares them, they belong to the admin plumbing. */
export type ActionSubjectKind =
  | 'instance'
  | 'department'
  | 'department_managed'
  | 'department_child'
  | 'owned'
  | 'personal'
  | 'own_account'
  | 'authenticated'

/** A department switch that may widen a member's reach for this action. The switch is read from the
 * department's settings and passed into `canAction()`; a `false`/absent switch leaves the action at
 * its declared subject kind (head-only), a `true` switch lets any active member through.
 *
 * SPEC §2.2: `allowStructureEdit` defaults to **off** (the CTO's finding overrides TECH-SPEC §2.3);
 * `allowSelfAssign` stays on; `whoCanConnectTelegramGroup` defaults to `'everyone'`. Deleting or
 * archiving a bo'lim is head-only regardless of any switch, so it carries no `widenedBy`. */
export type ActionWidener = 'allowStructureEdit' | 'allowSelfAssign' | 'whoCanConnectTelegramGroup'

export type AppActionSpec = {
  readonly area: FeatureAreaId
  readonly action: Action
  readonly subject: ActionSubjectKind
  readonly widenedBy?: ActionWidener
  /** i18n key for the one-line "why you cannot do this" copy on the no-permission state. */
  readonly denyLabelKey?: string
}

/**
 * The matrix. Read a row as: "this action is a `<subject>` operation, so `can()`'s rule for that kind
 * decides". `department_managed` = head-only (reads included). `owned` = any member reads, the owner
 * set or the head writes. `department_child` = any active member.
 */
export const APP_ACTIONS = {
  // --- accounts (audit §4.1) ---------------------------------------------------------------------
  'accounts.profile.read': {
    area: 'accounts',
    action: 'read',
    subject: 'own_account',
  },
  'accounts.profile.edit': {
    area: 'accounts',
    action: 'update',
    subject: 'own_account',
  },
  'accounts.security.manage': {
    area: 'accounts',
    action: 'update',
    subject: 'own_account',
  },
  'accounts.delete.own': {
    area: 'accounts',
    action: 'delete',
    subject: 'own_account',
  },
  'accounts.avatar.read': {
    area: 'accounts',
    action: 'read',
    subject: 'authenticated',
  },
  /** A colleague directory is what a department is: name, photo, title, bo'lim, unit role. */
  'accounts.directory.read': {
    area: 'accounts',
    action: 'read',
    subject: 'department_child',
  },
  /** SPEC §2.2: a head may reset a member's password (temporary password + forced change, audited). */
  'accounts.password.resetMember': {
    area: 'accounts',
    action: 'update',
    subject: 'department_managed',
  },
  'accounts.password.resetAny': {
    area: 'accounts',
    action: 'administer',
    subject: 'instance',
  },

  // --- departments (audit §4.2, SPEC §2.3) -------------------------------------------------------
  'departments.request.create': {
    area: 'departments',
    action: 'create',
    subject: 'own_account',
  },
  'departments.request.decide': {
    area: 'departments',
    action: 'administer',
    subject: 'instance',
  },
  'departments.profile.read': {
    area: 'departments',
    action: 'read',
    subject: 'department',
  },
  'departments.settings.read': {
    area: 'departments',
    action: 'read',
    subject: 'department',
  },
  'departments.settings.edit': {
    area: 'departments',
    action: 'update',
    subject: 'department',
  },
  'departments.invite.read': {
    area: 'departments',
    action: 'read',
    subject: 'department_managed',
  },
  'departments.invite.rotate': {
    area: 'departments',
    action: 'update',
    subject: 'department',
  },
  'departments.members.read': {
    area: 'departments',
    action: 'read',
    subject: 'department',
  },
  'departments.members.remove': {
    area: 'departments',
    action: 'update',
    subject: 'department',
  },
  'departments.headship.transfer': {
    area: 'departments',
    action: 'update',
    subject: 'department',
  },
  'departments.leave': {
    area: 'departments',
    action: 'delete',
    subject: 'department_child',
  },
  'departments.deletion.request': {
    area: 'departments',
    action: 'update',
    subject: 'department',
  },
  /** SPEC §2.2: the join-approval queue lives on the Members tab and notifies the head. */
  'departments.joinRequests.read': {
    area: 'departments',
    action: 'read',
    subject: 'department_managed',
  },
  'departments.joinRequests.decide': {
    area: 'departments',
    action: 'update',
    subject: 'department_managed',
  },
  /** SPEC §2.3: `POST /me/active-department`. Anyone may switch between their own memberships. */
  'departments.switch': {
    area: 'departments',
    action: 'update',
    subject: 'own_account',
  },
  /** Imkoniyatlar (ClickApps) switches: members see them read-only, the head flips them. */
  'departments.features.read': {
    area: 'departments',
    action: 'read',
    subject: 'department',
  },
  'departments.features.edit': {
    area: 'departments',
    action: 'update',
    subject: 'department',
  },

  // --- structure (audit §4.3) --------------------------------------------------------------------
  'structure.read': {
    area: 'structure',
    action: 'read',
    subject: 'department_child',
  },
  'structure.unit.create': {
    area: 'structure',
    action: 'create',
    subject: 'department_managed',
    widenedBy: 'allowStructureEdit',
  },
  'structure.unit.edit': {
    area: 'structure',
    action: 'update',
    subject: 'department_managed',
    widenedBy: 'allowStructureEdit',
  },
  'structure.unit.reorder': {
    area: 'structure',
    action: 'update',
    subject: 'department_managed',
    widenedBy: 'allowStructureEdit',
  },
  /** SPEC §2.2: deleting or archiving a bo'lim is head-only regardless of the switch -- deleting a
   * unit rewrites everyone's home. No `widenedBy` here, deliberately. */
  'structure.unit.delete': {
    area: 'structure',
    action: 'delete',
    subject: 'department_managed',
  },
  'structure.unit.restore': {
    area: 'structure',
    action: 'update',
    subject: 'department_managed',
  },
  'structure.unitRole.assignSelf': {
    area: 'structure',
    action: 'create',
    subject: 'owned',
    widenedBy: 'allowSelfAssign',
  },
  'structure.unitRole.assignOther': {
    area: 'structure',
    action: 'create',
    subject: 'department_managed',
  },
  'structure.unitRole.removeSelf': {
    area: 'structure',
    action: 'delete',
    subject: 'owned',
  },
  'structure.unitRole.removeOther': {
    area: 'structure',
    action: 'delete',
    subject: 'department_managed',
  },

  // --- work (audit §4.4) -------------------------------------------------------------------------
  'work.board.read': {
    area: 'work',
    action: 'read',
    subject: 'department_child',
  },
  'work.card.create': {
    area: 'work',
    action: 'create',
    subject: 'department_child',
  },
  'work.card.edit': { area: 'work', action: 'update', subject: 'owned' },
  'work.card.move': { area: 'work', action: 'update', subject: 'owned' },
  'work.card.reassign': { area: 'work', action: 'update', subject: 'owned' },
  'work.card.archive': { area: 'work', action: 'archive', subject: 'owned' },
  'work.card.restore': { area: 'work', action: 'update', subject: 'owned' },
  'work.card.checklist.edit': {
    area: 'work',
    action: 'update',
    subject: 'owned',
  },
  'work.card.comment': {
    area: 'work',
    action: 'create',
    subject: 'department_child',
  },
  'work.card.watcher.add': { area: 'work', action: 'update', subject: 'owned' },
  /** A shared vocabulary is a head decision (audit §4.4). */
  'work.label.manage': {
    area: 'work',
    action: 'create',
    subject: 'department_managed',
  },
  'work.view.save': {
    area: 'work',
    action: 'create',
    subject: 'department_child',
  },
  /** Making a saved view the department default is a management act (SPEC §4.3). */
  'work.view.setDepartmentDefault': {
    area: 'work',
    action: 'update',
    subject: 'department_managed',
  },
  'work.estimate.edit': { area: 'work', action: 'update', subject: 'owned' },
  /** SPEC §2.2: the workload view is head-only. A member sees their own load on Home. */
  'work.workload.read': {
    area: 'work',
    action: 'read',
    subject: 'department_managed',
  },

  // --- projects (audit §4.5) ---------------------------------------------------------------------
  'projects.read': {
    area: 'projects',
    action: 'read',
    subject: 'department_child',
  },
  'projects.create': {
    area: 'projects',
    action: 'create',
    subject: 'department_child',
  },
  'projects.edit': { area: 'projects', action: 'update', subject: 'owned' },
  'projects.milestone.edit': {
    area: 'projects',
    action: 'update',
    subject: 'owned',
  },
  'projects.members.edit': {
    area: 'projects',
    action: 'update',
    subject: 'owned',
  },
  /** Appointing someone to lead is a management act (audit §4.5). */
  'projects.owner.set': {
    area: 'projects',
    action: 'update',
    subject: 'department_managed',
  },
  'projects.archive': {
    area: 'projects',
    action: 'archive',
    subject: 'department_managed',
  },
  'projects.template.manage': {
    area: 'projects',
    action: 'update',
    subject: 'department_managed',
  },

  // --- events (audit §4.6 -- already correct in code, declared here for the client) ---------------
  'events.read': {
    area: 'events',
    action: 'read',
    subject: 'department_child',
  },
  'events.create': {
    area: 'events',
    action: 'create',
    subject: 'department_child',
  },
  'events.edit': { area: 'events', action: 'update', subject: 'owned' },
  'events.cancel': { area: 'events', action: 'update', subject: 'owned' },
  'events.rsvp': {
    area: 'events',
    action: 'update',
    subject: 'department_child',
  },
  'events.participate': {
    area: 'events',
    action: 'create',
    subject: 'department_child',
  },
  'events.comment.delete': {
    area: 'events',
    action: 'delete',
    subject: 'owned',
  },
  'events.photo.delete': { area: 'events', action: 'delete', subject: 'owned' },

  // --- personal (audit §4.7, I-1) ----------------------------------------------------------------
  'personal.workspace.read': {
    area: 'personal',
    action: 'read',
    subject: 'personal',
  },
  'personal.workspace.edit': {
    area: 'personal',
    action: 'update',
    subject: 'personal',
  },
  /** Aggregate focus minutes only -- never content, never a note, never a canvas (I-1). */
  'personal.focus.readAggregate': {
    area: 'personal',
    action: 'read',
    subject: 'department_managed',
  },

  // --- inbox / telegram (audit §4.8) -------------------------------------------------------------
  'inbox.own.read': { area: 'inbox', action: 'read', subject: 'personal' },
  'inbox.own.manage': { area: 'inbox', action: 'update', subject: 'personal' },
  'inbox.departmentSettings.read': {
    area: 'inbox',
    action: 'read',
    subject: 'department_child',
  },
  'inbox.departmentSettings.edit': {
    area: 'inbox',
    action: 'update',
    subject: 'department',
  },
  'inbox.telegram.linkOwn': {
    area: 'inbox',
    action: 'update',
    subject: 'personal',
  },
  /** D8: a group chat id is an operational credential. */
  'inbox.telegram.groups.read': {
    area: 'inbox',
    action: 'read',
    subject: 'department_managed',
  },
  'inbox.telegram.group.connect': {
    area: 'inbox',
    action: 'create',
    subject: 'department_managed',
    widenedBy: 'whoCanConnectTelegramGroup',
  },
  'inbox.telegram.group.manage': {
    area: 'inbox',
    action: 'update',
    subject: 'department',
  },
  'inbox.telegram.broadcast': {
    area: 'inbox',
    action: 'create',
    subject: 'department_managed',
  },

  // --- analytics (audit §4.9) --------------------------------------------------------------------
  'analytics.department.read': {
    area: 'analytics',
    action: 'read',
    subject: 'department_child',
  },
  'analytics.personal.read': {
    area: 'analytics',
    action: 'read',
    subject: 'department_child',
  },
  /** SEV1 change: a per-person load chart in a ministry reads as a public reprimand. */
  'analytics.perPerson.read': {
    area: 'analytics',
    action: 'read',
    subject: 'department_managed',
  },
  'analytics.export': {
    area: 'analytics',
    action: 'read',
    subject: 'department_child',
  },
  'analytics.export.perPerson': {
    area: 'analytics',
    action: 'read',
    subject: 'department_managed',
  },
  'analytics.savedFilters.manage': {
    area: 'analytics',
    action: 'create',
    subject: 'department_child',
  },
  'analytics.pins.manage': {
    area: 'analytics',
    action: 'create',
    subject: 'department_child',
  },
  'analytics.narrative.read': {
    area: 'analytics',
    action: 'read',
    subject: 'department_managed',
  },

  // --- pages (audit §4.10) -----------------------------------------------------------------------
  'pages.read': { area: 'pages', action: 'read', subject: 'department_child' },
  'pages.create': {
    area: 'pages',
    action: 'create',
    subject: 'department_child',
  },
  /** A wiki works because editing is open; version history is the safety net. */
  'pages.edit': {
    area: 'pages',
    action: 'update',
    subject: 'department_child',
  },
  'pages.delete': { area: 'pages', action: 'delete', subject: 'owned' },
  'pages.version.restore': {
    area: 'pages',
    action: 'update',
    subject: 'owned',
  },
  'pages.onboarding.template.manage': {
    area: 'pages',
    action: 'update',
    subject: 'department_managed',
  },
  'pages.onboarding.own.complete': {
    area: 'pages',
    action: 'update',
    subject: 'own_account',
  },

  // --- ai (audit §4.11, SPEC §8) -----------------------------------------------------------------
  'ai.feature.run': {
    area: 'ai',
    action: 'create',
    subject: 'department_child',
  },
  'ai.features.read': {
    area: 'ai',
    action: 'read',
    subject: 'department_child',
  },
  /** SEV1 change: a money figure for the department is the head's. */
  'ai.budget.read': {
    area: 'ai',
    action: 'read',
    subject: 'department_managed',
  },
  'ai.settings.edit': { area: 'ai', action: 'update', subject: 'department' },
  'ai.usage.readOwn': {
    area: 'ai',
    action: 'read',
    subject: 'department_child',
  },
  /** SEV1 change: who asked the AI what, how often, is surveillance-grade. */
  'ai.usage.readAll': {
    area: 'ai',
    action: 'read',
    subject: 'department_managed',
  },

  // --- people (SPEC §4, §6 -- the v1.1 surfaces) --------------------------------------------------
  'people.directory.read': {
    area: 'people',
    action: 'read',
    subject: 'department_child',
  },
  'people.table.read': {
    area: 'people',
    action: 'read',
    subject: 'department_managed',
  },
  'people.indicators.read': {
    area: 'people',
    action: 'read',
    subject: 'department_managed',
  },
  'people.person.read': {
    area: 'people',
    action: 'read',
    subject: 'department_managed',
  },
  'people.person.readOwn': {
    area: 'people',
    action: 'read',
    subject: 'own_account',
  },
  'people.assignTask': {
    area: 'people',
    action: 'create',
    subject: 'department_child',
  },
  'people.export': {
    area: 'people',
    action: 'read',
    subject: 'department_managed',
  },

  // --- custom fields (SPEC §5) -------------------------------------------------------------------
  'fields.definition.read': {
    area: 'fields',
    action: 'read',
    subject: 'department_child',
  },
  'fields.definition.manage': {
    area: 'fields',
    action: 'update',
    subject: 'department_managed',
  },
  'fields.notifyToFill': {
    area: 'fields',
    action: 'create',
    subject: 'department_managed',
  },
  'fields.value.editOwn': {
    area: 'fields',
    action: 'update',
    subject: 'own_account',
  },
  /** "Where they studied" is HR-shaped data (audit §4.13). */
  'fields.value.readOthers': {
    area: 'fields',
    action: 'read',
    subject: 'department_managed',
  },
  'fields.value.editOnCard': {
    area: 'fields',
    action: 'update',
    subject: 'owned',
  },

  // --- goals and automations (SPEC §7) -----------------------------------------------------------
  'goals.read': {
    area: 'goals',
    action: 'read',
    subject: 'department_managed',
  },
  'goals.manage': {
    area: 'goals',
    action: 'update',
    subject: 'department_managed',
  },
  'automations.read': {
    area: 'automations',
    action: 'read',
    subject: 'department_managed',
  },
  'automations.manage': {
    area: 'automations',
    action: 'update',
    subject: 'department_managed',
  },

  // --- admin (audit §4.12) -----------------------------------------------------------------------
  'admin.console': { area: 'admin', action: 'administer', subject: 'instance' },
  'admin.viewAs': { area: 'admin', action: 'administer', subject: 'instance' },
} as const satisfies Record<string, AppActionSpec>

export type AppActionId = keyof typeof APP_ACTIONS

export const APP_ACTION_IDS = Object.freeze(
  Object.keys(APP_ACTIONS) as AppActionId[],
) as readonly AppActionId[]

export function actionsForArea(area: FeatureAreaId): readonly AppActionId[] {
  return APP_ACTION_IDS.filter((id) => APP_ACTIONS[id].area === area)
}

export function isAppActionId(value: string): value is AppActionId {
  return Object.prototype.hasOwnProperty.call(APP_ACTIONS, value)
}

/** Department switches, as the client and server both see them (`GET /departments/:id` returns this
 * shape under `settings`). Only the keys that widen a member's reach are modelled here. */
export type ActionSettings = {
  allowStructureEdit?: boolean
  allowSelfAssign?: boolean
  whoCanConnectTelegramGroup?: 'everyone' | 'head'
}

export type ActionContext = {
  /** The department the action happens in. Defaults to `actor.departmentId`. */
  departmentId?: string | null
  /** For `owned` actions: the giver/assignee/creator set, the project owner, the organizer, the
   * author. Omit it on the client when asking the *capability* question ("could I ever edit a card
   * here?") rather than the *object* question -- see `canAction()` below. */
  ownerUserIds?: readonly string[] | null
  /** For `personal` / `own_account` actions about somebody else (a head reading a member's page).
   * Defaults to the actor themselves. */
  subjectUserId?: string | null
  /** The department's switches, when the action declares a `widenedBy`. */
  settings?: ActionSettings | null
}

function widened(spec: AppActionSpec, settings: ActionSettings | null | undefined): boolean {
  if (!spec.widenedBy || !settings) return false
  if (spec.widenedBy === 'allowStructureEdit') return settings.allowStructureEdit === true
  if (spec.widenedBy === 'allowSelfAssign') return settings.allowSelfAssign === true
  return settings.whoCanConnectTelegramGroup === 'everyone'
}

/**
 * Resolve an app action id against an actor. The one function the server's `assertCan` and the
 * client's `useCan` both call.
 *
 * Two deliberate conveniences, both documented because they are the only places this is not a
 * literal `can()` call:
 *
 * 1. **A `widenedBy` switch that is on** turns a `department_managed` action into a
 *    `department_child` one (a head opened structure editing up to everyone). The switch value comes
 *    from the department settings the server already loaded; a client that has not loaded them yet
 *    simply gets the strict answer, which is the fail-closed direction.
 * 2. **An `owned` action asked without `ownerUserIds`** is the capability question, not the object
 *    question: "does this person ever get to edit a card here?" -- answered as `department_child`,
 *    because every member owns some cards. The server always passes the real owner set (it has just
 *    loaded the row), so the object question is always answered exactly. A client rendering a button
 *    for a specific card passes `ownerUserIds` and gets the exact answer too.
 */
export function canAction(actor: Actor | null, id: AppActionId, ctx: ActionContext = {}): Decision {
  const spec: AppActionSpec = APP_ACTIONS[id]
  const departmentId = ctx.departmentId ?? actor?.departmentId ?? ''
  const subjectUserId = ctx.subjectUserId ?? actor?.userId ?? ''

  let kind: ActionSubjectKind = spec.subject
  if (widened(spec, ctx.settings)) kind = 'department_child'
  if (kind === 'owned' && (ctx.ownerUserIds === undefined || ctx.ownerUserIds === null)) {
    kind = 'department_child'
  }

  let subject: Subject
  switch (kind) {
    case 'instance':
      subject = { kind: 'instance' }
      break
    case 'authenticated':
      subject = { kind: 'authenticated' }
      break
    case 'personal':
      subject = { kind: 'personal', ownerUserId: subjectUserId }
      break
    case 'own_account':
      subject = { kind: 'own_account', userId: subjectUserId }
      break
    case 'owned':
      subject = {
        kind: 'owned',
        departmentId,
        ownerUserIds: ctx.ownerUserIds ?? [],
      }
      break
    case 'department':
      subject = { kind: 'department', departmentId }
      break
    case 'department_managed':
      subject = { kind: 'department_managed', departmentId }
      break
    case 'department_child':
      subject = { kind: 'department_child', departmentId }
      break
  }

  return can(actor, spec.action, subject)
}

/** Sugar for the client, where "may I?" is a boolean and the reason is rendered separately. */
export function allowsAction(
  actor: Actor | null,
  id: AppActionId,
  ctx: ActionContext = {},
): boolean {
  return canAction(actor, id, ctx).allowed
}
