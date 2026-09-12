// The Work module's filter grammar (TECH-SPEC §4, EPIC-004): a small, Linear-style token language --
// `assignee:@me giver:@nodira status:active due:<=friday project:"EGDI" label:urgent unit:"Data"
// free text` -- shared between the client (saved views, the filter bar, shareable URLs) and the
// server (turning the same tokens into a query predicate). Deliberately dependency-free (design.md
// §1.1/§1.2: `contracts` carries no runtime dependency beyond nothing here) so both `@devon/web` and
// `@devon/api` parse and evaluate identically -- a filter that matches on the client's optimistic
// list is never a different card set than what the server would have returned.
//
// This file does NOT talk to a database or know what a "member" or "project" really is: token ->
// candidate-id resolution ( "nodira" -> which user ids that could mean) is injected by the caller
// (`FilterContext.resolveUserIds` / `resolveProjectIds` / ...), so the grammar itself stays a pure,
// table-agnostic text-processing module, exactly like `permissions.ts`'s `can()`.
//
// The one intra-package import is `./custom-fields.js`, which is equally pure: v1.1 SPEC §5 puts
// `field:<key>:<value>` into this grammar, and the key shape and the "empty" words belong next to the
// field model rather than being retyped here.
import { FIELD_KEY_RE, isFieldEmptyWord, type FieldValue } from './custom-fields.js'

export type CardFilterStatus = 'active' | 'done' | 'archived'
export type CompareOp = '<=' | '>=' | '<' | '>' | '='

export type FilterClause =
  | { kind: 'assignee'; token: string } // token: '@me' or a bare handle/name, '@' stripped is not assumed
  | { kind: 'giver'; token: string }
  | { kind: 'status'; value: CardFilterStatus }
  | { kind: 'due'; op: CompareOp; word: string } // word: 'today' | a weekday name (any of the 3 locales) | 'YYYY-MM-DD'
  | { kind: 'project'; name: string }
  | { kind: 'label'; name: string }
  | { kind: 'unit'; name: string }
  /** v1.1 SPEC §5: `field:<key>:<value>` and `field:<key>:boʻsh`. `key` is a `FieldDef.key`
   * (`custom-fields.ts`'s `FIELD_KEY_RE`), `value` is compared case-insensitively against the stored
   * value -- an option id, a number, an ISO date, `ha`/`yoʻq` for a checkbox, or one member of a
   * multi-select. `empty` is the "nobody has filled this in" form. */
  | { kind: 'field'; key: string; value: string; empty: boolean }
  | { kind: 'text'; value: string }

export type FilterQuery = {
  readonly clauses: readonly FilterClause[]
  /** The exact string this was parsed from, kept only so `serializeFilterQuery` can be skipped when
   * a caller just wants to echo back what the user typed (e.g. keeping cursor position in an input). */
  readonly raw: string
}

const KNOWN_KEYS = new Set([
  'assignee',
  'giver',
  'status',
  'due',
  'project',
  'label',
  'unit',
  'field',
])
const STATUS_VALUES = new Set<CardFilterStatus>(['active', 'done', 'archived'])
const COMPARE_OPS: readonly CompareOp[] = ['<=', '>=', '<', '>', '='] // longest-first: checked in order

