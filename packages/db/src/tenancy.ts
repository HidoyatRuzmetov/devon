// The tenancy registry (ADR-002). Every base table in schemas `app` and `audit` must appear here, or
// `test/tenancy.registry.test.ts` -- run as part of `migrate:verify`, which is the `migrate` gate --
// fails the build. This is the mechanism, not a suggestion: adding a table without classifying it is
// a build failure, not a review comment.
export type TableClass = 'tenant_root' | 'department_owned' | 'user_owned' | 'global' | 'audit'

/** `schema.table` -> class. Keys are the fully-qualified Postgres name, lower-case. */
export const TENANCY: Readonly<Record<string, TableClass>> = Object.freeze({
  'app.departments': 'tenant_root',
  'app.memberships': 'department_owned',
  'app.users': 'global',
  'app.sessions': 'global',
  'app.setup_tokens': 'global',
  'app.instance_settings': 'global',
  'app.seed_runs': 'global',
  'app.idempotency_keys': 'global',
  'app.outbox_events': 'global',
  'app._migrations': 'global',
  'app.cards': 'department_owned',
  'app.card_checklist_items': 'department_owned',
  'app.card_comments': 'department_owned',
  'app.card_activity': 'department_owned',
  'app.attachments': 'department_owned',
  'app.labels': 'department_owned',
  'app.saved_views': 'department_owned',
  'app.projects': 'department_owned',
  'audit.events': 'audit',
  'audit.private_reads': 'audit',
  'audit.anchors': 'audit',
})

/**
 * A table classified `global` carries no `department_id` and is therefore invisible to RLS's
 * department scoping. That is sometimes correct (identity, sessions, singleton settings) and
 * sometimes a mistake waiting to happen -- so every entry needs a one-line reason, checked in and
 * reviewable, per ADR-002. `test/tenancy.registry.test.ts` fails if a `global` table has no entry here.
 */
export const GLOBAL_ALLOWLIST: Readonly<Record<string, string>> = Object.freeze({
  'app.users':
    'Identity is instance-wide; department scoping happens through app.memberships (I-1).',
  'app.sessions':
    'A session belongs to a user, not a department; department context is per-request.',
  'app.setup_tokens': 'Bootstrap-only: exists before any department does (AC-12).',
  'app.instance_settings': 'Singleton instance configuration, not tenant data.',
  'app.seed_runs': 'Delivery bookkeeping for the demo seed, not tenant data.',
  'app.idempotency_keys': 'Request replay-protection keyed by (key, route), not tenant data.',
  'app.outbox_events':
    'Instance-wide event bus plumbing for background workers (mirrors audit.events), not tenant data; a department-scoped event still carries its department_id as a plain column for a subscriber to filter on.',
  'app._migrations':
    'Migration-runner bookkeeping (which .sql files have applied), not tenant data.',
})

export type TenancyCoverageResult = {
  ok: boolean
  /** Tables present in the database but missing from `TENANCY`. Non-empty here fails the gate. */
  unclassified: string[]
  /** Tables in `TENANCY` classified `global` but missing a `GLOBAL_ALLOWLIST` justification. */
  unjustifiedGlobals: string[]
}

/**
 * Pure function so it can be unit-tested without a database: given the qualified names of every base
 * table actually present in `app`/`audit` (as introspected by the caller), report whether the registry
 * covers all of them and whether every `global` entry is justified.
 */
export function checkTenancyCoverage(
  qualifiedTableNames: readonly string[],
): TenancyCoverageResult {
  const unclassified = qualifiedTableNames.filter((name) => !(name in TENANCY))
  const unjustifiedGlobals = Object.entries(TENANCY)
    .filter(([, cls]) => cls === 'global')
    .map(([name]) => name)
    .filter((name) => !GLOBAL_ALLOWLIST[name] || GLOBAL_ALLOWLIST[name].trim().length === 0)
  return {
    ok: unclassified.length === 0 && unjustifiedGlobals.length === 0,
    unclassified,
    unjustifiedGlobals,
  }
}
