// The people table's own logic, kept out of the screen so it can be reasoned about (and tested)
// without a DOM: what a filter means, what a footer calculation computes, and how a value sorts.
//
// SPEC §4.3 asks for "per-column sort and filter (numeric ranges, enum sets, date ranges, text)" and
// "a footer row with per-column calculations (count, filled, average, sum, min, max as the type
// allows)". The registry decides which of those a column offers (`IndicatorSpec.calculations`), so a
// percent column never offers a sum and a date column never offers an average.
import type { IndicatorSpec, PeopleColumnFilter } from '@devon/contracts'
import { normalizeForSearch } from '@devon/ui'

export type CellValue = number | string | boolean | readonly string[] | null

/** Sorting key: numbers sort as numbers, dates as time, booleans as 0/1, text with the Uzbek/Cyrillic
 * fold every search in this product uses, and a missing value always sorts last regardless of
 * direction -- an empty cell is not "the smallest", it is "not yet answered". */
export function sortValue(spec: IndicatorSpec, value: CellValue): number | string | null {
  if (value === null || value === undefined || value === '') return null
  switch (spec.type) {
    case 'count':
    case 'percent':
    case 'duration':
      return Number(value)
    case 'date':
      return new Date(String(value)).getTime()
    case 'enum':
      return value === true ? 1 : value === false ? 0 : normalizeForSearch(String(value))
    default:
      return normalizeForSearch(Array.isArray(value) ? value.join(' ') : String(value))
  }
}

export function compareCells(
  spec: IndicatorSpec,
  a: CellValue,
  b: CellValue,
  desc: boolean,
): number {
  const left = sortValue(spec, a)
  const right = sortValue(spec, b)
  if (left === null && right === null) return 0
  if (left === null) return 1 // missing values always last
  if (right === null) return -1
  const sign = desc ? -1 : 1
  if (typeof left === 'number' && typeof right === 'number') return (left - right) * sign
  return String(left).localeCompare(String(right)) * sign
}

function isEmpty(value: CellValue): boolean {
  if (value === null || value === undefined || value === '') return true
  if (Array.isArray(value)) return value.length === 0
  return false
}

/** One filter clause against one cell. Unknown operators pass the row through rather than hiding it:
 * a filter nobody can read must never silently empty a head's table. */
export function matchesFilter(
  spec: IndicatorSpec,
  value: CellValue,
  filter: PeopleColumnFilter,
): boolean {
  switch (filter.op) {
    case 'empty':
      return isEmpty(value)
    case 'filled':
      return !isEmpty(value)
    case 'gte':
      return !isEmpty(value) && Number(value) >= Number(filter.value)
    case 'lte':
      return !isEmpty(value) && Number(value) <= Number(filter.value)
    case 'before':
      return (
        !isEmpty(value) &&
        new Date(String(value)).getTime() < new Date(String(filter.value)).getTime()
      )
    case 'after':
      return (
        !isEmpty(value) &&
        new Date(String(value)).getTime() > new Date(String(filter.value)).getTime()
      )
    case 'eq': {
      if (isEmpty(value)) return false
      if (spec.type === 'count' || spec.type === 'percent' || spec.type === 'duration') {
        return Number(value) === Number(filter.value)
      }
      return normalizeForSearch(String(value)) === normalizeForSearch(String(filter.value))
    }
    case 'in': {
      const set = Array.isArray(filter.value) ? filter.value.map(normalizeForSearch) : []
      return !isEmpty(value) && set.includes(normalizeForSearch(String(value)))
    }
    case 'contains':
    default:
      return (
        !isEmpty(value) &&
        normalizeForSearch(Array.isArray(value) ? value.join(' ') : String(value)).includes(
          normalizeForSearch(String(filter.value ?? '')),
        )
      )
  }
}

export type Calculation = 'count' | 'filled' | 'avg' | 'sum' | 'min' | 'max'

export type CalculationResult = { kind: Calculation; value: number | null }

/** The footer figure for one column. `null` means "nothing to compute here", which renders as the
 * one em dash this product uses for a missing value, never as a 0 that looks like a measurement. */
export function calculate(
  spec: IndicatorSpec,
  kind: Calculation,
  values: readonly CellValue[],
): CalculationResult {
  const present = values.filter((v) => !isEmpty(v))
  if (kind === 'count') return { kind, value: values.length }
  if (kind === 'filled') return { kind, value: present.length }
  const numbers = present
    .map((v) => (spec.type === 'date' ? new Date(String(v)).getTime() : Number(v)))
    .filter((n) => Number.isFinite(n))
  if (numbers.length === 0) return { kind, value: null }
  switch (kind) {
    case 'sum':
      return { kind, value: numbers.reduce((a, b) => a + b, 0) }
    case 'avg':
      return { kind, value: Math.round(numbers.reduce((a, b) => a + b, 0) / numbers.length) }
    case 'min':
      return { kind, value: Math.min(...numbers) }
    case 'max':
      return { kind, value: Math.max(...numbers) }
    default:
      return { kind, value: null }
  }
}

/** The calculation a column shows by default: the first one the registry allows, which is the most
 * meaningful one for that indicator (a count sums, a percent averages, a date takes its range). */
export function defaultCalculation(spec: IndicatorSpec): Calculation | null {
  return (spec.calculations[0] as Calculation | undefined) ?? null
}
