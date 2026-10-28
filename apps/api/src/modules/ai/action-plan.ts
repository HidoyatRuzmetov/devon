import type { AiChatProposal } from '@devon/contracts'
import { z } from 'zod'
import { parseAction } from './action-catalog.js'

type PlannedAction = Pick<AiChatProposal, 'kind' | 'arguments' | 'key' | 'bindings'>
// Only a server-returned identity can flow between reviewed actions. Neither arbitrary response
// fields nor executable expressions are supported.
export const CREATED_ENTITY: Readonly<Record<string, string>> = {
  'project.create': 'project',
  'card.create': 'card',
  'card.withChecklist': 'card',
  'page.create': 'page',
  'event.create': 'event',
  'checklist.add': 'checklist',
  'personal.task.create': 'personalTask',
  'personal.calendar.create': 'personalCalendar',
}
const BINDABLE: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  'card.create': { 'body.projectId': 'project' },
  'card.withChecklist': { 'body.create.projectId': 'project', 'body.existingCardId': 'card' },
  'card.assignMany': { 'body.task.projectId': 'project' },
  'card.update': { id: 'card', 'body.projectId': 'project' },
  'milestone.add': { id: 'project' },
  'checklist.add': { id: 'card', 'body.parentItemId': 'checklist' },
  'checklist.update': { id: 'card', itemId: 'checklist' },
  'comment.create': { id: 'card' },
  'event.rsvp': { id: 'event' },
  'event.comment.create': { id: 'event' },
  'event.item.create': { id: 'event' },
  'event.poll.create': { id: 'event' },
  'event.carpool.create': { id: 'event' },
  'personal.task.create': { 'body.parentId': 'personalTask', 'body.linkedCardId': 'card' },
  'checkin.add': { 'body.checklistItemId': 'checklist' },
}
const PLACEHOLDER = '00000000-0000-4000-8000-000000000001'
function location(args: Record<string, unknown>, path: string) {
  const parts = path.split('.')
  const key = parts.pop()!
  let parent = args
  for (const part of parts) {
    const next = parent[part]
    if (!next || typeof next !== 'object' || Array.isArray(next))
      throw new Error('binding_container_missing')
    parent = next as Record<string, unknown>
  }
  return { parent, key }
}
function bindingType(action: PlannedAction, path: string): string | undefined {
  if (action.kind === 'attachment.attach' && path === 'targetId')
    return action.arguments['targetType'] === 'card'
      ? 'card'
      : action.arguments['targetType'] === 'page'
        ? 'page'
        : undefined
  return BINDABLE[action.kind]?.[path]
}

/** Validate all ordinary domain arguments before review, substituting only typed identity slots.
 * The temporary UUID never reaches storage, a request, or the approval UI. */
export function parsePlannedArguments(action: PlannedAction): Record<string, unknown> {
  const args = structuredClone(action.arguments)
  const paths = new Set<string>()
  for (const binding of action.bindings ?? []) {
    if (!bindingType(action, binding.path) || paths.has(binding.path))
      throw new Error('unsupported_or_duplicate_binding')
    paths.add(binding.path)
    const { parent, key } = location(args, binding.path)
    if (parent[key] !== undefined && parent[key] !== null)
      throw new Error('bound_argument_must_be_omitted')
    parent[key] = PLACEHOLDER
  }
  const parsed = parseAction(action.kind, args)
  for (const path of paths) {
    const { parent, key } = location(parsed, path)
    delete parent[key]
  }
  return parsed
}

/** Normalize an acyclic plan into dependency order before showing it for review. The model may
 * describe children first; users should not pay for another generation just to reorder them.
 * References never cross messages or conversations. */
export function validateActionPlan<T extends PlannedAction>(actions: readonly T[]): T[] {
  const keyed = new Map<string, T>()
  for (const action of actions) {
    if (action.key && keyed.has(action.key)) throw new Error('duplicate_action_key')
    if (action.key) keyed.set(action.key, action)
  }
  const visiting = new Set<T>(),
    visited = new Set<T>(),
    ordered: T[] = []
  function visit(action: T) {
    if (visited.has(action)) return
    if (visiting.has(action)) throw new Error('cyclic_action_dependency')
    visiting.add(action)
    for (const binding of action.bindings ?? []) {
      const source = keyed.get(binding.from)
      if (!source || CREATED_ENTITY[source.kind] !== bindingType(action, binding.path))
        throw new Error('binding_requires_matching_entity')
      visit(source)
    }
    visiting.delete(action)
    visited.add(action)
    ordered.push({ ...action, arguments: parsePlannedArguments(action) })
  }
  for (const action of actions) visit(action)
  return ordered
}

export function resolveActionBindings(
  action: PlannedAction,
  earlier: ReadonlyMap<string, AiChatProposal>,
): Record<string, unknown> {
  const args = structuredClone(action.arguments)
  for (const binding of action.bindings ?? []) {
    const source = earlier.get(binding.from)
    if (
      !source ||
      source.status !== 'executed' ||
      CREATED_ENTITY[source.kind] !== bindingType(action, binding.path) ||
      !z.uuid().safeParse(source.result?.entityId).success
    )
      throw new Error('dependency_unavailable')
    const { parent, key } = location(args, binding.path)
    parent[key] = source.result!.entityId!
  }
  return parseAction(action.kind, args)
}

export function bindingInstructions() {
  return BINDABLE
}
