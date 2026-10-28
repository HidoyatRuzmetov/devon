// Plan the complete batch before persistence. Caller holds the owner's task-ordering lock;
// the graph contains only that owner's undeleted tasks, never foreign or historical rows.
export type TaskPlacement = {
  id: string
  parent_id: string | null
  sort: number
}
export type PlacementInput = {
  id: string
  parentId?: string | null | undefined
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
    }
    if (input.parentId !== undefined) affected.add(input.id)
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
  return [...next.values()].filter((row) => {
    const old = current.get(row.id)!
    return changes.has(row.id) || old.parent_id !== row.parent_id
  })
}
