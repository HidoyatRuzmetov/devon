// Pure helpers for building/flattening the nested task tree and computing drag/keyboard reorder
// results -- kept dependency-free (no drag-and-drop library) and separate from the view component so
// the tree logic itself is easy to reason about.
import type { Task } from './types.js'

export type TaskNode = Task & { children: TaskNode[]; depth: number }

/** Builds the nested tree for one sprint bucket (or the `null` "inbox" bucket), sorted by `sort`. A
 * task whose `parentId` points at a task outside this bucket (should not happen, but a stale/foreign
 * id must never crash the view) is treated as top-level. */
export function buildTree(tasks: readonly Task[]): TaskNode[] {
  const byId = new Map(tasks.map((t) => [t.id, t]))
  const cyclic = new Set<string>()
  const checked = new Set<string>()
  for (const task of tasks) {
    const path: string[] = []
    const positions = new Map<string, number>()
    let cursor: string | null = task.id
    while (cursor && byId.has(cursor) && !checked.has(cursor)) {
      const repeated = positions.get(cursor)
      if (repeated !== undefined) {
        for (const id of path.slice(repeated)) cyclic.add(id)
        break
      }
      positions.set(cursor, path.length)
      path.push(cursor)
      cursor = byId.get(cursor)!.parentId
    }
    for (const id of path) checked.add(id)
  }
  const childrenOf = new Map<string | null, Task[]>()
  for (const task of tasks) {
    // Corrupt cycle members are safe top-level rows; their valid descendants remain nested.
    // This is presentation recovery only and never silently rewrites persisted references.
    const parentKey =
      !cyclic.has(task.id) && task.parentId && byId.has(task.parentId) ? task.parentId : null
    const list = childrenOf.get(parentKey) ?? []
    list.push(task)
    childrenOf.set(parentKey, list)
  }
  for (const list of childrenOf.values()) list.sort((a, b) => a.sort - b.sort)

  const nodes = new Map(
    tasks.map((task) => [task.id, { ...task, depth: 0, children: [] } as TaskNode]),
  )
  for (const [parentId, children] of childrenOf) {
    if (parentId) nodes.get(parentId)!.children = children.map((task) => nodes.get(task.id)!)
  }
  const roots = (childrenOf.get(null) ?? []).map((task) => nodes.get(task.id)!)
  const stack = [...roots]
  while (stack.length) {
    const parent = stack.pop()!
    for (const child of parent.children) {
      child.depth = parent.depth + 1
      stack.push(child)
    }
  }
  return roots
}

/** Depth-first flatten, preserving tree order -- what the view actually renders as rows. */
export function flattenTree(nodes: readonly TaskNode[]): TaskNode[] {
  const out: TaskNode[] = []
  const stack = [...nodes].reverse()
  while (stack.length) {
    const node = stack.pop()!
    out.push(node)
    for (let index = node.children.length - 1; index >= 0; index--)
      stack.push(node.children[index]!)
  }
  return out
}

/** True if `candidateAncestorId` is `taskId` itself or one of its descendants -- guards both drag
 * and keyboard indent from ever nesting a task under its own subtree. */
export function isSelfOrDescendant(
  tasks: readonly Task[],
  taskId: string,
  candidateAncestorId: string,
): boolean {
  if (taskId === candidateAncestorId) return true
  const byParent = new Map<string, string | null>(tasks.map((t) => [t.id, t.parentId]))
  let cursor: string | null = candidateAncestorId
  const seen = new Set<string>()
  while (cursor) {
    if (cursor === taskId) return true
    if (seen.has(cursor)) break // cycle guard against corrupt data
    seen.add(cursor)
    cursor = byParent.get(cursor) ?? null
  }
  return false
}

/** Recomputes integer `sort` values (0, 1, 2, …) for every sibling under `parentId`, given the
 * desired ordered list of ids at that level -- the shape `reorderTasks` sends the server. */
export function siblingSorts(orderedIds: readonly string[]): { id: string; sort: number }[] {
  return orderedIds.map((id, index) => ({ id, sort: index }))
}
