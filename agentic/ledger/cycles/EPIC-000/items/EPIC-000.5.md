# Work item: EPIC-000.5 @devon/contracts: Zod schemas, can(), Problem, field tiers

- **Epic:** EPIC-000   **Owner:** wp-backend
- **Depends on:** EPIC-000.1   **Parallel-safe:** yes
- **Covers:** AC-11
- **Class:** B

## TOUCHES (exhaustive; a diff outside this list is a FAIL)
- `packages/contracts/package.json`
- `packages/contracts/src/**`
- `packages/contracts/test/**`

## DOES NOT
- touch `packages/db` (USER_FIELD_TIER lives in `packages/db/src/tiers.ts`, owned by EPIC-000.2; this item imports it rather than redefining it)
- touch `apps/api` or `apps/web`

## Handoff contract
```ts
export type Role = 'super_admin'|'head'|'member'
export type Membership = { departmentId: string; role: Exclude<Role,'super_admin'> }
export type Actor = { userId: string; role: Role; memberships: readonly Membership[]; departmentId: string|null; actingFor: { userId: string; role: Role; grantId: string }|null; viewAs: { departmentId: string }|null }
export type Action = 'read'|'create'|'update'|'archive'|'delete'|'administer'
export type Subject = { kind:'instance' } | { kind:'department'; departmentId:string } | { kind:'department_child'; departmentId:string } | { kind:'personal'; ownerUserId:string } | { kind:'own_account'; userId:string } | { kind:'audit' } | { kind:'public' }
export type DenyReason = 'not_authenticated'|'not_super_admin'|'not_a_member'|'not_head'|'not_owner'|'read_only_view_as'|'department_paused'|'maintenance'
export type Decision = { allowed:true } | { allowed:false; reason: DenyReason }
export function can(actor: Actor|null, action: Action, subject: Subject): Decision
export const PROBLEM_CODES = ['unauthenticated','forbidden','not_found','gone','conflict','validation_failed','rate_limited','maintenance','internal'] as const
```
Unit-test one assertion per rule (design.md §1.6). `detail` on `Problem` is a frozen literal table; a test asserts `JSON.stringify(problem)` for every code contains no uuid, login, email, `select `, `/src/`, or `at Object.`. `EPIC-000.6` imports these types verbatim.

## Done when
- gates profile `item` green
- `wp-reviewer` has no open SEV1/SEV2
- evidence: one unit-test assertion per `can()` rule listed above, all passing; the Problem no-domain-data test passing for every code
