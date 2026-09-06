# Work item: EPIC-000.6 @devon/api: sessions, setup bootstrap, admin namespace, healthz/readyz, OpenAPI

- **Epic:** EPIC-000   **Owner:** wp-backend
- **Depends on:** EPIC-000.2, EPIC-000.5   **Parallel-safe:** no
- **Covers:** AC-11, AC-12, AC-13
- **Class:** C (wp-security mandatory on review)

## TOUCHES (exhaustive; a diff outside this list is a FAIL)
- `apps/api/package.json`
- `apps/api/src/**`
- `apps/api/test/**`

## DOES NOT
- touch `packages/db`, `packages/contracts`, `apps/web`, or `packages/i18n`
- implement the demo seed (EPIC-000.demo) — this item only exposes `instance_settings.is_demo` via `GET /api/v1/instance`

## Handoff contract
```
GET    /healthz                    → 200 {status:'ok'}                        public
GET    /readyz                     → 200 | 503 {db, valkey, migrations}       public
GET    /api/v1/openapi.json        → 200                                     public
GET    /api/v1/instance            → 200 InstancePublic                      public
POST   /api/v1/setup/{token}       → 201 SetupResult | 410 Problem            public, loopback-gated
POST   /api/v1/auth/login          → 204 + Set-Cookie | 401 Problem           public, rate-limited
POST   /api/v1/auth/logout         → 204 + expired cookie                    authenticated
GET    /api/v1/me                  → 200 Me | 401 Problem                    authenticated
PATCH  /api/v1/me                  → 200 Me                                  own_account
GET    /api/v1/admin/instance      → 200 AdminInstance | 403 Problem         instance
GET    /api/v1/admin/audit/verify  → 200 ChainVerification | 403 Problem     instance
ALL    /api/v1/admin/* (unmatched) → 403 Problem (scoped notFoundHandler)    instance
```
Every route declares `config.permission: { action, subject } | { public: true }` or the server throws at registration time. A unit test walks `app.printRoutes()` and asserts the `{public:true}` set equals a checked-in allow-list. `authorize.ts` is one global `preHandler` calling `can()`; on deny it writes `audit.events{action:'access.denied'}` via `tx.audit()` and returns the Problem. Sessions: `app.sessions` row is the sole revocation record; cookie `devon_sid` carries HttpOnly, Secure, SameSite=Lax; logout sets `revoked_at`, checked on every request. Setup: first boot with zero users prints exactly one setup URL (≥128-bit token, hashed at rest); race-safe consumption; 410 forever after, never reprinted once a super admin exists. Admin namespace: byte-identical 403 Problem body for existing and non-existing `/api/v1/admin/*` paths for a non-super-admin.

## Done when
- gates profile `item` green
- `wp-reviewer` and `wp-security` have no open SEV1/SEV2
- evidence: `setup:prove`, `session:prove`, `admin:prove` scripts produce the transcripts named in design.md §9 (first boot, consume, replay 410, cookie replay 401 post-logout, three break attempts on /admin)
