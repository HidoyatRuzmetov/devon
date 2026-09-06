// One deliberate oversized-chunk defect, isolated to the `bundle` gate.
//
// Target: a new, uncovered module `apps/web/src/lib/__gate-mutation-bloat.ts` exporting a large
// high-entropy string (so gzip cannot shrink it away), referenced from `apps/web/src/main.tsx` so a
// bundler cannot tree-shake it out. `check-bundle.mjs` reads `apps/web/dist/assets` -- built output,
// not source -- so this mutation's `prereqGates: ['build']` tells `run.mjs` to rebuild before
// asserting on `bundle`. `/* c8 ignore file */` keeps the throwaway module out of the coverage
// denominator so it cannot nudge the `unit` gate's coverage threshold.
import { randomBytes } from 'node:crypto'
import { createFile, mutateFile } from '../lib/fs-mutator.mjs'

const BLOAT_FILE = 'apps/web/src/lib/__gate-mutation-bloat.ts'
const MAIN = 'apps/web/src/main.tsx'
const IMPORT_LINE = "import { GATE_MUTATION_BLOAT } from './lib/__gate-mutation-bloat.js'"
// An unconditional assignment onto a global object is a visible side effect a bundler's
// tree-shaking cannot remove -- unlike the first version of this mutation, which guarded the
// reference behind `GATE_MUTATION_BLOAT.length < 0`: esbuild's constant folding proves a string
// `.length` (always >= 0) can never be `< 0`, deletes the whole branch as dead code, and the
// "unused" import (and the 600 kB module with it) vanished from the built chunk entirely (caught
// empirically while building this module -- the gate stayed green with the defect "applied").
const USE_LINE = "globalThis.__gateMutationBloat = GATE_MUTATION_BLOAT.length"

// Comfortably over gates.json's limits.bundle_main_kb_max (350 kB gz): 600 kB of random bytes,
// base64-encoded (high entropy -- gzip cannot compress it away), lands well past the budget on its
// own regardless of the rest of the bundle's size.
function bloatSource() {
  const b64 = randomBytes(600 * 1024).toString('base64')
  return `/* c8 ignore file -- deliberate gate-mutation scratch file, reverted immediately after use */\nexport const GATE_MUTATION_BLOAT = '${b64}'\n`
}

export default {
  gate: 'bundle',
  description: `adds a ~600 kB high-entropy module (${BLOAT_FILE}), imported (and referenced, so it is not tree-shaken) from ${MAIN}`,
  targets: [BLOAT_FILE, MAIN],
  prereqGates: ['build'],
  apply(root) {
    const revertFile = createFile(root, BLOAT_FILE, bloatSource())
    const revertMain = mutateFile(root, MAIN, (text) => {
      if (!text.includes("import './styles.css'")) {
        throw new Error(`bundle mutation: anchor not found in ${MAIN}`)
      }
      return text
        .replace("import './styles.css'", `${IMPORT_LINE}\nimport './styles.css'`)
        .replace('bootLocale()', `${USE_LINE}\nbootLocale()`)
    })
    return () => {
      revertMain()
      revertFile()
    }
  },
}