// One match per token: `key:"quoted value"` | `key:bareValue` | `"quoted free text"` | `bareWord`.
const TOKEN_RE = /([A-Za-z]+):"([^"]*)"|([A-Za-z]+):(\S+)|"([^"]*)"|(\S+)/g

function parseDueValue(raw: string): { op: CompareOp; word: string } {
  for (const op of COMPARE_OPS) {
    if (raw.startsWith(op)) return { op, word: raw.slice(op.length) }
  }
  return { op: '=', word: raw }
}

/**
 * Splits `input` into clauses. Unrecognised `key:value` tokens (a typo, or a key this grammar does
 * not define) are treated as free text rather than dropped -- a filter bar should never silently
 * discard part of what someone typed. Multiple free-text tokens are kept as separate `text` clauses
 * (all of them must match -- see `matchesFilterQuery`), which is what lets `"exact phrase" another`
 * behave the way a person expects.
 */
export function parseFilterQuery(input: string): FilterQuery {
  const clauses: FilterClause[] = []
  const trimmed = input.trim()
  if (trimmed.length === 0) return { clauses, raw: input }

  TOKEN_RE.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = TOKEN_RE.exec(trimmed))) {
    const [, qKey, qVal, bKey, bVal, quotedText, bareText] = match
    const key = (qKey ?? bKey)?.toLowerCase()
    const value = qVal ?? bVal

    if (key && value !== undefined && KNOWN_KEYS.has(key)) {
      switch (key) {
        case 'assignee':
          clauses.push({ kind: 'assignee', token: value })
          break
        case 'giver':
          clauses.push({ kind: 'giver', token: value })
          break
        case 'status': {
          const v = value.toLowerCase()
          if (STATUS_VALUES.has(v as CardFilterStatus)) {
            clauses.push({ kind: 'status', value: v as CardFilterStatus })
          } else {
            clauses.push({ kind: 'text', value: match[0] })
          }
          break
        }
        case 'due':
          clauses.push({ kind: 'due', ...parseDueValue(value) })
          break
        case 'project':
          clauses.push({ kind: 'project', name: value })
          break
        case 'label':
          clauses.push({ kind: 'label', name: value })
          break
        case 'unit':
          clauses.push({ kind: 'unit', name: value })
          break
        case 'field': {
          // `field:<key>:<rest>` -- split at the FIRST colon only, so an option label containing one
          // (`field:stage:2:tayyor`) keeps its own colons instead of being silently truncated.
          const colon = value.indexOf(':')
          const key = (colon === -1 ? value : value.slice(0, colon)).toLowerCase()
          const rest = colon === -1 ? '' : value.slice(colon + 1)
          if (!FIELD_KEY_RE.test(key)) {
            clauses.push({ kind: 'text', value: match[0] })
            break
          }
          clauses.push({
            kind: 'field',
            key,
            value: rest,
            empty: rest.length === 0 || isFieldEmptyWord(rest),
          })
          break
        }
      }
      continue
    }

    // Not a recognised `key:value` -- either genuinely free text, or an unknown key (kept verbatim
    // via `match[0]`, e.g. `foo:bar` stays searchable as the literal text "foo:bar").
    const text = quotedText ?? bareText ?? match[0]
    if (text.length > 0) clauses.push({ kind: 'text', value: text })
  }

  return { clauses, raw: input }
}

function quoteIfNeeded(value: string): string {
  return /\s/.test(value) ? `"${value}"` : value
}

/** Reconstructs a grammar string from clauses -- used when a saved view or a shareable URL stores
 * structured clauses and the filter bar needs to show (and let someone keep editing) the text form. */
export function serializeFilterQuery(clauses: readonly FilterClause[]): string {
  return clauses
    .map((c) => {
      switch (c.kind) {
        case 'assignee':
          return `assignee:${quoteIfNeeded(c.token)}`
        case 'giver':
          return `giver:${quoteIfNeeded(c.token)}`
        case 'status':
          return `status:${c.value}`
        case 'due':
          return `due:${c.op === '=' ? '' : c.op}${quoteIfNeeded(c.word)}`
        case 'project':
          return `project:${quoteIfNeeded(c.name)}`
        case 'label':
          return `label:${quoteIfNeeded(c.name)}`
        case 'unit':
          return `unit:${quoteIfNeeded(c.name)}`
        case 'field':
          // The quotes go around `<key>:<value>`, not around the whole token, so the result still
          // matches this grammar's own `key:"quoted value"` form when the value contains a space.
          return `field:${quoteIfNeeded(`${c.key}:${c.empty && !c.value ? 'boʻsh' : c.value}`)}`
        case 'text':
          return quoteIfNeeded(c.value)
      }
    })
    .join(' ')
}

// --- Relative date words (uz-Latn / ru / en; TECH-SPEC §4 "rules for uz/ru/en dates") -------------

