// One deliberate missing-key defect, isolated to the `i18n` gate.
//
// Target: `packages/i18n/messages/ru.json`, key `shell.locale.aria`. Deleting it from `ru` only
// (uz-Latn stays the base locale with the key present) makes `check-i18n.mjs` report it as missing
// against the base locale -- AC-3's own disproof #2 ("deleting one ru key ... still exiting 0"). This
// mirrors `@devon/i18n`'s own `break:ru` evidence CLI, but goes through the generic mutate/revert
// helper here rather than that package's script, since this harness must revert deterministically
// without depending on another package's tooling being present.
import { deleteJsonKeyPath } from '../lib/fs-mutator.mjs'

const TARGET = 'packages/i18n/messages/ru.json'
const KEY = 'shell.locale.aria'

export default {
  gate: 'i18n',
  description: `deletes the '${KEY}' key from ${TARGET} (missing vs. the uz-Latn base locale)`,
  targets: [TARGET],
  apply(root) {
    return deleteJsonKeyPath(root, TARGET, KEY)
  },
}
