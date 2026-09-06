// One deliberate logic defect, isolated to the `unit` gate.
//
// Target: `packages/contracts/src/permissions.ts`, the P2 rule (I-1: a `personal` subject is
// readable/writable by its owner only, no exception ever). Flipping `!==` to `===` inverts the
// check -- `can()` would then allow everyone *except* the owner, and deny the owner themselves.
// `packages/contracts/test/unit/permissions.test.ts` ("P2: personal is owner-only, no exceptions
// ever") asserts both directions, so `test:unit` fails. The change is one comparison operator: same
// types, same syntax shape, so `typecheck`, `lint` and `build` are all unaffected.
import { mutateFile } from '../lib/fs-mutator.mjs'

const TARGET = 'packages/contracts/src/permissions.ts'
const NEEDLE = "if (subject.ownerUserId !== actor.userId) return deny('not_owner')"
const MUTATED = "if (subject.ownerUserId === actor.userId) return deny('not_owner')"

export default {
  gate: 'unit',
  description: `inverts the I-1 owner-only comparison in ${TARGET} (P2 rule)`,
  targets: [TARGET],
  apply(root) {
    return mutateFile(root, TARGET, (text) => {
      if (!text.includes(NEEDLE)) throw new Error(`unit mutation: anchor not found in ${TARGET}`)
      return text.replace(NEEDLE, MUTATED)
    })
  },
}
