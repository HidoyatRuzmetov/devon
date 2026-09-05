# WorkPortal Invariants

Truths that must hold in every commit. A breach is SEV1 regardless of how it got there. Reviewers check
these explicitly; `wp-security` tries to break them. Agents may not edit this file (hook-protected);
additions are made by the human or via an ADR merged by `wp-release`.

## Tenancy and data
- I-1 Every row of tenant-owned data carries `tenant_id`, and every query is scoped by it, either through
  Postgres row-level security with `SET LOCAL app.tenant_id` or through the repository layer. No raw
  query bypasses it.
- I-2 The system stores no HR-grade personal data (no birth dates, IDs, addresses, documents). The
  only private block is `people_private` (personal phone, emergency contact): never returned by list
  endpoints, readable by self, the unit head and the workspace admin only, every read logged.
- I-3 Deleting is soft by default. Hard deletes exist only in explicit retention jobs with an audit
  record. The audit log itself is never subject to retention.
- I-4 IDs are stable, opaque, and never re-used. External systems get the same ID forever.
- I-5 Every write to a domain object appends an event to the audit log in the same transaction.
- I-5a The audit log (`audit.events`) is immutable: the application database role holds INSERT and
  SELECT only; UPDATE, DELETE and TRUNCATE are revoked and additionally blocked by a trigger; rows are
  hash-chained and the chain head is anchored nightly outside the database. No code path, role or
  migration may weaken this; a migration that touches the `audit` schema's grants is SEV1.
- I-5b Every action by an instance role (`super_admin`, `ministry_viewer`) is audited with the role
  recorded; super admin power is unlimited but never silent.

## Permissions
- I-6 Authorisation happens on the server. The client only hides what it cannot use.
- I-7 The permission check is centralised (`can(actor, action, object)`); no endpoint hand-rolls it.
- I-8 A deputy acting for someone is recorded as `acting_for`; the audit log shows both identities.
- I-8a Workspaces are private by default; nothing crosses a workspace boundary unless the workspace's
  own admin switched visibility to `ministry`, a share exists, or the reader holds an instance role.
  Only a `super_admin` can create or archive a workspace; the ministry view is read-only.

## Product
- I-9 Every user-facing string goes through i18n with `uz` (Latin) as the default, `ru` and `en`
  complete. No hard-coded strings in `apps/web`.
- I-10 Every screen has designed empty, loading, error and no-permission states.
- I-11 Destructive actions offer undo (toast with undo) instead of a confirmation dialog, unless
  irreversible by law/policy.
- I-12 Every primary flow is completable with keyboard only and passes axe with zero serious/critical.
- I-13 The command palette (`Ctrl/⌘+K`) can reach every navigable object and every primary action.
- I-14 Notifications are events, filtered by user preferences, delivered by channel adapters; no
  feature sends Telegram/email directly.

## Engineering
- I-15 Migrations are additive first, destructive later, idempotent, and never edited after being
  applied. Expand → migrate → contract.
- I-16 Tests assert behaviour, not implementation. A test that cannot fail is a defect.
- I-17 No secrets in the repo. Config comes from env with a documented `.env.example`.
- I-18 The app boots from a fresh clone with one command (`pnpm dev` after `pnpm setup`) and shows the
  demo tenant with realistic Uzbek data.
- I-19 Public API responses are versioned and documented (OpenAPI); breaking changes require a new
  version and an ADR.
- I-20 Production build stays under the bundle budget in `agentic/gates.json`.
