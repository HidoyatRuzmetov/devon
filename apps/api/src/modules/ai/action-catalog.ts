import { z } from 'zod'
import {
  createCardBodySchema,
  patchCardBodySchema,
  createChecklistItemBodySchema,
  patchChecklistItemBodySchema,
  createCommentBodySchema,
  patchCommentBodySchema,
} from '../work/schemas.js'
import { createPageBodySchema, patchPageBodySchema } from '../pages/schemas.js'
import {
  createProjectBodySchema,
  patchProjectBodySchema,
  addMilestoneBodySchema,
  patchMilestoneBodySchema,
} from '../projects/schemas.js'
import {
  createTaskBodySchema,
  patchTaskBodySchema,
  createNoteBodySchema,
  patchNoteBodySchema,
  createSprintBodySchema,
  patchSprintBodySchema,
} from '../personal/schemas.js'
import {
  createEventBodySchema,
  updateEventBodySchema,
  cancelEventBodySchema,
  rsvpBodySchema,
  commentBodySchema as eventCommentBodySchema,
  feedbackBodySchema,
  editCommentBodySchema as editEventCommentBodySchema,
  carpoolBodySchema,
  carpoolUpdateBodySchema,
  carpoolClaimBodySchema,
  itemBodySchema,
  pollBodySchema,
  pollVoteBodySchema,
} from '../events/schemas.js'

const id = z.uuid()
const target = z.object({ id }).strict()
const body = (schema: z.ZodType) => z.object({ body: schema }).strict()
const withFiles = (schema: z.ZodType) =>
  z.object({ body: schema, attachmentIds: z.array(id).max(10).optional() }).strict()
const patch = (schema: z.ZodType) => z.object({ id, body: schema }).strict()
type Method = 'POST' | 'PATCH' | 'DELETE'
type Args = Record<string, unknown>
type Action = {
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
const cardHref = (id: string) => `/work/card?id=${id}`
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
export const ACTIONS: Record<string, Action> = {
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
    'Edit a card, assign it, change dates/priority/status/workStage, complete or archive it. Include its current version.',
  ),
  'card.delete': resource(
    'cards',
    () => '/work',
    'DELETE',
    target,
    'Soft-delete one specified card after explicit confirmation.',
  ),
  'card.restore': {
    ...resource('cards', cardHref, 'POST', target, 'Restore one archived card.'),
    path: (a) => `/cards/${a['id']}/restore`,
  },
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
  'personal.note.create': resource(
    'personal/notes',
    () => '/personal',
    'POST',
    body(createNoteBodySchema),
    'Create a private note for the current user.',
  ),
  'personal.note.update': resource(
    'personal/notes',
    () => '/personal',
    'PATCH',
    patch(patchNoteBodySchema),
    'Update a private note belonging to the current user.',
  ),
  'personal.sprint.create': resource(
    'personal/sprints',
    () => '/personal',
    'POST',
    body(createSprintBodySchema),
    'Create a personal planning period.',
  ),
  'personal.sprint.update': resource(
    'personal/sprints',
    () => '/personal',
    'PATCH',
    patch(patchSprintBodySchema),
    'Update the current user’s personal planning period.',
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

export const proposedActionSchema = z
  .object({
    kind: z.string(),
    title: z.string().min(1).max(140),
    summary: z.string().min(1).max(1600),
    arguments: z.record(z.string(), z.unknown()),
  })
  .strict()
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
export function actionInstructions() {
  return Object.entries(ACTIONS).map(([kind, action]) => ({
    kind,
    description: action.description,
    arguments: z.toJSONSchema(action.schema, { unrepresentable: 'any' }),
  }))
}
