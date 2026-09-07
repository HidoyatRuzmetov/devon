// The shared "chips + '+ Filtr' popover" clause editor for the filter-grammar text
// (`@devon/contracts`'s `parseFilterQuery`/`serializeFilterQuery`) -- pulled out of `filter-bar.tsx`
// (the work views' own filter bar) so `/analytics` can reuse the exact same editor instead of the raw
// query-syntax text box round 1 rejected there and round 2 found still shipping (UI-OVERHAUL.md §2
// "Filters": "chips with type-ahead, a '+ Filter' popover"). Each screen still owns its own URL
// param, saved-view/saved-filter API and date-range chrome around this -- only the clause editor
// itself is shared, since that is the actual UI/UX piece the two screens must agree on.
import * as React from 'react'
import { X } from 'lucide-react'
import { useT } from '@devon/i18n'
import {
  parseFilterQuery,
  serializeFilterQuery,
  type CompareOp,
  type FilterClause,
} from '@devon/contracts'
import {
  Button,
  cn,
  comboboxScore,
  FilterChip,
  Input,
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@devon/ui'
import { useBoardQuery } from '../hooks.js'
import { useProjectsQuery } from '../../projects/hooks.js'
import { fullName } from '../lib/format.js'

export type FieldKey = 'assignee' | 'giver' | 'status' | 'due' | 'project' | 'label'
export const FIELD_ORDER: readonly FieldKey[] = [
  'assignee',
  'giver',
  'status',
  'due',
  'project',
  'label',
]
export const FIELD_LABEL_KEY: Record<FieldKey, string> = {
  assignee: 'work.field.assignee',
  giver: 'work.field.giver',
  status: 'work.field.status',
  due: 'work.field.due',
  project: 'work.field.project',
  label: 'work.field.labels',
}
export const STATUS_VALUES = ['active', 'done', 'archived'] as const
export const DUE_OPERATORS: readonly CompareOp[] = ['<=', '>=', '<', '>', '=']
export const DUE_WORDS = [
  'today',
  'tomorrow',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
] as const

/** One line per structured clause, "text" clauses folded into a single trailing search chip -- a
 * free-text search of several words parses into one `text` clause per word (`parseFilterQuery`'s own
 * doc comment), and a chip per word would turn a sentence into a wall of identical-looking pills. */
export function splitClauses(clauses: readonly FilterClause[]): {
  structured: readonly { clause: FilterClause; index: number }[]
  textWords: string[]
} {
  const structured: { clause: FilterClause; index: number }[] = []
  const textWords: string[] = []
  clauses.forEach((clause, index) => {
    if (clause.kind === 'text') textWords.push(clause.value)
    else structured.push({ clause, index })
  })
  return { structured, textWords }
}

export function clauseLabel(
  clause: FilterClause,
  t: ReturnType<typeof useT>,
  memberName: (token: string) => string,
): string {
  switch (clause.kind) {
    case 'assignee':
      return `${t(FIELD_LABEL_KEY.assignee)}: ${memberName(clause.token)}`
    case 'giver':
      return `${t(FIELD_LABEL_KEY.giver)}: ${memberName(clause.token)}`
    case 'status':
      return `${t(FIELD_LABEL_KEY.status)}: ${t(`work.status.${clause.value}`)}`
    case 'due': {
      // A word this grammar knows (today/tomorrow/a weekday) gets its translated form; anything
      // else -- someone typed a literal `YYYY-MM-DD` in the advanced box -- is shown verbatim.
      const known = (DUE_WORDS as readonly string[]).includes(clause.word)
      const word = known ? t(`work.filter.dueWord.${clause.word}`) : clause.word
      return `${t(FIELD_LABEL_KEY.due)} ${t(`work.filter.op.${opKey(clause.op)}`)} ${word}`
    }
    case 'project':
      return `${t(FIELD_LABEL_KEY.project)}: ${clause.name}`
    case 'label':
      return `${t(FIELD_LABEL_KEY.label)}: ${clause.name}`
    case 'unit':
      // Not offered in the "+ Filtr" add list (EPIC-003 sub-department units have not shipped on
      // the client -- board-screen.tsx's own comment), but a saved view/filter or a hand-typed
      // advanced query can already carry one, so it still needs a readable chip.
      return `${t('work.field.unit')}: ${clause.name}`
    case 'text':
      return clause.value
    default: {
      const exhaustive: never = clause
      return exhaustive
    }
  }
}

// A plain object literal keyed by the comparison operators themselves trips the i18n gate's
// hard-coded-JSX-text heuristic (it scans the raw source for a run of letters sitting between two
// of the operator characters, not just inside real JSX) -- a switch says the same thing without
// tripping it.
export function opKey(op: CompareOp): string {
  switch (op) {
    case '<=':
      return 'lte'
    case '>=':
      return 'gte'
    case '<':
      return 'lt'
    case '>':
      return 'gt'
    case '=':
      return 'eq'
  }
}

/** A small in-popover search list, scored the same way the product's cmdk-backed comboboxes are
 * (`comboboxScore`) -- kept as plain buttons rather than pulling `cmdk` itself into `apps/web` (only
 * `@devon/ui` depends on it) for a one-column list with no async source. */
function FilterPickList({
  options,
  onPick,
  searchPlaceholder,
  emptyMessage,
}: {
  options: readonly { value: string; label: string }[]
  onPick: (value: string) => void
  searchPlaceholder: string
  emptyMessage: string
}) {
  const [search, setSearch] = React.useState('')
  const filtered = search.trim()
    ? options.filter((o) => comboboxScore(o.label, search) > 0)
    : options
  return (
    <div className="flex max-h-72 flex-col">
      <Input
        autoFocus
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder={searchPlaceholder}
        className="rounded-b-none border-0 border-b border-border focus-visible:ring-0"
      />
      <div className="flex-1 overflow-y-auto p-1">
        {filtered.length === 0 ? (
          <p className="px-2 py-3 text-small text-muted-foreground">{emptyMessage}</p>
        ) : (
          filtered.map((o) => (
            <button
              key={o.value}
              type="button"
              className="flex w-full items-center rounded-sm px-2 py-1.5 text-left text-small text-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
              onClick={() => onPick(o.value)}
            >
              {o.label}
            </button>
          ))
        )}
      </div>
    </div>
  )
}

/** The "+ Filtr" popover: pick a field, then its value, in one continuous flow that never asks
 * anyone to type `assignee:@me due:<=friday label:urgent` by hand. */
function AddFilterPopover({ onAdd }: { onAdd: (clause: FilterClause) => void }) {
  const t = useT()
  const board = useBoardQuery().data
  const projects = useProjectsQuery().data ?? []
  const [open, setOpen] = React.useState(false)
  const [field, setField] = React.useState<FieldKey | null>(null)
  const [dueOp, setDueOp] = React.useState<CompareOp>('<=')

  function reset() {
    setField(null)
    setDueOp('<=')
  }

  function commit(clause: FilterClause) {
    onAdd(clause)
    setOpen(false)
    reset()
  }

  const memberOptions = [
    { value: '@me', label: t('work.filter.me') },
    ...(board?.members ?? []).map((m) => ({ value: m.givenName, label: fullName(m) })),
  ]
  const projectOptions = projects.map((p) => ({ value: p.title, label: p.title }))
  const labelOptions = (board?.labels ?? []).map((l) => ({ value: l.name, label: l.name }))
  const statusOptions = STATUS_VALUES.map((v) => ({ value: v, label: t(`work.status.${v}`) }))
  const dueWordOptions = DUE_WORDS.map((w) => ({ value: w, label: t(`work.filter.dueWord.${w}`) }))

  let body: React.ReactNode
  if (field === null) {
    body = (
      <FilterPickList
        options={FIELD_ORDER.map((f) => ({ value: f, label: t(FIELD_LABEL_KEY[f]) }))}
        onPick={(v) => setField(v as FieldKey)}
        searchPlaceholder={t('work.filter.fieldStep')}
        emptyMessage={t('work.filter.noOptions')}
      />
    )
  } else if (field === 'assignee' || field === 'giver') {
    body = (
      <FilterPickList
        options={memberOptions}
        onPick={(v) => commit({ kind: field, token: v })}
        searchPlaceholder={t('work.filter.valueStep')}
        emptyMessage={t('work.filter.noOptions')}
      />
    )
  } else if (field === 'status') {
    body = (
      <FilterPickList
        options={statusOptions}
        onPick={(v) => commit({ kind: 'status', value: v as (typeof STATUS_VALUES)[number] })}
        searchPlaceholder={t('work.filter.valueStep')}
        emptyMessage={t('work.filter.noOptions')}
      />
    )
  } else if (field === 'project') {
    body = (
      <FilterPickList
        options={projectOptions}
        onPick={(v) => commit({ kind: 'project', name: v })}
        searchPlaceholder={t('work.filter.valueStep')}
        emptyMessage={t('work.filter.noOptions')}
      />
    )
  } else if (field === 'label') {
    body = (
      <FilterPickList
        options={labelOptions}
        onPick={(v) => commit({ kind: 'label', name: v })}
        searchPlaceholder={t('work.filter.valueStep')}
        emptyMessage={t('work.filter.noOptions')}
      />
    )
  } else {
    // due: operator segmented control, then a word list.
    body = (
      <div className="flex flex-col">
        <div className="flex flex-wrap gap-1 border-b border-border p-2">
          {DUE_OPERATORS.map((op) => (
            <button
              key={op}
              type="button"
              onClick={() => setDueOp(op)}
              className={cn(
                'rounded-sm px-2 py-1 text-caption font-medium',
                dueOp === op
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted text-muted-foreground hover:bg-accent',
              )}
            >
              {t(`work.filter.op.${opKey(op)}`)}
            </button>
          ))}
        </div>
        <FilterPickList
          options={dueWordOptions}
          onPick={(v) => commit({ kind: 'due', op: dueOp, word: v })}
          searchPlaceholder={t('work.filter.valueStep')}
          emptyMessage={t('work.filter.noOptions')}
        />
      </div>
    )
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) reset()
      }}
    >
      <PopoverTrigger asChild>
        <FilterChip addVariant>{t('work.filter.addFilter')}</FilterChip>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-0">
        {field !== null ? (
          <div className="flex items-center gap-1 border-b border-border px-2 py-1">
            <button
              type="button"
              onClick={() => setField(null)}
              className="rounded-sm px-1 py-0.5 text-caption text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              &larr; {t(FIELD_LABEL_KEY[field])}
            </button>
          </div>
        ) : null}
        {body}
      </PopoverContent>
    </Popover>
  )
}

