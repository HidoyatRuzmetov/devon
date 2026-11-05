import {
  aiActionBindingSchema,
  checkinAddSchema,
  checkinCreateTaskSchema,
  checkinSelectionSchema,
  checkinLayoutWriteSchema,
  professionalProfileWriteRecordSchema,
  personnelWriteSchema,
  personalRestoreBodySchema,
  checkinLockSchema,
  checkinUpdateSchema,
  personalCalendarBodySchema,
  personalCalendarUpdateSchema,
} from '@devon/contracts'
import { z } from 'zod'
import { patchProfileBodySchema } from '../accounts/schemas.js'
import {
  cancelEventBodySchema,
  carpoolBodySchema,
  carpoolClaimBodySchema,
  carpoolUpdateBodySchema,
  createEventBodySchema,
  editCommentBodySchema as editEventCommentBodySchema,
  commentBodySchema as eventCommentBodySchema,
  feedbackBodySchema,
  itemBodySchema,
  pollBodySchema,
  pollVoteBodySchema,
  rsvpBodySchema,
  updateEventBodySchema,
} from '../events/schemas.js'
import { createPageBodySchema, patchPageBodySchema } from '../pages/schemas.js'
import {
  createTaskBodySchema,
  patchTaskBodySchema,
  reorderTasksBodySchema,
  patchPomodoroSettingsBodySchema,
  createPomodoroSessionBodySchema,
  patchPomodoroSessionBodySchema,
} from '../personal/schemas.js'
import {
  addMilestoneBodySchema,
  createProjectBodySchema,
  createFromCardBodySchema,
  createFromTemplateBodySchema,
  createFromGalleryBodySchema,
  patchMilestoneBodySchema,
  patchProjectBodySchema,
} from '../projects/schemas.js'
import {
  createCardBodySchema,
  moveCardBodySchema,
  createLabelBodySchema,
  createSavedViewBodySchema,
  createChecklistItemBodySchema,
  createCommentBodySchema,
  patchCardBodySchema,
  patchChecklistItemBodySchema,
  patchCommentBodySchema,
} from '../work/schemas.js'
import { assignManySchema, cardChecklistPlanSchema } from '../work/workflow-schemas.js'

import { groupMessageSchema } from '../telegram/group-message.js'
import {
  addFocusBodySchema,
  reorderFocusBodySchema,
  createDependencyBodySchema,
  createTimeLogBodySchema,
  createReminderBodySchema,
  createWorkTemplateBodySchema,
  patchWorkTemplateBodySchema,
  createFromCardTemplateBodySchema,
} from '../work/schemas-plus.js'

const id = z.uuid()
const target = z.object({ id }).strict()
const body = (schema: z.ZodType) => z.object({ body: schema }).strict()
const withFiles = (schema: z.ZodType) =>
  z.object({ body: schema, attachmentIds: z.array(id).max(10).optional() }).strict()
const patch = (schema: z.ZodType) => z.object({ id, body: schema }).strict()
type Method = 'POST' | 'PATCH' | 'DELETE' | 'PUT'
type Args = Record<string, unknown>
type Action = {
  headOnly?: boolean
  schema: z.ZodType
  description: string
  method: Method
  path: (a: Args) => string
  href: (a: Args, result: Args) => string
}
const resource = (
  route: string,
  href: (id: string) => string,
  method: Method,
  schema: z.ZodType,
  description: string,
): Action => ({
  schema,
  description,
  method,
  path: (a) => `/${route}${a['id'] ? `/${a['id']}` : ''}`,
  href: (a, result) => href(String(result['id'] ?? a['id'] ?? '')),
})
const cardHref = (id: string) => `/work?card=${id}`
const pageHref = (id: string) => `/pages?page=${id}`
const projectHref = (id: string) => `/projects/view?id=${id}`
const eventHref = (id: string) => `/events?event=${id}`
const milestoneId = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[a-zA-Z0-9_-]+$/)

/** The model selects a named operation, never a URL, SQL statement, script or arbitrary method.
 * Every execution re-enters the ordinary API's permissions, validation, audit and event pipeline. */
