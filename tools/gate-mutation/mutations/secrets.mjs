// One deliberate credential-shaped literal, isolated to the `secrets` gate.
//
// Target: a brand-new scratch file under this tool's own directory
// (`tools/gate-mutation/.tmp/secret-defect.txt`) -- `check-secrets.mjs` scans every tracked *and*
// untracked, non-ignored file (`git ls-files --cached --others --exclude-standard`), so an untracked
// file is enough, and keeping it inside `tools/gate-mutation/**` means the defect can never leak into
// a package that `typecheck`/`lint`/`unit`/`build` would also see. The string matches
// `check-secrets.mjs`'s AWS-access-key pattern (`AKIA[0-9A-Z]{16}`) and deliberately avoids every word
// in its `allow` list (`example`, `placeholder`, `changeme`, `dummy`, `sample`, ...), which would
// otherwise suppress the hit.
import { createFile } from '../lib/fs-mutator.mjs'

const TARGET = 'tools/gate-mutation/.tmp/secret-defect.txt'
// Built from two halves rather than one literal: `check-secrets.mjs` matches on raw text, not on
// code semantics, so writing the whole 20-character token as one string literal *here* would make
// this file itself a permanent secrets-gate hit -- and since this module is a tracked, committed
// source file, the gate would then fail on every clean HEAD, forever, defeating AC-14. 16 chars after
// AKIA, no digit/letter run that spells an allow-listed word (example/placeholder/changeme/dummy/...).
const FAKE_AWS_KEY = ['AKIA', '1938572604BQZK9X'].join('')

export default {
  gate: 'secrets',
  description: `adds an untracked scratch file (${TARGET}) containing an AWS-access-key-shaped literal`,
  targets: [TARGET],
  apply(root) {
    return createFile(
      root,
      TARGET,
      `# Deliberate secrets-gate defect (EPIC-000.10 gate-mutation harness). Reverted immediately after use.\naws_access_key_id = ${FAKE_AWS_KEY}\n`,
    )
  },
}
