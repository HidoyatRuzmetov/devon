# Work item: <ITEM-ID> <title>

- **Epic:** <EPIC-ID>   **Owner:** wp-backend | wp-frontend | wp-ui | wp-devops
- **Depends on:** <ITEM-IDs or none>   **Parallel-safe:** yes | no
- **Covers:** AC-<n>, AC-<m>
- **Class:** A | B | C

## TOUCHES (exhaustive; a diff outside this list is a FAIL)
- `apps/api/src/leave/*`
- `packages/db/migrations/0007_leave.sql`

## DOES NOT
- touch `apps/web` (that is ITEM-<x>)
- change the `Person` contract

## Handoff contract
<The exact API/type/props shape the next item consumes. Paste the TypeScript. If this item is UI, paste the spec section it implements.>

## Done when
- gates profile `item` green
- `wp-reviewer` has no open SEV1/SEV2
- evidence for its ACs exists (test names / routes)