const endpoint = (
  method: Method,
  route: string,
  schema: z.ZodType,
  description: string,
  href = '/work',
): Action => ({
  method,
  schema,
  description,
  path: (args) =>
    route.replace(/:([a-zA-Z]+)/g, (_, key: string) => encodeURIComponent(String(args[key]))),
  href: () => href,
})
export const ACTIONS: Record<string, Action> = {
  'profile.account': endpoint(
    'PATCH',
    '/accounts/profile',
    body(patchProfileBodySchema),
    'Update the current user’s account profile with explicitly supplied name/contact/position or dateOfBirth in YYYY-MM-DD form (null clears it). Never infer a birthday or change another account. Date of birth enables personal birthday greetings and department-head reminders.',
    '/account',
  ),
  'telegram.groupMessage': {
    ...endpoint(
      'POST',
      '/telegram/group-message',
      body(groupMessageSchema),
      'HEAD ONLY: send the exact reviewed message to a connected department Telegram group. groupId is optional only when exactly one group is connected. mentionAll=true or a standalone @all uses verified group mentions. Telegram bots cannot enumerate every silent member. Never send without an explicit user request and confirmation.',
      '/account/telegram',
    ),
    headOnly: true,
  },
  'checkin.createTask': {
    ...endpoint(
      'POST',
      '/checkins/cycles/:id/members/:memberUserId/tasks',
      z.object({ id, memberUserId: id, body: checkinCreateTaskSchema }).strict(),
      'Atomically create an individual task, its checklist and selected deliverables in this cycle. Members may create only for themselves; the head may choose any active member. Use a stable operationId for retries. Allowed during locked check-in (additions only), never after checkout closes. Group tasks must be created through project actions.',
      '/analytics',
    ),
  },
  'checkin.selection': endpoint(
    'PUT',
    '/checkins/cycles/:id/members/:memberUserId/selection',
    z.object({ id, memberUserId: id, body: checkinSelectionSchema }).strict(),
    'Atomically add source addItemIds and remove check-in removeEntryIds for this person/cycle. Agreed check-in allows additions only. Checkout lock rejects all changes.',
    '/analytics',
  ),
  'checkin.layout': endpoint(
    'PUT',
    '/checkins/cycles/:id/members/:memberUserId/layout',
    z.object({ id, memberUserId: id, body: checkinLayoutWriteSchema }).strict(),
    'Save per-person cycle card order. mode priority resets automatic order; manual uses cardIds and current layout version (0 for new).',
    '/analytics',
  ),
  'profile.resume': endpoint(
    'PUT',
    '/accounts/professional-profile',
    body(professionalProfileWriteRecordSchema),
    'Publish the current user’s reviewed professional resume using its version. Preserve all unchanged entries; position and education degree use canonical dropdown codes. This publishes to People.',
    '/account/professional',
  ),
  'profile.personnel': endpoint(
    'PUT',
    '/accounts/personnel-record',
    body(personnelWriteSchema),
    'Save only the current user’s explicitly supplied private personnel record with version. Only owner and department head may read it. Never infer family details or copy public profile content into private fields without request.',
    '/account/professional',
  ),
  'card.move': endpoint(
    'POST',
    '/cards/:id/move',
    patch(moveCardBodySchema),
    'Move a card using its current version and neighboring IDs. A changed board order becomes manual.',
  ),
  'card.undoDelete': endpoint(
    'POST',
    '/cards/:id/undo-delete',
    target,
    'Restore a soft-deleted card if its undo window allows.',
  ),
  'card.restore': endpoint(
    'POST',
    '/cards/:id/restore',
    target,
    'Restore a deleted task with ordinary owner/head authority, including after the short undo window. A task whose group project is deleted requires restoring the project first. Preserves task status and its checklist.',
  ),
  'card.watch': endpoint(
    'POST',
    '/cards/:id/watchers',
    target,
    'Toggle watching a card for the current user. Inspect current watchers first; never toggle speculatively.',
  ),
  'pin.add': endpoint(
    'POST',
    '/work/focus',
    body(addFocusBodySchema),
    'Pin an existing card. Omit body.userId for the current user. Only the head may specify another member, and that card must be assigned to that member. Pins stay above unpinned tasks in automatic and manual views. There is no five-card limit.',
  ),
  'pin.remove': {
    schema: z.object({ id, userId: id.optional() }).strict(),
    method: 'DELETE',
    path: (a) =>
      `/work/focus/${a['id']}${a['userId'] ? `?userId=${encodeURIComponent(String(a['userId']))}` : ''}`,
    href: () => '/work',
    description:
      'Unpin a card without deleting it. Omit userId for own pins; only the head can target another person’s assigned-task pins.',
  },
  'pin.reorder': endpoint(
    'POST',
    '/work/focus/reorder',
    body(reorderFocusBodySchema),
    'Reorder pinned cards. Omit body.userId for own pins; only the head can target another person’s assigned-task pins. Include every currently visible pin exactly once.',
  ),
  'dependency.add': endpoint(
    'POST',
    '/cards/:id/dependencies',
    patch(createDependencyBodySchema),
    'Link a task dependency; feature and ownership rules apply.',
  ),
  'dependency.remove': endpoint(
    'DELETE',
    '/cards/:id/dependencies/:depId',
    z.object({ id, depId: id }).strict(),
    'Remove the specified dependency link.',
  ),
  'timeLog.add': endpoint(
    'POST',
    '/cards/:id/time-logs',
    patch(createTimeLogBodySchema),
    'Log time spent on a card.',
  ),
  'timeLog.remove': endpoint(
    'DELETE',
    '/cards/:id/time-logs/:logId',
    z.object({ id, logId: id }).strict(),
    'Remove a time entry the current user may manage.',
  ),
  'reminder.add': endpoint(
    'POST',
    '/cards/:id/reminders',
    patch(createReminderBodySchema),
    'Schedule a reminder for a card.',
  ),
  'reminder.remove': endpoint(
    'DELETE',
    '/cards/:id/reminders/:reminderId',
    z.object({ id, reminderId: id }).strict(),
    'Remove a specified card reminder.',
  ),
  'template.create': endpoint(
    'POST',
    '/work/templates',
    body(createWorkTemplateBodySchema),
    'Create a reusable task template.',
  ),
  'template.update': endpoint(
    'PATCH',
    '/work/templates/:id',
    patch(patchWorkTemplateBodySchema),
    'Edit a task template while preserving unspecified fields.',
  ),
  'template.delete': endpoint(
    'DELETE',
    '/work/templates/:id',
    target,
    'Delete a specified task template.',
  ),
  'template.createCard': endpoint(
    'POST',
    '/work/templates/:id/create-card',
    patch(createFromCardTemplateBodySchema),
    'Create a task from an existing task template.',
  ),
  'label.create': {
    ...endpoint('POST', '/labels', body(createLabelBodySchema), 'HEAD ONLY: create a task label.'),
    headOnly: true,
  },
  'view.create': endpoint(
    'POST',
    '/views',
    body(createSavedViewBodySchema),
    'Save a card view with filters.',
  ),
  'view.delete': endpoint('DELETE', '/views/:id', target, 'Delete a saved card view.'),
  'project.fromCard': endpoint(
    'POST',
    '/projects/from-card',
    body(createFromCardBodySchema),
    'Convert an individual card into a group project with specified members. Protected check-in sources remain protected.',
    '/projects',
  ),
  'project.undoDelete': endpoint(
    'POST',
    '/projects/:id/undo-delete',
    target,
    'Restore a soft-deleted project within the permitted undo window.',
    '/projects',
  ),
  'project.restore': endpoint(
    'POST',
    '/projects/:id/restore',
    target,
    'Restore a deleted group project and every card deleted with it, preserving the group. Available to its owner or department head, without an undo deadline. Explain this wider recovery scope in the confirmation; earlier individually deleted cards stay deleted.',
    '/projects',
  ),
  'project.fromTemplate': endpoint(
    'POST',
    '/projects/from-template',
    body(createFromTemplateBodySchema),
    'Create a group project from a built-in template.',
    '/projects',
  ),
  'project.fromGallery': endpoint(
    'POST',
    '/projects/from-gallery',
    body(createFromGalleryBodySchema),
    'Create a project from a saved gallery template.',
    '/projects',
  ),
  'personal.task.delete': endpoint(
    'DELETE',
    '/personal/tasks/:id',
    target,
    'Delete an owned personal task; never a shared card.',
    '/personal',
  ),
  'personal.task.restore': endpoint(
    'POST',
    '/personal/tasks/:id/restore',
    patch(personalRestoreBodySchema),
    'Restore a personal task using the exact restoreToken from its deletion receipt.',
    '/personal',
  ),
  'personal.task.reorder': endpoint(
    'POST',
    '/personal/tasks/reorder',
    body(reorderTasksBodySchema),
    'Reorder owned personal tasks with their current versions.',
    '/personal',
  ),
  'personal.pomodoro.settings': endpoint(
    'PATCH',
    '/personal/pomodoro/settings',
    body(patchPomodoroSettingsBodySchema),
    'Change the current user’s Pomodoro preferences.',
    '/personal',
  ),
  'personal.pomodoro.start': endpoint(
    'POST',
    '/personal/pomodoro/sessions',
    body(createPomodoroSessionBodySchema),
    'Start the current user’s Pomodoro session.',
    '/personal',
  ),
  'personal.pomodoro.update': endpoint(
    'PATCH',
    '/personal/pomodoro/sessions/:id',
    patch(patchPomodoroSessionBodySchema),
    'Update an owned Pomodoro session using the normal timer rules.',
    '/personal',
  ),
  'personal.calendar.create': resource(
    'personal/calendar',
    (id) => `/personal?tab=calendar&entry=${id}`,
    'POST',
    body(personalCalendarBodySchema),
    'Create a personal calendar entry, optionally inviting active colleagues using participantUserIds. Invitees see the title, times and notes in their calendars and receive a notification; only the owner can edit. Optional Telegram reminder belongs to the owner. Use this for a personal appointment/reminder, not a department event. Times must include the timezone; local time is Tashkent UTC+5. A reminder is at or before start.',
  ),
  'personal.calendar.update': resource(
    'personal/calendar',
    (id) => `/personal?tab=calendar&entry=${id}`,
    'PATCH',
    patch(personalCalendarUpdateSchema),
    'Update the current user’s calendar entry, including invitations. Preserve participantUserIds unless changing attendance is requested. Include its current version and the complete entry with unchanged fields preserved.',
  ),
  'personal.calendar.delete': {
    schema: z.object({ id, version: z.number().int().positive() }).strict(),
    description:
      'Delete only the current user’s personal calendar entry, with its current version. Never deletes a work task or a signed-up event.',
    method: 'DELETE',
    path: (a) => `/personal/calendar/${a['id']}?version=${a['version']}`,
    href: () => '/personal?tab=calendar',
  },
  'card.withChecklist': resource(
    'cards/with-checklist',
    cardHref,
    'POST',
    withFiles(cardChecklistPlanSchema),
    'Atomically reuse an existing card (body.existingCardId) OR create a missing card (body.create), then append real body.checklist rows. All new-card properties, including assigneeUserId and projectId, belong inside body.create. attachmentIds belongs beside body. Prefer this for outlines and task+subtask requests. checklist entries have local key, text, optional parentKey (earlier entry) or parentItemId (existing checklist). Existing matching checklist rows are preserved, not duplicated. Never put requested checklist items into description.',
  ),
  'card.assignMany': resource(
    'cards/assign-many',
    () => '/work',
    'POST',
    body(assignManySchema),
    'HEAD ONLY: one reviewed operation assigns the same task and optional checklist to every specified recipientUserId. For everyone use all active member IDs from the directory, excluding the head unless explicitly requested. One proposal, never one confirmation per member. All assignments commit together.',
  ),
  'checkin.add': {
    schema: patch(checkinAddSchema),
    description:
      'Add one source checklist item to a cycle. id is the cycle ID; body.checklistItemId is the source. Later additions count toward its total.',
    method: 'POST',
    path: (a) => `/checkins/cycles/${a['id']}/entries`,
    href: (a) => `/analytics?cycle=${a['id']}`,
  },
  'checkin.update': {
    schema: patch(checkinUpdateSchema),
    description:
      'Update a check-in entry text or state (pending/done/blocked), with current version. id MUST be entryId from a checkin_entry record, never its cycleId or checklistItemId. Also updates its live source checklist. Agreed checklist wording cannot change; pending/done/blocked progress can. Blocked counts in total, never done. Locked checkout is immutable.',
    method: 'PATCH',
    path: (a) => `/checkins/entries/${a['id']}`,
    href: () => '/analytics',
  },
  'checkin.remove': {
    schema: target,
    description:
      'Remove a check-in entry from an unlocked check-in only. id MUST be entryId from a checkin_entry record, never its cycleId or checklistItemId. Does not delete the original checklist item.',
    method: 'DELETE',
    path: (a) => `/checkins/entries/${a['id']}`,
    href: () => '/analytics',
  },
  'checkin.lock': {
    schema: patch(checkinLockSchema),
    description:
      'HEAD ONLY: agree checkin (prevents removal) or lock checkout (freezes historical results). id is the cycle ID. body.memberUserId identifies the single person to lock. Only on an explicit request to lock/agreement.',
    method: 'POST',
    path: (a) => `/checkins/cycles/${a['id']}/lock`,
    href: (a) => `/analytics?cycle=${a['id']}`,
  },
  'card.create': resource(
    'cards',
    cardHref,
    'POST',
    withFiles(createCardBodySchema),
    'Create a department task or a personal assignment inside an existing project. Fields include title, description, assigneeUserId, projectId, priority, dueAt.',
  ),
  'card.update': resource(
    'cards',
    cardHref,
    'PATCH',
    patch(patchCardBodySchema.safeExtend({ version: z.number().int().min(1) }).strict()),
    'Edit a card, assign it, change dates/priority/status/workStage, mark it done or reopen it. Include its current version.',
  ),
  'card.delete': resource(
    'cards',
    () => '/work',
    'DELETE',
    target,
    'Soft-delete one specified card after explicit confirmation.',
  ),
  'page.create': resource(
    'pages',
    pageHref,
    'POST',
    withFiles(createPageBodySchema),
    'Create a shared page. body has title, kind (note/brief/how_we_work/onboarding), blocks (safe Tiptap JSON document).',
  ),
  'page.update': resource(
    'pages',
    pageHref,
    'PATCH',
    patch(patchPageBodySchema),
    'Edit shared page title/body, including current version. Keep existing content unless replacement is requested.',
  ),
  'page.delete': resource(
    'pages',
    () => '/pages',
    'DELETE',
    target,
    'Soft-delete one specified shared page.',
  ),
  'project.create': resource(
    'projects',
    projectHref,
    'POST',
    body(createProjectBodySchema),
    'Create a group project with title, ownerUserId, members, targetOn and milestones as supported by its schema.',
  ),
  'project.update': resource(
    'projects',
    projectHref,
    'PATCH',
    patch(patchProjectBodySchema),
    'Update a project with its current version; progress is governed by milestones.',
  ),
  'project.delete': resource(
    'projects',
    () => '/projects',
    'DELETE',
    target,
    'Soft-delete one specified project. Explain its effect in the preview.',
  ),
  'checklist.add': {
    schema: patch(createChecklistItemBodySchema),
    description: 'Add a checklist item to a card.',
    method: 'POST',
    path: (a) => `/cards/${a['id']}/checklist`,
    href: (a) => cardHref(String(a['id'])),
  },
  'checklist.update': {
    schema: z.object({ id, itemId: id, body: patchChecklistItemBodySchema }).strict(),
    description: 'Edit or complete an existing checklist item.',
    method: 'PATCH',
    path: (a) => `/cards/${a['id']}/checklist/${a['itemId']}`,
    href: (a) => cardHref(String(a['id'])),
  },
  'checklist.delete': {
    schema: z.object({ id, itemId: id }).strict(),
    description: 'Delete one checklist item.',
    method: 'DELETE',
    path: (a) => `/cards/${a['id']}/checklist/${a['itemId']}`,
    href: (a) => cardHref(String(a['id'])),
  },
  'comment.create': {
    schema: patch(createCommentBodySchema),
    description: 'Post a comment on a card as the current user. Mentions must be explicit.',
    method: 'POST',
    path: (a) => `/cards/${a['id']}/comments`,
    href: (a) => cardHref(String(a['id'])),
  },
  'checklist.comment.create': endpoint(
    'POST',
    '/cards/:id/checklist/:itemId/comments',
    z.object({ id, itemId: id, body: createCommentBodySchema }).strict(),
    'Post a comment under one specific checklist item. id is the source card ID and itemId the source checklist ID, including from check-in. Comments remain available when checklist wording is locked; they never alter the agreed text. Mentions require explicit instruction.',
  ),
  'checklist.comment.update': endpoint(
    'PATCH',
    '/cards/:id/checklist/:itemId/comments/:commentId',
    z.object({ id, itemId: id, commentId: id, body: patchCommentBodySchema }).strict(),
    'Edit a checklist comment owned by the user or moderated by the head. Include its current editedAt and preserve unchanged mentions. Read checklistItemId in the source comment; do not edit a task-level comment through this action.',
  ),
  'checklist.comment.delete': endpoint(
    'DELETE',
    '/cards/:id/checklist/:itemId/comments/:commentId',
    z.object({ id, itemId: id, commentId: id }).strict(),
    'Delete one explicitly selected checklist comment with ordinary author/head permissions. This never deletes the checklist item or its check-in history.',
  ),
  'comment.update': {
    schema: z.object({ id, commentId: id, body: patchCommentBodySchema }).strict(),
    description:
      'Edit one card comment owned by the user (or moderated by a head). Include its current editedAt (null if never edited). Preserve remaining mention IDs; removed mentions retire notifications.',
    method: 'PATCH',
    path: (a) => `/cards/${a['id']}/comments/${a['commentId']}`,
    href: (a) => `${cardHref(String(a['id']))}#comment-${a['commentId']}`,
  },
  'comment.delete': {
    schema: z.object({ id, commentId: id }).strict(),
    description:
      'Delete one specified card comment; related inbox notifications are retired. Permission is checked again on confirmation.',
    method: 'DELETE',
    path: (a) => `/cards/${a['id']}/comments/${a['commentId']}`,
    href: (a) => cardHref(String(a['id'])),
  },
  'milestone.add': {
    schema: patch(addMilestoneBodySchema),
    description: 'Add a project milestone.',
    method: 'POST',
    path: (a) => `/projects/${a['id']}/milestones`,
    href: (a) => projectHref(String(a['id'])),
  },
  'milestone.update': {
    schema: z.object({ id, milestoneId, body: patchMilestoneBodySchema }).strict(),
    description: 'Edit or complete one project milestone.',
    method: 'PATCH',
    path: (a) => `/projects/${a['id']}/milestones/${a['milestoneId']}`,
    href: (a) => projectHref(String(a['id'])),
  },
  'milestone.delete': {
    schema: z.object({ id, milestoneId }).strict(),
    description:
      'Remove one specified milestone. Explain that project progress will be recalculated from the remaining milestones.',
    method: 'DELETE',
    path: (a) => `/projects/${a['id']}/milestones/${a['milestoneId']}`,
    href: (a) => projectHref(String(a['id'])),
  },
  'event.create': resource(
    'events',
    eventHref,
    'POST',
    body(createEventBodySchema),
    'Create a department event with title, startsAt and endsAt. Resolve dates/timezone and optional location, capacity and RSVP deadline from the user; ask when ambiguous.',
  ),
  'event.update': resource(
    'events',
    eventHref,
    'PATCH',
    patch(updateEventBodySchema),
    'Edit an event’s details as its organizer or head. Finished or closed events cannot be changed.',
  ),
  'event.cancel': {
    schema: patch(cancelEventBodySchema),
    description:
      'Cancel one upcoming event with the user’s stated reason. Show the effect on attendees in the confirmation.',
    method: 'POST',
    path: (a) => `/events/${a['id']}/cancel`,
    href: (a) => eventHref(String(a['id'])),
  },
  'event.rsvp': {
    schema: patch(rsvpBodySchema),
    description:
      'Set the current user’s RSVP, guests and optional note. Never RSVP on behalf of someone else. Availability, deadline and finished-event rules apply.',
    method: 'POST',
    path: (a) => `/events/${a['id']}/rsvp`,
    href: (a) => eventHref(String(a['id'])),
  },
  'event.comment.create': {
    schema: patch(eventCommentBodySchema),
    description: 'Post the current user’s comment to one event, including after it ends.',
    method: 'POST',
    path: (a) => `/events/${a['id']}/comments`,
    href: (a) => eventHref(String(a['id'])),
  },
  'event.comment.update': {
    schema: z.object({ id, commentId: id, body: editEventCommentBodySchema }).strict(),
    description:
      'Edit one event comment if owned by the current user or permitted by head moderation. Include current editedAt (null if never edited). Discussion stays editable after the event.',
    method: 'PATCH',
    path: (a) => `/events/${a['id']}/comments/${a['commentId']}`,
    href: (a) => eventHref(String(a['id'])),
  },
  'event.comment.delete': {
    schema: z.object({ id, commentId: id }).strict(),
    description:
      'Delete one specified event comment with its ordinary author/head permission checks.',
    method: 'DELETE',
    path: (a) => `/events/${a['id']}/comments/${a['commentId']}`,
    href: (a) => eventHref(String(a['id'])),
  },
  'event.feedback': {
    schema: patch(feedbackBodySchema),
    description:
      'Save or update the current user’s event feedback. Use only a rating (1–5), comment and anonymity preference explicitly supplied by the user; never invent a rating.',
    method: 'POST',
    path: (a) => `/events/${a['id']}/feedback`,
    href: (a) => eventHref(String(a['id'])),
  },
  'event.carpool.create': {
    schema: patch(carpoolBodySchema),
    description:
      "Offer the current user's carpool with seats, departure details and a note. Only before the event starts.",
    method: 'POST',
    path: (a) => `/events/${a['id']}/carpools`,
    href: (a) => eventHref(String(a['id'])),
  },
  'event.carpool.update': {
    schema: z.object({ id, carpoolId: id, body: carpoolUpdateBodySchema }).strict(),
    description: 'Edit one owned carpool offer. Do not reduce seats below existing reservations.',
    method: 'PATCH',
    path: (a) => `/events/${a['id']}/carpools/${a['carpoolId']}`,
    href: (a) => eventHref(String(a['id'])),
  },
  'event.carpool.delete': {
    schema: z.object({ id, carpoolId: id }).strict(),
    description:
      'Cancel one carpool offer with ordinary driver/head permissions; explain the effect on passengers.',
    method: 'DELETE',
    path: (a) => `/events/${a['id']}/carpools/${a['carpoolId']}`,
    href: (a) => eventHref(String(a['id'])),
  },
  'event.carpool.claim': {
    schema: z.object({ id, carpoolId: id, body: carpoolClaimBodySchema }).strict(),
    description:
      "Reserve explicitly requested seats for the current user in another driver's carpool; capacity or waiting-list rules apply.",
    method: 'POST',
    path: (a) => `/events/${a['id']}/carpools/${a['carpoolId']}/claim`,
    href: (a) => eventHref(String(a['id'])),
  },
  'event.carpool.release': {
    schema: z.object({ id, carpoolId: id }).strict(),
    description:
      "Release only the current user's carpool reservation, while event operations are open.",
    method: 'DELETE',
    path: (a) => `/events/${a['id']}/carpools/${a['carpoolId']}/claim`,
    href: (a) => eventHref(String(a['id'])),
  },
  'event.item.create': {
    schema: patch(itemBodySchema),
    description: 'Add an item needed for an upcoming event with its requested quantity.',
    method: 'POST',
    path: (a) => `/events/${a['id']}/items`,
    href: (a) => eventHref(String(a['id'])),
  },
  'event.item.claim': {
    schema: z.object({ id, itemId: id }).strict(),
    description:
      'Volunteer the current user to bring one event item. Never volunteer someone else.',
    method: 'POST',
    path: (a) => `/events/${a['id']}/items/${a['itemId']}/claim`,
    href: (a) => eventHref(String(a['id'])),
  },
  'event.item.release': {
    schema: z.object({ id, itemId: id }).strict(),
    description:
      "Release the current user's commitment to bring one event item before the event ends.",
    method: 'DELETE',
    path: (a) => `/events/${a['id']}/items/${a['itemId']}/claim`,
    href: (a) => eventHref(String(a['id'])),
  },
  'event.poll.create': {
    schema: patch(pollBodySchema),
    description:
      "Create an event poll from the user's question and explicit options. Use single, multi or date kind and optional close date.",
    method: 'POST',
    path: (a) => `/events/${a['id']}/polls`,
    href: (a) => eventHref(String(a['id'])),
  },
  'event.poll.vote': {
    schema: z.object({ id, pollId: id, body: pollVoteBodySchema }).strict(),
    description:
      "Cast or update only the current user's vote using option IDs corresponding to their explicit choice. Never infer a preference.",
    method: 'POST',
    path: (a) => `/events/${a['id']}/polls/${a['pollId']}/vote`,
    href: (a) => eventHref(String(a['id'])),
  },
  'personal.task.create': resource(
    'personal/tasks',
    () => '/personal',
    'POST',
    body(createTaskBodySchema),
    'Create a private personal workspace task for the current user.',
  ),
  'personal.task.update': resource(
    'personal/tasks',
    () => '/personal',
    'PATCH',
    patch(patchTaskBodySchema),
    'Edit or complete a private personal task owned by the current user.',
  ),
  'attachment.attach': {
    schema: z
      .object({
        attachmentIds: z.array(id).min(1).max(10),
        targetType: z.enum(['card', 'page']),
        targetId: id,
      })
      .strict(),
    description:
      'Move the current conversation’s clean uploaded files onto one specified card or page. Requires permission to edit that destination.',
    method: 'POST',
    path: () => '',
    href: (a) =>
      a['targetType'] === 'card'
        ? cardHref(String(a['targetId']))
        : pageHref(String(a['targetId'])),
  },
}

