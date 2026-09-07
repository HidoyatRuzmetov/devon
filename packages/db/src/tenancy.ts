// The tenancy registry (ADR-002). Every base table in schemas `app` and `audit` must appear here, or
// `test/tenancy.registry.test.ts` -- run as part of `migrate:verify`, which is the `migrate` gate --
// fails the build. This is the mechanism, not a suggestion: adding a table without classifying it is
// a build failure, not a review comment.
export type TableClass = 'tenant_root' | 'department_owned' | 'user_owned' | 'global' | 'audit'

/** `schema.table` -> class. Keys are the fully-qualified Postgres name, lower-case. */
export const TENANCY: Readonly<Record<string, TableClass>> = Object.freeze({
  'app.departments': 'tenant_root',
  'app.memberships': 'department_owned',
  'app.units': 'department_owned',
  'app.unit_roles': 'department_owned',
  'app.users': 'global',
  'app.sessions': 'global',
  'app.setup_tokens': 'global',
  'app.instance_settings': 'global',
  'app.seed_runs': 'global',
  'app.idempotency_keys': 'global',
  'app.outbox_events': 'global',
  'app._migrations': 'global',
  'app.department_requests': 'global',
  'app.user_security': 'global',
  'app.login_challenges': 'global',
  'app.join_attempts': 'global',
  'app.account_deletion_requests': 'global',
  'app.uploads': 'global',
  'app.cards': 'department_owned',
  'app.card_checklist_items': 'department_owned',
  'app.card_comments': 'department_owned',
  'app.card_activity': 'department_owned',
  'app.attachments': 'department_owned',
  'app.labels': 'department_owned',
  'app.saved_views': 'department_owned',
  'app.projects': 'department_owned',
  'app.personal_sprints': 'user_owned',
  'app.personal_tasks': 'user_owned',
  'app.personal_notes': 'user_owned',
  'app.personal_canvases': 'user_owned',
  'app.pomodoro_settings': 'user_owned',
  'app.pomodoro_sessions': 'user_owned',
  'app.notifications': 'user_owned',
  'app.notification_prefs': 'user_owned',
  'app.notification_quiet_hours': 'user_owned',
  'app.notification_deliveries': 'user_owned',
  'app.notification_department_settings': 'department_owned',
  'app.telegram_link_codes': 'global',
  'app.telegram_links': 'global',
  'app.telegram_group_connect_codes': 'global',
  'app.telegram_groups': 'global',
  'audit.events': 'audit',
  'audit.private_reads': 'audit',
  'audit.anchors': 'audit',

  // EPIC-008 events (MODULE-GUIDE.md "DB: schema").
  'app.events': 'department_owned',
  'app.event_rsvps': 'department_owned',
  'app.event_comments': 'department_owned',
  'app.carpools': 'department_owned',
  'app.carpool_seats': 'department_owned',
  'app.event_items': 'department_owned',
  'app.polls': 'department_owned',
  'app.poll_options': 'department_owned',
  'app.poll_votes': 'department_owned',
  'app.event_photos': 'department_owned',
  'app.event_feedback': 'department_owned',
  'app.event_reminder_jobs': 'global',

  // EPIC-013 admin console (MODULE-GUIDE.md "DB: schema").
  'app.wipe_requests': 'global',
  'app.sentinel_keys': 'global',
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
  'app.event_reminder_jobs':
    'EPIC-008: the reminder worker polls this queue across every department at once, exactly like app.outbox_events; department_id is a plain column for filtering/audit, not a row-visibility boundary.',
  'app._migrations':
    'Migration-runner bookkeeping (which .sql files have applied), not tenant data.',
  'app.uploads':
    'EPIC-001 storage plugin: presigned-upload bookkeeping (random object keys, sizes, scan states -- never file content or a user filename). The API scopes every read/write to the owner via own_account; the hourly retention sweep must see the expired rows of every user at once, exactly like app.event_reminder_jobs.',
  'app.department_requests':
    'A request exists before any department does, so it cannot carry a department_id yet; visibility is code-level (own_account for the requester, instance for the super admin approval queue), same reasoning as app.setup_tokens (EPIC-002).',
  'app.user_security':
    '2FA/Telegram-link metadata belongs to a user, not a department, exactly like app.sessions (EPIC-001).',
  'app.login_challenges':
    'A short-lived login-in-progress row keyed by user, not a department (EPIC-001).',
  'app.join_attempts':
    'Join-by-key rate-limiting/audit keyed by (key, ip); a wrong-key attempt has no department to scope to (EPIC-002).',
  'app.account_deletion_requests':
    'Self-service account deletion is identity-scoped, not tenant data (EPIC-001).',
  'app.telegram_link_codes':
    'Bootstrap-only: a one-time linking code exists before any Telegram chat is associated with a ' +
    "user, exactly like app.setup_tokens (AC-12's pattern reused for /start <code>).",
  'app.telegram_links':
    'A Telegram webhook update carries only a chat id; the (chat_id -> user_id) mapping must be ' +
    'resolvable before any per-request user/department context exists, the same bootstrap shape as ' +
    'app.sessions ("looked up by token before you know who is asking"). Per-user visibility is ' +
    'enforced at the application layer (can()), never by RLS, exactly like app.sessions already is.',
  'app.telegram_groups':
    'A department Telegram group is likewise resolved by chat id from an inbound webhook update, ' +
    'before any department context exists -- same bootstrap shape as app.telegram_links above. ' +
    'Per-department visibility is enforced by can() with a department_child subject on every route ' +
    'that reads or writes this table from an authenticated session.',
  'app.telegram_group_connect_codes':
    'Bootstrap-only, mirrors app.telegram_link_codes: a group `/connect <code>` is consumed by an ' +
    'inbound webhook update before any department context exists for that request.',
  'app.wipe_requests':
    'EPIC-013: the wipe switch is instance-wide by definition (it removes the whole deployment, not ' +
    'one department) -- reachable only behind {kind:"instance"} (super_admin-only, I-8b), same ' +
    'bootstrap-shaped reasoning as app.setup_tokens.',
  'app.sentinel_keys':
    'EPIC-013: the sentinel ed25519 keypair signs a host-level command that also removes the whole ' +
    'deployment, not one department -- reachable only behind {kind:"instance"}, same reasoning as ' +
    'app.wipe_requests immediately above.',
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
