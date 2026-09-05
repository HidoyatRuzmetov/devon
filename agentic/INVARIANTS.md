# WorkPortal Invariants

Truths that must hold in every commit. A breach is SEV1 regardless of how it got there. Reviewers check
these explicitly; `wp-security` tries to break them. Agents may not edit this file (hook-protected);
additions are made by the human or via an ADR merged by `wp-release`.

## Tenancy and data
- I-1 Every row of tenant-owned data carries `tenant_id`, and every query is scoped by it, either through
  Postgres row-level security with `SET LOCAL app.tenant_id` or through the repository layer. No raw
  query bypasses it.
- I-2 Personal data (date of birth, personal phone, home address, passport/PINFL, emergency contact,
  documents) lives only in `restricted` fields and is never returned by list endpoints. Access is
  logged with actor, subject, field, purpose.
- I-3 Deleting is soft by default. Hard deletes exist only in explicit retention jobs with an audit
  record.
- I-4 IDs are stable, opaque, and never re-used. External systems get the same ID forever.
- I-5 Every write to a domain object appends an event to the audit/event log in the same transaction.

## Permissions
- I-6 Authorisation happens on the server. The client only hides what it cannot use.
- I-7 The permission check is centralised (`can(actor, action, object)`); no endpoint hand-rolls it.
- I-8 A deputy acting for someone is recorded as `acting_for`; the audit log shows both identities.

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