const WEEKDAY_WORDS: ReadonlyArray<{ dow: number; words: readonly string[] }> = [
  { dow: 1, words: ['monday', 'mon', 'dushanba', 'du', 'понедельник', 'пн'] },
  { dow: 2, words: ['tuesday', 'tue', 'seshanba', 'se', 'вторник', 'вт'] },
  { dow: 3, words: ['wednesday', 'wed', 'chorshanba', 'ch', 'среда', 'ср'] },
  { dow: 4, words: ['thursday', 'thu', 'payshanba', 'pa', 'четверг', 'чт'] },
  { dow: 5, words: ['friday', 'fri', 'juma', 'ju', 'пятница', 'пт'] },
  { dow: 6, words: ['saturday', 'sat', 'shanba', 'sh', 'суббота', 'сб'] },
  {
    dow: 0,
    words: ['sunday', 'sun', 'yakshanba', 'ya', 'воскресенье', 'вс'],
  },
]

const TODAY_WORDS = new Set(['today', 'bugun', 'сегодня'])
const TOMORROW_WORDS = new Set(['tomorrow', 'ertaga', 'завтра'])
const YESTERDAY_WORDS = new Set(['yesterday', 'kecha', 'вчера'])
const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate())
}

function addDays(d: Date, days: number): Date {
  const out = new Date(d)
  out.setDate(out.getDate() + days)
  return out
}

/**
 * Resolves one date word -- `today`/`bugun`/`сегодня`, `tomorrow`, a weekday name in any of the three
 * locales, or a literal `YYYY-MM-DD` -- to a concrete calendar date (midnight, local time), relative
 * to `now`. A weekday name means "the next occurrence, counting today" (Linear's convention): asking
 * for `friday` on a Friday means today. Returns `null` for anything unrecognised -- callers decide
 * whether that is a no-match filter or a parse error.
 */
export function resolveDateWord(word: string, now: Date = new Date()): Date | null {
  const w = word.trim().toLowerCase()
  if (w.length === 0) return null

  const iso = ISO_DATE_RE.exec(w)
  if (iso) {
    const [, y, m, d] = iso
    return new Date(Number(y), Number(m) - 1, Number(d))
  }

  if (TODAY_WORDS.has(w)) return startOfDay(now)
  if (TOMORROW_WORDS.has(w)) return addDays(startOfDay(now), 1)
  if (YESTERDAY_WORDS.has(w)) return addDays(startOfDay(now), -1)

  for (const { dow, words } of WEEKDAY_WORDS) {
    if (words.includes(w)) {
      const todayDow = now.getDay()
      const offset = (dow - todayDow + 7) % 7
      return addDays(startOfDay(now), offset)
    }
  }

  return null
}

// --- Evaluating a parsed query against a card (client-side optimistic filtering + tests) ----------

export type FilterableCard = {
  id: string
  title: string
  description?: string | null
  status: CardFilterStatus
  assigneeUserId: string | null
  giverUserId: string | null
  dueAt: string | Date | null
  projectName?: string | null
  labelNames?: readonly string[]
  unitName?: string | null
  /** v1.1 SPEC §5: this card's custom-field values, keyed by `FieldDef.key`. Absent on a caller that
   * has not loaded them -- every `field:` clause then simply matches nothing, which is the
   * fail-closed direction for a filter. */
  fieldValues?: Readonly<Record<string, FieldValue>>
}

export type FilterContext = {
  now?: Date
  /** The signed-in user's id, for `assignee:@me` / `giver:@me`. */
  meUserId?: string | null
  /** Given a bare token (with or without a leading `@`), returns every user id it could plausibly
   * mean (login match, given-name match, family-name match, ...) -- the grammar itself has no
   * opinion on how a name resolves to an id. `@me` is handled before this is ever called. */
  resolveUserIds?: (token: string) => readonly string[]
}

