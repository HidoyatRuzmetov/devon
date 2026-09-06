<!-- file: docs/adr/ADR-000-security-baseline.md -->
# ADR-000: Security baseline is OWASP ASVS 5.0 Level 2 plus `agentic/HARDENING.md`

- **Date:** 2026-09-06   **Status:** accepted
- **Deciders:** wp-architect + wp-security   **Epic:** EPIC-000

## Context
The platform holds employee personal data on a ministry server under Uzbekistan's data-localisation law (`docs/01-research/uzbekistan-context.md` §42; `auth-permissions-security-compliance.md` §8–9). It is owned by a state body, which per `uzbekistan-context.md` (gap-fill §299) very likely triggers mandatory state cybersecurity expertise before production rollout. We need one named bar so that "is this secure enough" stops being a per-epic argument. ASVS 5.0 was released 30 May 2025 and has a Russian translation, which matters for briefing local reviewers.

## Decision
The security bar is **OWASP ASVS 5.0 Level 2**, operationalised as `agentic/HARDENING.md` H1–H30. Level 1 is insufficient (we hold citizen-adjacent employee PII); Level 3 is out of scope (no national digital-ID and no payment integration — decision 10). Every epic satisfies the applicable HARDENING items (I-9a) and verifiers cite item ids in findings; EPIC-014 executes the full list with measurements. In EPIC-000 the applicable items are H1.1, H1.2, H1.3, H1.4, H1.7, H1.9, H1.10, H1.11, H1.13, H1.15, H1.16, H3.3, H3.7, H7.3, H16.1, H17.1, H18.1, H21.1, H22.1.

## Consequences
- Positive: one citable standard for the ministry's IT security office; the checklist is machine-adjacent (most items map to a gate), so compliance is evidenced rather than asserted.
- Negative / debt accepted: no WAF, no SBOM signing and no incident-response runbook in EPIC-000. Uzbek law imposes **no breach-notification duty** (`auth-permissions-security-compliance.md` §G5, confirmed) so an incident runbook is an internal-standards choice, deferred to EPIC-014 with that fact stated rather than assumed.
- Migration / rollback path: none needed — this is a policy, not code. Raising to L3 later is additive.

## Alternatives considered
- ASVS Level 1: rejected — too low for a system holding personal data.
- ISO 27001 as the primary frame: rejected — it is an ISMS standard about organisation and process, not a checklist a delivery loop can gate on; kept as the mapping target for a future audit.
