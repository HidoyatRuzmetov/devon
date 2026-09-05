// Backs `test/unit/migration-lint.test.ts` and `migrate:verify` (design §2.7 step 7). Pure text
// scanning, no database needed -- this is what "migration-lint.mjs" is in this item: a checked-in,
// testable function rather than a loose script, kept under `test/**` per the item's touches list.
import type { MigrationFile } from '../harness.js'
import type { CheckResult } from './types.js'

const FORBIDDEN_PERSONAL_DATA =
  /\b(birth\w*|dob|passport\w*|pinfl\w*|address\w*|salary\w*|nationality|religio\w*)\b/i
// "inn" (taxpayer id) is short enough that a naive substring match hits ordinary English words
// ("inner", "running", "beginning"); require it as a whole word, matching the design's intent
// (a personal-data column literally named `inn`) without flagging unrelated SQL keywords.
const FORBIDDEN_INN = /\binn\b/i

const DESTRUCTIVE_PATTERNS: ReadonlyArray<readonly [string, RegExp]> = [
  ['DROP TABLE', /\bdrop\s+table\b/i],
  ['DROP COLUMN', /\bdrop\s+column\b/i],
  ['ALTER COLUMN ... TYPE', /\balter\s+column\s+\S+\s+type\b/i],
  // Require an actual statement target (a qualified name or the `table` keyword) so trigger clauses
  // like `before truncate on audit.events` and privilege lists like `revoke ..., truncate, ...` do not
  // false-positive.
  ['TRUNCATE', /\btruncate\s+(table\s+)?[a-z_]+\.[a-z_]+/i],
  ['DELETE FROM', /\bdelete\s+from\s+[a-z_.]+/i],
]

const CONTRACT_HEADER = /--\s*CONTRACT:\s*safe because/i

// Scoped to the `app.*` GUC namespace (design §1.8, H3.3): `SET ROLE` / `RESET ROLE` are ordinary,
// intentional role-switching inside a migration script and are not the tenancy-leak risk this guards.
const BARE_SET_APP_GUC = /\bset\s+(?!local\b|role\b)app\./i

// Privilege lists and qualified-table lists are just words joined by commas/dots/spaces -- restricting
// the character classes (instead of `[\s\S]*?`) keeps a single match from crossing a statement
// boundary into an unrelated `grant ... on schema audit ...` or a later `grant` entirely, which a
// permissive `[\s\S]*?` did in practice (found while writing this file's own test).
const AUDIT_GRANT = /grant\s+([a-z, ]+?)\s+on\s+(audit\.[a-z_., ]+?)\s+to\s+/gi

/** Every check below is about executable SQL, not the prose that explains it -- and one of these
 * migrations documents the forbidden personal-data pattern in its own header comment (see
 * `0003_identity.sql`'s "no column here matches birth/dob/..." line), which would otherwise trip the
 * very check it describes. Strip `-- ...` line comments before scanning; none of these migrations put
 * `--` inside a string literal, so this is lossless for the statements that actually run. */
function stripLineComments(sql: string): string {
  return sql
    .split('\n')
    .map((line) => {
      const idx = line.indexOf('--')
      return idx === -1 ? line : line.slice(0, idx)
    })
    .join('\n')
}

export function lintMigrations(files: readonly MigrationFile[]): CheckResult[] {
  const results: CheckResult[] = []

  for (const file of files) {
    const isContractFile = file.name.includes('_contract')
    const code = stripLineComments(file.sql)

    for (const [label, pattern] of DESTRUCTIVE_PATTERNS) {
      const matched = pattern.test(code)
      // The CONTRACT header itself lives in a comment, so it is read from the original text -- only
      // the destructive statement it excuses is checked against the comment-stripped code.
      const ok = !matched || (isContractFile && CONTRACT_HEADER.test(file.sql))
      let detail: string | undefined
      if (matched && !isContractFile) detail = 'found outside a *_contract.sql file'
      results.push({
        name: `${file.name}: no ${label} outside a *_contract.sql file with a CONTRACT header`,
        ok,
        detail,
      })
    }

    const forbidden = FORBIDDEN_PERSONAL_DATA.test(code) || FORBIDDEN_INN.test(code)
    results.push({
      name: `${file.name}: no forbidden personal-data column names (I-2)`,
      ok: !forbidden,
    })

    results.push({
      name: `${file.name}: no bare SET on the app.* GUC namespace outside set_config(..., true)`,
      ok: !BARE_SET_APP_GUC.test(code),
    })

    let match: RegExpExecArray | null
    AUDIT_GRANT.lastIndex = 0
    let auditGrantOk = true
    let auditGrantDetail: string | undefined
    while ((match = AUDIT_GRANT.exec(code))) {
      const privileges = match[1]!
        .split(',')
        .map((p) => p.trim().toUpperCase())
        .filter(Boolean)
      const allowed = privileges.every((p) => p === 'INSERT' || p === 'SELECT')
      if (!allowed) {
        auditGrantOk = false
        auditGrantDetail = `granted [${privileges.join(', ')}] on ${match[2]}`
        break
      }
    }
    results.push({
      name: `${file.name}: any grant on an audit.* table is INSERT/SELECT only (I-5a)`,
      ok: auditGrantOk,
      detail: auditGrantDetail,
    })
  }

  return results
}