function dueMatches(
  card: FilterableCard,
  clause: Extract<FilterClause, { kind: 'due' }>,
  now: Date,
): boolean {
  if (card.dueAt === null) return false
  const target = resolveDateWord(clause.word, now)
  if (!target) return false
  const due = new Date(card.dueAt)
  const startTarget = startOfDay(target).getTime()
  const endTarget = addDays(startOfDay(target), 1).getTime() - 1
  const dueTime = due.getTime()
  switch (clause.op) {
    case '<=':
      return dueTime <= endTarget
    case '>=':
      return dueTime >= startTarget
    case '<':
      return dueTime < startTarget
    case '>':
      return dueTime > endTarget
    case '=':
      return dueTime >= startTarget && dueTime <= endTarget
  }
}

function personMatches(candidateUserId: string | null, token: string, ctx: FilterContext): boolean {
  if (candidateUserId === null) return false
  if (token === '@me' || token === 'me') return candidateUserId === ctx.meUserId
  const ids = ctx.resolveUserIds?.(token) ?? []
  return ids.includes(candidateUserId)
}

/** Truthy words a checkbox answers to, in the four locales, so `field:onboarded:ha` works for a
 * person typing Uzbek and `field:onboarded:yes` for a person typing English. */
const TRUE_WORDS = new Set(['true', '1', 'ha', 'ҳа', 'да', 'yes', 'bor', 'бор'])
const FALSE_WORDS = new Set(['false', '0', "yo'q", 'yoʻq', 'йўқ', 'нет', 'no', 'yuq'])

function fieldMatches(
  value: FieldValue | undefined,
  clause: Extract<FilterClause, { kind: 'field' }>,
): boolean {
  const missing =
    value === undefined ||
    value === null ||
    (typeof value === 'string' && value.trim() === '') ||
    (Array.isArray(value) && value.length === 0)
  if (clause.empty) return missing
  if (missing) return false

  const needle = clause.value.trim().toLowerCase().replace(/[ʻʼ‘’]/g, "'")

  if (typeof value === 'boolean') {
    if (TRUE_WORDS.has(needle)) return value
    if (FALSE_WORDS.has(needle)) return !value
    return false
  }
  if (Array.isArray(value)) {
    return value.some((v) => String(v).toLowerCase().replace(/[ʻʼ‘’]/g, "'") === needle)
  }
  return String(value).toLowerCase().replace(/[ʻʼ‘’]/g, "'") === needle
}

/** Pure, synchronous evaluator -- no I/O, so it runs identically for an optimistic client-side update
 * and a unit test. AND semantics across every clause (including repeated free-text tokens), matching
 * how a filter bar accumulates tokens as someone types more of them. */
export function matchesFilterQuery(
  card: FilterableCard,
  query: FilterQuery,
  ctx: FilterContext = {},
): boolean {
  const now = ctx.now ?? new Date()
  return query.clauses.every((clause) => {
    switch (clause.kind) {
      case 'assignee':
        return personMatches(card.assigneeUserId, clause.token, ctx)
      case 'giver':
        return personMatches(card.giverUserId, clause.token, ctx)
      case 'status':
        return card.status === clause.value
      case 'due':
        return dueMatches(card, clause, now)
      case 'project':
        return (card.projectName ?? '').toLowerCase() === clause.name.toLowerCase()
      case 'label':
        return (card.labelNames ?? []).some((l) => l.toLowerCase() === clause.name.toLowerCase())
      case 'unit':
        return (card.unitName ?? '').toLowerCase() === clause.name.toLowerCase()
      case 'field':
        return fieldMatches(card.fieldValues?.[clause.key], clause)
      case 'text': {
        const needle = clause.value.toLowerCase()
        return (
          card.title.toLowerCase().includes(needle) ||
          (card.description ?? '').toLowerCase().includes(needle)
        )
      }
    }
  })
}

/** Convenience: parse + evaluate in one call, for call sites that never need the intermediate AST. */
export function cardMatchesFilterText(
  card: FilterableCard,
  filterText: string,
  ctx: FilterContext = {},
): boolean {
  return matchesFilterQuery(card, parseFilterQuery(filterText), ctx)
}
