# Work item: EPIC-000.10 Gate-mutation harness, one deliberate defect per blocking gate, ADR-000…013 landing

- **Epic:** EPIC-000   **Owner:** wp-devops
- **Depends on:** EPIC-000.1–EPIC-000.9   **Parallel-safe:** no
- **Covers:** AC-14
- **Class:** B

## TOUCHES (exhaustive; a diff outside this list is a FAIL)
- `tools/gate-mutation/**`
- `docs/adr/ADR-000-security-baseline.md`
- `docs/adr/ADR-001-monorepo-pins.md`
- `docs/adr/ADR-002-tenancy-department-id.md`
- `docs/adr/ADR-003-sessions-cookies.md`
- `docs/adr/ADR-004-audit-hash-chain.md`
- `docs/adr/ADR-005-deferred.md`
- `docs/adr/ADR-006-deferred.md`
- `docs/adr/ADR-007-deferred.md`
- `docs/adr/ADR-008-deferred.md`
- `docs/adr/ADR-009-deferred.md`
- `docs/adr/ADR-010-tokens-theming.md`
- `docs/adr/ADR-011-sentinel-pause-wipe.md`
- `docs/adr/ADR-012-i18n-gate-config.md`
- `docs/adr/ADR-013-demo-seed.md`
- `.github/workflows/ci.yml`

## DOES NOT
- touch `agentic/gates.json`, `agentic/scripts/gate.mjs`, or any other protected path — it proves the existing gates fail on a defect, it does not add gates
- modify `ci.yml` beyond adding the nightly release job (all other sections belong to EPIC-000.1)

## Handoff contract
`tools/gate-mutation` introduces exactly one deliberate defect per blocking gate, runs `agentic/scripts/gate.mjs --profile integration`, asserts that gate and only that gate fails, then reverts — the AC-14 non-vacuity proof. `docs/adr/` gets one file per row of design.md §6: ADR-000 (security baseline), ADR-001 (monorepo/pins), ADR-002 (tenancy = department_id, no tenant_id), ADR-003 (Postgres-only sessions, SameSite=Lax), ADR-004 (hash-chained audit), ADR-010 (tokens/theming), ADR-011 (sentinel, no destructive path), ADR-012 (i18n gate config, strengthen-only), ADR-013 (demo seed). ADR-005–009 are deliberate deferred stubs, each naming the epic that will decide it — do not invent content.

## Done when
- gates profile `integration` exits 0, every gate `pass`, none `skipped`
- `wp-reviewer` has no open SEV1/SEV2
- evidence: one pasted failing run per blocking gate from the mutation harness, plus `last-gate.json` attached; all ADR files present and reviewed
