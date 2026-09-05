import type { CheckResult } from './types.js'

/** Every check that failed, formatted as one readable diagnostic. Throwing (rather than looping
 * `expect()`) keeps the many assertions produced by a single live-database pass in one failing test
 * with a full report, instead of stopping at the first `expect()` and hiding the rest. */
export function expectAllOk(results: CheckResult[]): void {
  const failed = results.filter((r) => !r.ok)
  if (failed.length > 0) {
    const message = failed
      .map((f) => `  - ${f.name}${f.detail ? ` :: ${f.detail}` : ''}`)
      .join('\n')
    throw new Error(`${failed.length}/${results.length} check(s) failed:\n${message}`)
  }
}

export function find(results: CheckResult[], namePart: string): CheckResult {
  const found = results.find((r) => r.name.includes(namePart))
  if (!found)
    throw new Error(`no check result matching "${namePart}" (${results.length} results total)`)
  return found
}

export function printReport(label: string, results: CheckResult[]): void {
  console.log(`\n[${label}] ${results.length} checks:`)
  for (const r of results) {
    console.log(`  ${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? ` (${r.detail})` : ''}`)
  }
}
