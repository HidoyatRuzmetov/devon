# WorkPortal Invariants

Truths that must hold in every commit. A breach is SEV1 regardless of how it got there. Reviewers check
these explicitly; `wp-security` tries to break them. Agents may not edit this file (hook-protected);
additions are made by the human or via an ADR merged by `wp-release`.

## Tenancy and data
- I-1 Every row of department-owned data carries `department_id`, and every query is scoped by it
  through Postgres row-level security (`select set_config('app.department_id', $1, true)`) and the
  repository layer. Personal-workspace rows carry `user_id` and are readable by that user only, never
  by the head, never by the super admin's view-as. No raw query bypasses either.
- I-2 The system stores no HR-grade personal data (no birth dates, IDs, addresses, documents).
  Contact details beyond work fields are optional, never returned by list endpoints, and reads by the
  head or super admin are logged.
- I-3 Deleting is soft by default. Hard deletes exist only in explicit retention jobs with an audit
  record. The audit log itself is never subject to retention.
- I-4 IDs are stable, opaque, and never re-used. External systems get the same ID forever.
- I-5 Every write to a domain object appends an event to the audit log in the same transaction.
- I-5a The audit log (`audit.events`) is immutable: the application database role holds INSERT and
  SELECT only; UPDATE, DELETE and TRUNCATE are revoked and additionally blocked by a trigger; rows are
  hash-chained and the chain head is anchored nightly outside the database. No code path, role or
  migration may weaken this; a migration that touches the `audit` schema's grants is SEV1.
- I-5b Every action by the `super_admin` is audited with the role recorded; super admin power is
  unlimited but never silent. The pause and wipe switches are audited before they act.

## Permissions
- I-6 Authorisation happens on the server. The client only hides what it cannot use.
- I-7 The permission check is centralised (`can(actor, action, object)`); no endpoint hand-rolls it.
- I-8 A deputy acting for someone is recorded as `acting_for`; the audit log shows both identities.
- I-8a Departments never see each other. Nothing crosses a department boundary except the super
  admin's audited read-only view-as. A department exists only through a request approved by the
  super admin (or created by them); its creator becomes head; joining requires the key and the
  password; structure editing and self-assignment inside a department are open by default and
  governed only by the head's settings.
- I-8b Roles are exactly `super_admin`, `head`, `member`. Unit roles (bo'lim boshlig'i etc.) are
  labels, not permissions. Any UI must render correctly with zero unit heads.

## Product
- I-9 Every user-facing string goes through i18n with `uz-Latn` as the default and `uz-Cyrl`, `ru`,
  `en` complete (four-way parity gate). No hard-coded strings in `apps/web`. Terminology comes from
  `packages/i18n/TERMS.md`.
- I-9a Every epic satisfies the applicable items of `agentic/HARDENING.md`; a verifier cites item
  ids in findings; EPIC-014 executes the whole list with measurements.
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
