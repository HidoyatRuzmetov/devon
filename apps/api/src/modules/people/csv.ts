// CSV for the people table's export (v1.1 SPEC §4.3).
//
// Two things this file exists to get right, because both have burned real products:
//  * **Formula injection.** A cell beginning `=`, `+`, `-`, `@`, a tab or a CR is prefixed with a
//    single quote before quoting, so opening the file in Excel or LibreOffice cannot execute it. A
//    person's own job title is user-supplied text; an export is not a place to trust it.
//  * **Uzbek in Excel.** The file is emitted with a UTF-8 BOM. Without it, Excel on Windows reads the
//    bytes as the system code page and every `oʻ`/`gʻ` in a name arrives as mojibake -- which, for a
//    government department's staff list, is not a cosmetic problem.
//
// The header row carries indicator *ids*, not localised labels: a CSV is usually re-imported or
// scripted against, and a column called `overdueCards` survives a locale change while "Kechikkan"
// does not. The screen's own column header shows the translated label; this is the machine-readable
// twin of that table.
import type { IndicatorKey, PersonIndicators } from '@devon/contracts'
import type { PersonName } from './service.js'

const NEEDS_ESCAPE = /^[=+\-@\t\r]/

function cell(value: unknown): string {
  if (value === null || value === undefined) return ''
  const raw = Array.isArray(value) ? value.join('; ') : String(value)
  const guarded = NEEDS_ESCAPE.test(raw) ? `'${raw}` : raw
  return `"${guarded.replaceAll('"', '""')}"`
}

/** Formal name order for an official export: "Familiya Ism Otasining ismi" (DESIGN.md §5). */
function formalName(person: PersonName): string {
  return [person.familyName, person.givenName, person.patronymic].filter(Boolean).join(' ')
}

export function peopleCsv(
  people: readonly PersonName[],
  indicators: readonly PersonIndicators[],
  keys: readonly IndicatorKey[],
): string {
  const byUser = new Map(indicators.map((row) => [row.userId, row.values]))
  const header = ['userId', 'name', 'title', 'unit', ...keys].map(cell).join(',')
  const rows = people.map((person) => {
    const values = byUser.get(person.userId) ?? {}
    return [
      cell(person.userId),
      cell(formalName(person)),
      cell(person.title),
      cell(person.unit),
      ...keys.map((key) => cell(values[key] ?? null)),
    ].join(',')
  })
  // CRLF: the line ending every spreadsheet on every platform reads without a setting.
  return `\uFEFF${[header, ...rows].join('\r\n')}\r\n`
}
