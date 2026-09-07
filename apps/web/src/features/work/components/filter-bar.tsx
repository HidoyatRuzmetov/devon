// The filter bar (TECH-SPEC §4/§5, UI-OVERHAUL.md §8 "Filters"): removable chips for the parsed
// filter grammar (`@devon/contracts`'s `parseFilterQuery`/`serializeFilterQuery`), a "+ Filtr"
// popover (field -> value, cmdk-style scoring) to add another clause without ever typing the
// grammar, the raw text kept one toggle away for anyone who prefers it, and saved views as a row of
// tabs -- all of it still just the `?q=` search param, so a filter typed here survives switching
// Board/Table/Timeline/Calendar/Mine and is exactly what "share this view" means.
import * as React from 'react'
import { Bookmark, Filter as FilterIcon, Save, Trash2, X } from 'lucide-react'
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
  toast,
} from '@devon/ui'
import { navigate, replaceSearchParam, useSearchParams } from '../../../lib/router.js'
import {
  useCreateSavedViewMutation,
  useDeleteSavedViewMutation,
  useSavedViewsQuery,
  useBoardQuery,
} from '../hooks.js'
import { useProjectsQuery } from '../../projects/hooks.js'
import { fullName } from '../lib/format.js'
import type { SavedViewLayout } from '../api.js'

const LAYOUT_ROUTE: Record<SavedViewLayout, string> = {
  people_board: '/work',
  table: '/work/table',
  timeline: '/work/timeline',
  calendar: '/work/calendar',
  mine: '/work/mine',
}

type FieldKey = 'assignee' | 'giver' | 'status' | 'due' | 'project' | 'label'
const FIELD_ORDER: readonly FieldKey[] = ['assignee', 'giver', 'status', 'due', 'project', 'label']
const FIELD_LABEL_KEY: Record<FieldKey, string> = {
  assignee: 'work.field.assignee',
  giver: 'work.field.giver',
  status: 'work.field.status',
  due: 'work.field.due',
  project: 'work.field.project',
  label: 'work.field.labels',
}
const STATUS_VALUES = ['active', 'done', 'archived'] as const
const DUE_OPERATORS: readonly CompareOp[] = ['<=', '>=', '<', '>', '=']
const DUE_WORDS = [
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
function splitClauses(clauses: readonly FilterClause[]): {
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

function clauseLabel(
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
      // the client -- board-screen.tsx's own comment), but a saved view or a hand-typed advanced
      // query can already carry one, so it still needs a readable chip.
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
function opKey(op: CompareOp): string {
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

export function FilterBar({ layout }: { layout: SavedViewLayout }) {
  const t = useT()
  const search = useSearchParams()
  const q = search.get('q') ?? ''
  const board = useBoardQuery().data
  const [text, setText] = React.useState(q)
  const [advanced, setAdvanced] = React.useState(false)
  const [saveName, setSaveName] = React.useState('')
  const [saveOpen, setSaveOpen] = React.useState(false)

  React.useEffect(() => setText(q), [q])

  const savedViews = useSavedViewsQuery().data ?? []
  const createView = useCreateSavedViewMutation()
  const deleteView = useDeleteSavedViewMutation()

  function applyFilter(next: string) {
    replaceSearchParam('q', next.trim().length > 0 ? next : null)
  }

  const parsed = React.useMemo(() => parseFilterQuery(q), [q])
  const { structured, textWords } = splitClauses(parsed.clauses)

  function memberName(token: string): string {
    if (token === '@me' || token === 'me') return t('work.filter.me')
    const m = board?.members.find((mm) => mm.givenName === token || mm.familyName === token)
    return m ? fullName(m) : token
  }

  function removeClauseAt(index: number) {
    const next = parsed.clauses.filter((_, i) => i !== index)
    applyFilter(serializeFilterQuery(next))
  }

  function removeAllTextWords() {
    const next = parsed.clauses.filter((c) => c.kind !== 'text')
    applyFilter(serializeFilterQuery(next))
  }

  function addClause(clause: FilterClause) {
    applyFilter(serializeFilterQuery([...parsed.clauses, clause]))
  }

  function applySavedView(view: (typeof savedViews)[number]) {
    const route = LAYOUT_ROUTE[view.layout]
    navigate(view.filter ? `${route}?q=${encodeURIComponent(view.filter)}` : route)
  }

  async function saveCurrentFilter() {
    if (saveName.trim().length === 0) return
    try {
      await createView.mutateAsync({ name: saveName.trim(), filter: q, layout })
      setSaveName('')
      setSaveOpen(false)
      toast(t('work.filter.saved'))
    } catch {
      toast(t('work.filter.saveError'))
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-1.5">
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

        <Popover open={saveOpen} onOpenChange={setSaveOpen}>
          <PopoverTrigger asChild>
            <Button size="sm" variant="ghost" disabled={q.length === 0}>
              <Save className="size-4" aria-hidden="true" />
              {t('work.filter.saveAs')}
            </Button>
          </PopoverTrigger>
          <PopoverContent>
            <p className="mb-2 text-small font-medium text-foreground">{t('work.filter.saveAs')}</p>
            <div className="flex gap-2">
              <Input
                value={saveName}
                onChange={(e) => setSaveName(e.target.value)}
                placeholder={t('work.filter.viewName')}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void saveCurrentFilter()
                }}
                autoFocus
              />
              <Button
                size="sm"
                onClick={() => void saveCurrentFilter()}
                loading={createView.isPending}
              >
                {t('work.action.save')}
              </Button>
            </div>
          </PopoverContent>
        </Popover>

        <button
          type="button"
          onClick={() => setAdvanced((v) => !v)}
          className="ml-auto rounded-sm px-2 py-1 text-caption font-medium text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          {advanced ? t('work.filter.hideAdvanced') : t('work.filter.showAdvanced')}
        </button>
      </div>

      {savedViews.length > 0 ? (
        <nav
          className="flex flex-wrap items-center gap-1 border-b border-border"
          aria-label={t('work.filter.savedViews')}
        >
          <Bookmark className="mr-1 size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
          {savedViews.map((view) => {
            const active = view.layout === layout && view.filter === q
            return (
              <span key={view.id} className="group relative -mb-px inline-flex items-center">
                <button
                  type="button"
                  onClick={() => applySavedView(view)}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'inline-flex min-h-9 items-center whitespace-nowrap border-b-2 px-3 pr-6 text-small font-medium transition-colors duration-(--dur-micro)',
                    active
                      ? 'border-primary text-foreground'
                      : 'border-transparent text-muted-foreground hover:text-foreground',
                  )}
                >
                  {view.name}
                </button>
                <button
                  type="button"
                  aria-label={t('work.action.delete')}
                  onClick={() => void deleteView.mutateAsync(view.id)}
                  className="absolute right-1 inline-flex size-4 items-center justify-center rounded-full text-muted-foreground opacity-0 hover:bg-foreground/10 hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100"
                >
                  <Trash2 className="size-3" aria-hidden="true" />
                </button>
              </span>
            )
          })}
        </nav>
      ) : null}

      {advanced ? (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-dashed border-border p-2">
          <FilterIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <Input
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                applyFilter(text)
              }
            }}
            placeholder={t('work.filter.placeholder')}
            aria-label={t('work.filter.placeholder')}
            className="max-w-96 flex-1"
          />
          <Button size="sm" variant="secondary" onClick={() => applyFilter(text)}>
            {t('work.filter.apply')}
          </Button>
          {q.length > 0 ? (
            <Button size="sm" variant="ghost" onClick={() => applyFilter('')}>
              {t('work.filter.clear')}
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
