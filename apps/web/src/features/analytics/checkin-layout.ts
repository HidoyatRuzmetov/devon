import type { CheckinEntry, CheckinSourceCard } from '@devon/contracts'
export const priorityOrder = { urgent: 0, high: 1, medium: 2, low: 3, none: 4 }
export type CheckinTask = CheckinSourceCard & { entries: CheckinEntry[]; sourceAvailable: boolean }
export function checkinTasks(
  entries: CheckinEntry[],
  sources: CheckinSourceCard[],
  editing: boolean,
): CheckinTask[] {
  const tasks = new Map<string, CheckinTask>()
  for (const source of sources)
    if (editing || entries.some((e) => e.cardId === source.id))
      tasks.set(source.id, { ...source, entries: [], sourceAvailable: true })
  for (const entry of entries) {
    if (!tasks.has(entry.cardId))
      tasks.set(entry.cardId, {
        id: entry.cardId,
        title: entry.cardTitle,
        priority: entry.cardPriority,
        projectId: entry.projectId,
        projectTitle: entry.projectTitle,
        version: entry.cardVersion ?? 0,
        canEdit: entry.canEditCard,
        checklist: [],
        entries: [],
        sourceAvailable: entry.sourceAvailable,
      })
    tasks.get(entry.cardId)!.entries.push(entry)
  }
  return [...tasks.values()]
}
export function checkinGroups(tasks: CheckinTask[], mode: 'priority' | 'manual', order: string[]) {
  const compare = (a: CheckinTask, b: CheckinTask) => {
    const priority = priorityOrder[a.priority] - priorityOrder[b.priority]
    if (mode === 'priority')
      return priority || a.title.localeCompare(b.title) || a.id.localeCompare(b.id)
    const ai = order.indexOf(a.id),
      bi = order.indexOf(b.id)
    return (
      (ai < 0 ? Infinity : ai) - (bi < 0 ? Infinity : bi) || priority || a.id.localeCompare(b.id)
    )
  }
  const groups = new Map<string, CheckinTask[]>()
  for (const task of [...tasks].sort(compare)) {
    const key = task.projectId ?? task.id
    groups.set(key, [...(groups.get(key) ?? []), task])
  }
  return [...groups]
    .map(([id, cards]) => ({ id, cards }))
    .sort((a, b) => compare(a.cards[0]!, b.cards[0]!))
}
