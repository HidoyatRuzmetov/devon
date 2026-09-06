# Work item: EPIC-000.2 @devon/db: schema, audit chain, RLS, tenancy registry, withContext, migrate:verify

- **Epic:** EPIC-000   **Owner:** wp-backend
- **Depends on:** EPIC-000.1   **Parallel-safe:** yes
- **Covers:** AC-9, AC-10, AC-14
- **Class:** C (wp-security mandatory on review)

## TOUCHES (exhaustive; a diff outside this list is a FAIL)
- `packages/db/package.json`
- `packages/db/tsconfig.json`
- `packages/db/drizzle.config.ts`
- `packages/db/src/schema/**`
- `packages/db/src/tenancy.ts`
- `packages/db/src/tiers.ts`
- `packages/db/src/context.ts`
- `packages/db/src/audit.ts`
- `packages/db/src/rls.ts`
- `packages/db/src/normalize-uz.ts`
- `packages/db/src/index.ts`
- `packages/db/migrations/**`
- `packages/db/test/**`

## DOES NOT
- touch `packages/db/src/seed/**` (that is EPIC-000.demo, sequenced strictly after this item)
- touch `apps/api`, `apps/web`, or `packages/contracts`
- add a down-migration or edit an already-applied migration file (I-15)

## Handoff contract
```ts
export type RequestContext = { requestId: string; userId: string|null; actorRole: Role|null; departmentId: string|null; actingForUserId: string|null; viewAs: boolean; ip: string; userAgent: string }
export interface Tx {
  readonly drizzle: DrizzleTransaction
  raw<R = unknown>(query: SQL): Promise<R[]>          // throws TenancyContextMissing outside withContext
  audit(event: AuditEventInput): void                  // flushed inside THIS transaction only
  privateRead(input: { subjectUserId: string; fields: string[] }): void
}
export function withContext<T>(ctx: RequestContext, fn: (tx: Tx) => Promise<T>): Promise<T>
export type AuditEventInput = { action: `${string}.${string}`; subjectType: string; subjectId: string|null; departmentId?: string|null; before?: unknown; after?: unknown }
export const TENANCY: Readonly<Record<string, 'tenant_root'|'department_owned'|'user_owned'|'global'|'audit'>>
```
Grants + triggers both enforce audit append-only (grants alone or triggers alone is a fail per AC-9's disproof). RLS policies compare a column to a GUC — no sub-select. Unset context = zero rows, never all rows. `EPIC-000.6` and `EPIC-000.demo` import only from this public API.

## Done when
- gates profile `item` green (typecheck, lint, unit, build; `migrate` runs as part of this item's own verification even though it is not in the `item` profile)
- `wp-reviewer` and `wp-security` have no open SEV1/SEV2
- evidence: `migrate:verify` output showing idempotent apply, tenancy registry pass, RLS cross-department isolation (zero rows both via Drizzle and `tx.raw()`), and audit tamper detection reporting exactly the altered seq
