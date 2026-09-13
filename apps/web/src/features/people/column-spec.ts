// v1.1 critique SEV2 #7 -- custom fields become first-class people-table columns.
//
// The report: "the picker lists all 18 registry indicators in six labelled groups with descriptions
// and NOT ONE custom field -- so Taʼlim, Chet tillari and Sertifikatlar render as columns that
// cannot be hidden, reordered, sorted, filtered or resized, while Boʻlim / Ochiq vazifalar /
// Yuklama each have sort + filter + a resize handle. The footer calculates 27 / 187 / 26% for the
// indicators and nothing for the custom fields, so the fill progress the head actually manages
// (6/27 on Taʼlim) exists on /fields but not in the table."
//
// The cause was structural: every one of those affordances is driven by an `IndicatorSpec`, and a
// custom field is not one -- its id is not an `IndicatorKey` and, more awkwardly, its **label is not
// an i18n key**. It is a sentence a boshqarma boshligʻi typed, possibly in one locale only.
//
// So this file widens the column type by exactly those two facts and nothing else:
//
//   * `id` is a plain string (`field:<key>` for a custom field, so a column id can never collide
//     with a registry indicator's, and a saved view that carries one is readable at a glance);
//   * `labelText` / `descriptionText` carry a literal string for a column whose name was typed
//     rather than translated. `columnLabel()` is the one place that decides between the two, so no
//     component ever has to know which kind it is holding.
//
// Everything else -- type, format, calculations, polarity -- is the same vocabulary the registry
// already speaks, which is what lets the sort comparator, the filter grammar, the resize handle and
// the footer calculation work on a custom field without knowing it is one.
import type {
  IndicatorFormat,
  IndicatorSource,
  IndicatorSpec,
  IndicatorType,
} from '@devon/contracts'
import type { FieldDefDto } from '../fields/api.js'
import { fieldDescription, fieldLabel } from '../fields/format.js'
import type { Locale } from '@devon/i18n'

/** The extra group the picker shows for a department's own columns. */
export const FIELD_COLUMN_SOURCE = 'field' as const

export type TableColumnSource = IndicatorSource | typeof FIELD_COLUMN_SOURCE

export type TableColumnSpec = Omit<IndicatorSpec, 'id' | 'source'> & {
  readonly id: string
  readonly source: TableColumnSource
  /** Set only for a custom field: the head's own typed label, which is not an i18n key. */
  readonly labelText?: string
  readonly descriptionText?: string
  /** The definition behind a custom-field column, for "ask to fill" on its header menu. */
  readonly fieldDefId?: string
}

/** The id a custom field takes as a table column. Prefixed so it can never be mistaken for -- or
 * collide with -- a registry indicator id, including in a saved view's URL. */
export function fieldColumnId(key: string): string {
  return `field:${key}`
}

export function isFieldColumn(spec: { source: TableColumnSource }): boolean {
  return spec.source === FIELD_COLUMN_SOURCE
}

/** The label to print. A registry indicator translates; a custom field shows what the head typed. */
export function columnLabel(
  spec: TableColumnSpec,
  t: (key: string, vars?: Record<string, string | number>) => string,
): string {
  return spec.labelText ?? t(spec.labelKey)
}

export function columnDescription(
  spec: TableColumnSpec,
  t: (key: string, vars?: Record<string, string | number>) => string,
): string {
  if (spec.descriptionText !== undefined) return spec.descriptionText
  return spec.descriptionKey ? t(spec.descriptionKey) : ''
}

/**
 * A custom field's own `type`/`format`, in the registry's vocabulary.
 *
 * The mapping is what makes the rest work without a single special case: a `number` field sorts
 * numerically and offers ">= / <=", a `date` field offers "before / after", a `multi_select` renders
 * as chips, and every one of them offers "boʻsh / toʻldirilgan" -- which is the question a custom
 * field column exists to answer.
 */
function typeOf(def: FieldDefDto): { type: IndicatorType; format: IndicatorFormat } {
  switch (def.type) {
    case 'number':
      return { type: 'count', format: 'number' }
    case 'date':
      return { type: 'date', format: 'date' }
    case 'checkbox':
      return { type: 'enum', format: 'boolean' }
    case 'select':
      return { type: 'enum', format: 'text' }
    case 'multi_select':
      return { type: 'list', format: 'chips' }
    default:
      return { type: 'text', format: 'text' }
  }
}

/**
 * SEV2 #7's footer: "a filled-count footer calculation for field columns".
 *
 * `filled` first, so the default figure a head sees under Taʼlim is "6 / 27" -- the fill progress
 * they are actually managing, which until now existed only on `/fields`. A numeric field also
 * offers an average, because a number column that cannot be averaged is a column somebody will ask
 * about.
 */
function calculationsFor(def: FieldDefDto): IndicatorSpec['calculations'] {
  return def.type === 'number' ? ['filled', 'avg', 'sum', 'max'] : ['filled']
}

export function fieldColumnSpec(def: FieldDefDto, locale: Locale | string): TableColumnSpec {
  const { type, format } = typeOf(def)
  const description = fieldDescription(def, locale)
  return {
    id: fieldColumnId(def.key),
    labelKey: '',
    labelText: fieldLabel(def, locale),
    descriptionKey: '',
    ...(description ? { descriptionText: description } : {}),
    type,
    format,
    // A person field's answers are management data (PERMISSIONS-AUDIT §4.13) -- the same gate the
    // table itself carries.
    headOnly: true,
    source: FIELD_COLUMN_SOURCE,
    calculations: calculationsFor(def),
    polarity: null,
    fieldDefId: def.id,
  }
}

/** Registry indicators, widened to the table's own column type. Pure re-typing -- no runtime cost
 * and no copy of the registry. */
export function indicatorColumnSpec(spec: IndicatorSpec): TableColumnSpec {
  return spec as TableColumnSpec
}
