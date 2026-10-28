import { actionInstructions } from './action-catalog.js'
import type { DepartmentChatContext } from './conversation-context.js'

type Entry = {
  ref: string
  title?: string
  facts?: Record<string, unknown>
  [key: string]: unknown
}
const entries = (values: unknown[]) => values as Entry[]

/** A directory is never passed off as document content. Every admitted source remains available
 * for expansion, including attachment text and child IDs; selection changes no permissions. */
export function conversationWindow(
  context: DepartmentChatContext,
  question: string,
  selected: ReadonlySet<string>,
  actionKinds: ReadonlySet<string>,
  full = false,
) {
  const tokens = new Set(question.toLocaleLowerCase().match(/[\p{L}\p{N}_-]{4,}/gu) ?? [])
  const normalizedQuestion = question.toLocaleLowerCase()
  const relevant = (entry: Entry) => {
    if (full || selected.has(entry.ref)) return true
    const title = String(entry.title ?? entry['name'] ?? '').toLocaleLowerCase()
    const words = title.match(/[\p{L}\p{N}_-]{4,}/gu) ?? []
    return (
      !!title &&
      (normalizedQuestion.includes(title) ||
        words.filter((word) => tokens.has(word)).length >=
          Math.max(2, Math.ceil(words.length * 0.7)))
    )
  }
  const rows = entries(context.snapshot)
  const byRef = new Map(rows.map((row) => [row.ref, row]))
  const selectedIds = [...selected].map((ref) => ref.split(':').at(-1)!).filter(Boolean)
  const relatedRefs = new Set(
    rows
      .filter((row) => {
        const facts = JSON.stringify(row.facts ?? {})
        return selectedIds.some((id) => facts.includes(id))
      })
      .map((row) => row.ref),
  )
  const chosen = rows.filter(
    (entry) => relevant(entry) || JSON.stringify(entry).length < 1100 || relatedRefs.has(entry.ref),
  )
  const chosenRefs = new Set(chosen.map((entry) => entry.ref))
  const evidence = entries(context.evidence).map((entry) => {
    // Search excerpts are already bounded. File contents are read on demand; current uploads and
    // files belonging to a selected record stay available in full.
    const parent = byRef.get(String(entry['parent'] ?? ''))
    if (
      !('text' in entry) ||
      relevant(entry) ||
      (parent && (relevant(parent) || relatedRefs.has(parent.ref)))
    )
      return entry
    const { text: _text, ...metadata } = entry
    return { ...metadata, contentAvailable: typeof _text === 'string' && _text.length > 0 }
  })
  const actions = actionInstructions()
  return {
    snapshot: {
      totals: context.totals,
      directoryColumns: ['ref', 'title'],
      directory: entries(context.directory ?? context.snapshot)
        .filter((entry) => !chosenRefs.has(entry.ref))
        .map(({ ref, title }) => [ref, title]),
      snapshot: chosen,
      evidence,
      recordsIncluded: chosen.length,
      recordsTotal: context.recordsTotal,
      limited: context.limited || chosen.length < rows.length,
    },
    actions: actions.map((action) =>
      full || actionKinds.has(action.kind)
        ? action
        : {
            kind: action.kind,
            description: action.description,
            argumentsAvailableOnRequest: true,
          },
    ),
    recordsIncluded: chosen.length,
  }
}
