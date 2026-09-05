# Verification report: <role> on <ITEM-ID or EPIC-ID>

- **Verifier:** wp-reviewer | wp-security | wp-qa | wp-qa-visual | wp-a11y-i18n
- **Diff/commit reviewed:** <sha or branch>   **Gates profile seen green:** <name> at <time>
- **Verdict summary:** <n> SEV1, <n> SEV2, <n> SEV3, <n> NIT

## Findings

```
SEV2 | <path>:<line> | <one-line defect>
     | AC: AC-<n>  (or INVARIANT: I-<n>)
     | REPRO: <exact steps or command>
     | EVIDENCE: <output / screenshot path>
     | FINGERPRINT: <sha1(path + normalised summary)[:8]>
```

## Tried to break (mandatory when zero SEV1/SEV2)
1. <specific attempt and what happened>
2. <…>
3. <…>

## NOT-SCOPE (what you did not read / trace)
- <files or paths>

## Evidence for ACs (what wp-pm may cite)
- AC-1: <test name / screenshot / command + output>
