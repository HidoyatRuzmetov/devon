// One deliberate lint violation, isolated to the `lint` gate.
//
// Target: `apps/web/src/lib/greeting.ts`. An unused local `const` inside a function body trips
// `@typescript-eslint/no-unused-vars` (error, `packages/config/eslint/base.js`). It is not a type
// error -- neither `tsconfig.base.json` nor either tsconfig that extends it sets `noUnusedLocals` /
// `noUnusedParameters` (checked: `agentic/ledger/cycles/EPIC-000` build notes) -- so `typecheck` and
// `build` (esbuild, no lint step) both stay green.
import { mutateFile } from '../lib/fs-mutator.mjs'

const TARGET = 'apps/web/src/lib/greeting.ts'
const NEEDLE = 'export function tashkentHour(d: Date): number {'
// Deliberately does NOT start with `_`: `@typescript-eslint/no-unused-vars`'s
// `varsIgnorePattern: '^_'` (packages/config/eslint/base.js) would otherwise ignore it and this
// mutation would silently fail to trigger anything (caught empirically while building this module).
const MARKER = 'const gateMutationLintUnused = 1'

export default {
  gate: 'lint',
  description: `adds an unused local binding inside tashkentHour() in ${TARGET} (no-unused-vars)`,
  targets: [TARGET],
  apply(root) {
    return mutateFile(root, TARGET, (text) => {
      if (!text.includes(NEEDLE)) throw new Error(`lint mutation: anchor not found in ${TARGET}`)
      return text.replace(NEEDLE, `${NEEDLE}\n  ${MARKER}`)
    })
  },
}
