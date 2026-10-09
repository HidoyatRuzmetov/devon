// Plan the complete batch before persistence. Caller holds the owner's task-ordering lock;
// the graph contains only that owner's undeleted tasks, never foreign or historical rows.
export type TaskPlacement = {
  id: string
  parent_id: string | null
  sprint_id: string | null
  sort: number
}
export type PlacementInput = {
  id: string
  parentId?: string | null | undefined
  sprintId?: string | null | undefined
  sort?: number | undefined
}
export class PersonalTaskPlacementUnavailable extends Error {
  readonly statusCode = 422
  constructor() {
    super('Personal task placement is unavailable')
    this.name = 'PersonalTaskPlacementUnavailable'
  }
}

export function planTaskPlacements(
  graph: readonly TaskPlacement[],
  inputs: readonly PlacementInput[],
): TaskPlacement[] {
  const current = new Map(graph.map((row) => [row.id, row]))
  const changes = new Map<string, PlacementInput>()
  const next = new Map(graph.map((row) => [row.id, { ...row }]))
  const affected = new Set<string>()
  for (const input of inputs) {
    const row = next.get(input.id)
    if (!row || changes.has(input.id)) throw new PersonalTaskPlacementUnavailable()
    changes.set(input.id, input)
    if (input.sort !== undefined) row.sort = input.sort
    if (input.parentId !== undefined) {
      if (input.parentId !== null && !current.has(input.parentId))
        throw new PersonalTaskPlacementUnavailable()
      row.parent_id = input.parentId
    } else if (input.sprintId !== undefined && input.sprintId !== row.sprint_id) {
      // Moving a nested branch to another bucket makes it a root in that bucket.
      row.parent_id = null
    }
    if (input.sprintId !== undefined) row.sprint_id = input.sprintId
    if (input.parentId !== undefined || input.sprintId !== undefined) affected.add(input.id)
  }
  // Validate prospective ancestors, including cycles created only by a simultaneous batch.
  for (const id of affected) {
    const seen = new Set<string>()
    let cursor: string | null = id
    while (cursor) {
      if (seen.has(cursor)) throw new PersonalTaskPlacementUnavailable()
      seen.add(cursor)
      const row = next.get(cursor)
      if (!row) throw new PersonalTaskPlacementUnavailable()
      cursor = row.parent_id
    }
  }
  const children = new Map<string, string[]>()
  for (const row of next.values()) {
    if (row.parent_id) {
      const siblings = children.get(row.parent_id) ?? []
      siblings.push(row.id)
      children.set(row.parent_id, siblings)
    }
  }
  const queue = [...affected]
  for (let index = 0; index < queue.length; index++) {
    for (const child of children.get(queue[index]!) ?? []) {
      if (!affected.has(child)) {
        affected.add(child)
        queue.push(child)
      }
    }
  }
  // Every descendant shares its proposed parent's bucket. Resolve ancestors first without
  // recursion so a deeply nested personal list does not exhaust the JS call stack.
  const resolved = new Set<string>()
  for (const id of affected) {
    const chain: string[] = []
    let cursor: string | null = id
    while (cursor && affected.has(cursor) && !resolved.has(cursor)) {
      chain.push(cursor)
      cursor = next.get(cursor)!.parent_id
    }
    for (const childId of chain.reverse()) {
      const row = next.get(childId)!
      const input = changes.get(childId)
      if (row.parent_id) {
        const parent = next.get(row.parent_id)
        if (!parent) throw new PersonalTaskPlacementUnavailable()
        if (input?.sprintId !== undefined && input.sprintId !== parent.sprint_id)
          throw new PersonalTaskPlacementUnavailable()
        row.sprint_id = parent.sprint_id
      }
      resolved.add(childId)
    }
  }
  return [...next.values()].filter((row) => {
    const old = current.get(row.id)!
    return changes.has(row.id) || old.parent_id !== row.parent_id || old.sprint_id !== row.sprint_id
  })
}