/** Tolerate transport-shaped JSON mistakes without inferring intent or IDs. Every recovered
 * value is still checked against the same strict action schema before it reaches review. */
export function decodeActionJson(value: unknown): unknown {
  if (typeof value !== 'string' || value.length > 200_000) return value
  try {
    return JSON.parse(value)
  } catch {
    return value
  }
}
function normalizeModelAction(value: unknown): unknown {
  const decoded = decodeActionJson(value)
  if (!decoded || typeof decoded !== 'object' || Array.isArray(decoded)) return decoded
  const action = { ...decoded } as Record<string, unknown>,
    raw = decodeActionJson(action['arguments'])
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return action
  const args = { ...raw } as Record<string, unknown>
  // Some providers flatten nested create fields. Relocate only explicitly supplied domain
  // fields, never infer a value or resolve conflicting identities. The strict schema still
  // validates every field and rejects unknown fields after this transport normalization.
  if (action['kind'] === 'card.withChecklist' && args['body'] && typeof args['body'] === 'object') {
    const body = { ...(args['body'] as Record<string, unknown>) }
    if (!body['existingCardId'] && body['create'] && typeof body['create'] === 'object') {
      const create = { ...(body['create'] as Record<string, unknown>) }
      for (const key of Object.keys(createCardBodySchema.shape)) {
        if (!Object.hasOwn(body, key)) continue
        if (Object.hasOwn(create, key) && JSON.stringify(create[key]) !== JSON.stringify(body[key]))
          continue
        create[key] = body[key]
        delete body[key]
      }
      body['create'] = create
      args['body'] = body
    }
  }
  for (const key of ['id', 'itemId', 'version', 'attachmentIds']) {
    if (Object.hasOwn(action, key) && !Object.hasOwn(args, key)) {
      args[key] = action[key]
      delete action[key]
    }
  }
  action['arguments'] = args
  return action
}
export const proposedActionSchema = z.preprocess(
  normalizeModelAction,
  z
    .object({
      kind: z.string(),
      key: z
        .string()
        .regex(/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/)
        .optional(),
      bindings: z.array(aiActionBindingSchema).max(8).optional(),
      title: z.string().min(1).max(140),
      summary: z.string().min(1).max(1600),
      arguments: z.record(z.string(), z.unknown()),
    })
    .strict(),
)
export function parseAction(kind: string, args: unknown): Args {
  const action = Object.hasOwn(ACTIONS, kind) ? ACTIONS[kind] : undefined
  if (!action) throw new Error('unsupported_action')
  const parsed = action.schema.parse(args)
  // Ordinary API schemas may intentionally strip unknown properties. That is unsafe for a
  // proposed action: silently dropping a requested attachment or deadline changes the user's
  // approval. Reject every dropped key, including nested objects, while preserving valid
  // coercion, trimming and defaults from the original domain schema.
  const issues: z.core.$ZodIssue[] = []
  const inspect = (before: unknown, after: unknown, path: (string | number)[]) => {
    if (Array.isArray(before) && Array.isArray(after)) {
      before.forEach((value, index) => inspect(value, after[index], [...path, index]))
      return
    }
    if (
      !before ||
      typeof before !== 'object' ||
      Array.isArray(before) ||
      !after ||
      typeof after !== 'object' ||
      Array.isArray(after)
    )
      return
    for (const [key, value] of Object.entries(before)) {
      if (!Object.hasOwn(after, key))
        issues.push({
          code: 'unrecognized_keys',
          keys: [key],
          path,
          message: `Unsupported action field: ${[...path, key].join('.')}`,
        })
      else inspect(value, (after as Record<string, unknown>)[key], [...path, key])
    }
  }
  inspect(args, parsed, [])
  if (issues.length) throw new z.ZodError(issues)
  return parsed as Args
}
const ACTION_INSTRUCTIONS = Object.entries(ACTIONS).map(([kind, action]) => ({
  kind,
  description: action.description,
  arguments: z.toJSONSchema(action.schema, { unrepresentable: 'any' }),
}))
export function actionInstructions(isHead = false) {
  return ACTION_INSTRUCTIONS.filter(
    (action) =>
      isHead || (!ACTIONS[action.kind]?.headOnly && !action.description.startsWith('HEAD ONLY')),
  )
}