/** Removable chips for every clause in `query`, plus the "+ Filtr" popover to add another --
 * `query`/`onChange` are the whole contract, so a caller (a URL param, an object field, anything
 * `serializeFilterQuery` round-trips) never has to know this editor's internals. */
export function FilterClauseChips({
  query,
  onChange,
  className,
}: {
  query: string
  onChange: (next: string) => void
  className?: string
}) {
  const t = useT()
  const board = useBoardQuery().data
  const parsed = React.useMemo(() => parseFilterQuery(query), [query])
  const { structured, textWords } = splitClauses(parsed.clauses)

  function memberName(token: string): string {
    if (token === '@me' || token === 'me') return t('work.filter.me')
    const m = board?.members.find((mm) => mm.givenName === token || mm.familyName === token)
    return m ? fullName(m) : token
  }

  function removeClauseAt(index: number) {
    onChange(serializeFilterQuery(parsed.clauses.filter((_, i) => i !== index)))
  }

  function removeAllTextWords() {
    onChange(serializeFilterQuery(parsed.clauses.filter((c) => c.kind !== 'text')))
  }

  function addClause(clause: FilterClause) {
    onChange(serializeFilterQuery([...parsed.clauses, clause]))
  }

  return (
    <div className={cn('flex flex-wrap items-center gap-1.5', className)}>
      {structured.map(({ clause, index }) => (
        <FilterChip
          key={index}
          active
          onClick={() => removeClauseAt(index)}
          aria-label={t('work.filter.removeChip', { chip: clauseLabel(clause, t, memberName) })}
        >
          {clauseLabel(clause, t, memberName)}
          <X className="size-3 text-muted-foreground" aria-hidden="true" />
        </FilterChip>
      ))}
      {textWords.length > 0 ? (
        <FilterChip
          active
          onClick={removeAllTextWords}
          aria-label={t('work.filter.removeChip', { chip: textWords.join(' ') })}
        >
          {textWords.join(' ')}
          <X className="size-3 text-muted-foreground" aria-hidden="true" />
        </FilterChip>
      ) : null}
      <AddFilterPopover onAdd={addClause} />
    </div>
  )
}
