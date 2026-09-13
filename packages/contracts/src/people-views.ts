// Saved views for the people table (v1.1 SPEC §4.3: "Saved views as a tab strip (private + shared,
// one department default set by the head; URL is the state)").
//
// The *shape of a view* lives here rather than in either app, because three readers must agree on it
// byte for byte: the table screen (which serialises it into the URL on every change), the API (which
// stores it as jsonb in `app.people_views` and must refuse a malformed one), and the CSV export
// (which reproduces exactly the columns, order, filters and sort the head is looking at). A view that
// round-trips through a URL, a database row and an export must be one type, validated once.
//
// Nothing here queries or decides permission -- `people.table.read` (head-only) already gated the
// screen; this is only the description of what is on it.
import { z } from 'zod'

/** DESIGN.md §2.4: `comfortable` (44 px rows) is the default, `compact` (36 px) the toggle. */
export const peopleViewDensitySchema = z.enum(['comfortable', 'compact'])
export type PeopleViewDensity = z.infer<typeof peopleViewDensitySchema>

/** SPEC §4.3: "group by bo'lim (default) or unit role". `none` is the flat list. */
export const peopleViewGroupBySchema = z.enum(['none', 'unit', 'unitRole'])
export type PeopleViewGroupBy = z.infer<typeof peopleViewGroupBySchema>

/**
 * One per-column filter. The operator set is deliberately small and typed by what the indicator
 * registry can produce: numbers get ranges, dates get before/after, text gets contains, enums get a
 * set, and every type gets "empty"/"filled" so a head can ask "who has not told us yet".
 */
export const peopleFilterOpSchema = z.enum([
  'gte',
  'lte',
  'eq',
  'contains',
  'in',
  'before',
  'after',
  'empty',
  'filled',
])
export type PeopleFilterOp = z.infer<typeof peopleFilterOpSchema>

export const peopleColumnFilterSchema = z.object({
  columnId: z.string().min(1).max(80),
  op: peopleFilterOpSchema,
  /** `null` for `empty`/`filled`, a number for ranges, a string for text/date, a set for `in`. */
  value: z.union([z.number(), z.string().max(200), z.array(z.string().max(120)).max(40), z.null()]),
})
export type PeopleColumnFilter = z.infer<typeof peopleColumnFilterSchema>

export const peopleViewSortSchema = z.object({
  columnId: z.string().min(1).max(80),
  desc: z.boolean(),
})
export type PeopleViewSort = z.infer<typeof peopleViewSortSchema>

/** Caps, with the reason the UI states out loud: a table wider than this stops being readable and
 * starts being a spreadsheet nobody scrolls (SPEC §4.3, CLICKUP-RESEARCH A2). */
export const PEOPLE_VIEW_CAPS = Object.freeze({
  maxViewsPerHead: 30,
  maxColumns: 20,
  maxFilters: 10,
  nameMaxLength: 60,
})

export const peopleViewConfigSchema = z.object({
  /** Indicator ids and custom-field keys (`field:<key>`), in display order. `name` is implicit and
   * always first -- it is the row's identity, never a column you can switch off. */
  columns: z.array(z.string().min(1).max(80)).max(PEOPLE_VIEW_CAPS.maxColumns),
  /** Pixel widths keyed by column id; a column absent here uses its natural width. */
  widths: z.record(z.string().max(80), z.number().int().min(64).max(640)),
  sort: peopleViewSortSchema.nullable(),
  filters: z.array(peopleColumnFilterSchema).max(PEOPLE_VIEW_CAPS.maxFilters),
  groupBy: peopleViewGroupBySchema,
  density: peopleViewDensitySchema,
  /** Free-text search over name/title/bo'lim. Part of the view because "my bo'lim, overdue first" is
   * one saved thought, not a filter plus a thing you retype. */
  search: z.string().max(200),
})
export type PeopleViewConfig = z.infer<typeof peopleViewConfigSchema>

/** SPEC §4.3's four default columns, minus the always-on name column. */
export const DEFAULT_PEOPLE_COLUMNS: readonly string[] = Object.freeze([
  'unit',
  'openCards',
  'workloadPct',
])

export const DEFAULT_PEOPLE_VIEW_CONFIG: PeopleViewConfig = Object.freeze({
  columns: [...DEFAULT_PEOPLE_COLUMNS],
  widths: {},
  sort: null,
  filters: [],
  groupBy: 'unit',
  density: 'comfortable',
  search: '',
})

/**
 * Parse anything (a URL parameter, a stored jsonb row, a message from an older client) into a view
 * config, never throwing: an unreadable view falls back to the default rather than showing the head
 * an error where a table should be. Unknown keys are dropped, over-long lists are truncated.
 */
export function normalizePeopleViewConfig(raw: unknown): PeopleViewConfig {
  const parsed = peopleViewConfigSchema.partial().safeParse(raw)
  const value = parsed.success ? parsed.data : {}
  const columns = [...new Set(value.columns ?? DEFAULT_PEOPLE_COLUMNS)].slice(
    0,
    PEOPLE_VIEW_CAPS.maxColumns,
  )
  return {
    columns: columns.length > 0 ? columns : [...DEFAULT_PEOPLE_COLUMNS],
    widths: value.widths ?? {},
    sort: value.sort ?? null,
    filters: (value.filters ?? []).slice(0, PEOPLE_VIEW_CAPS.maxFilters),
    groupBy: value.groupBy ?? 'unit',
    density: value.density ?? 'comfortable',
    search: value.search ?? '',
  }
}

/** True when the two configs describe the same table -- what the "Saqlash" prompt asks before it
 * offers to overwrite a saved view (SPEC §4.3). Order matters for columns; it is the display order. */
export function samePeopleViewConfig(a: PeopleViewConfig, b: PeopleViewConfig): boolean {
  return (
    JSON.stringify(normalizePeopleViewConfig(a)) === JSON.stringify(normalizePeopleViewConfig(b))
  )
}

/** The URL *is* the state (DESIGN.md §8 "Filters"): this is the single search param the table writes
 * and reads back. Base64 would be unreadable in a shared link; compact JSON stays legible. */
export const PEOPLE_VIEW_URL_PARAM = 'view'

export function encodePeopleViewConfig(config: PeopleViewConfig): string {
  return JSON.stringify(config)
}

export function decodePeopleViewConfig(raw: string | null): PeopleViewConfig | null {
  if (!raw) return null
  try {
    return normalizePeopleViewConfig(JSON.parse(raw))
  } catch {
    return null
  }
}

/** A stored view as it crosses the wire. `isDepartmentDefault` is the one view a head has declared
 * the department's starting point; `shared` makes a private view visible to the other heads of the
 * same department (SPEC §2.2 keeps the whole table head-only, so "shared" never means "to members"). */
export const peopleViewSchema = z.object({
  id: z.string(),
  name: z.string(),
  config: peopleViewConfigSchema,
  shared: z.boolean(),
  isDepartmentDefault: z.boolean(),
  ownerUserId: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  version: z.number().int(),
})
export type PeopleView = z.infer<typeof peopleViewSchema>
