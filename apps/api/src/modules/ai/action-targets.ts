type Action = { kind: string; arguments: Record<string, unknown> }

/** Catch known identity/type confusion without guessing replacements or treating a bounded
 * snapshot as a complete database. Ordinary API permissions still guard every execution. */
export function actionTargetIssues(actions: readonly Action[], refs: readonly string[]): string[] {
  const identities = new Map<string, Set<string>>()
  for (const ref of refs) {
    const [type, id, child] = ref.split(':')
    if (!type || !id || child) continue
    const types = identities.get(id) ?? new Set<string>()
    types.add(type)
    identities.set(id, types)
  }
  return actions.flatMap((action) => {
    const expected = action.kind.startsWith('checkin.')
      ? ['checkin.add', 'checkin.lock'].includes(action.kind)
        ? 'checkin_cycle'
        : 'checkin_entry'
      : action.kind.startsWith('personal.calendar.')
        ? 'personal_calendar'
        : action.kind.startsWith('personal.task.')
          ? 'personal_task'
          : action.kind.startsWith('project.') || action.kind.startsWith('milestone.')
            ? 'project'
            : action.kind.startsWith('event.')
              ? 'event'
              : action.kind.startsWith('page.')
                ? 'page'
                : /^(card|checklist|comment)\./.test(action.kind)
                  ? 'card'
                  : undefined
    const id = action.arguments['id']
    if (!expected || typeof id !== 'string') return []
    const known = identities.get(id)
    return known && !known.has(expected)
      ? [
          `${action.kind}: id ${id} is ${[...known].join('/')}, but requires ${expected}. Read the requested entity and use its own ID; do not use its parent's ID.`,
        ]
      : []
  })
}
