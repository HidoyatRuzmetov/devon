// One deliberate type error, isolated to the `typecheck` gate.
//
// Target: `apps/web/src/lib/constants.ts`. `apps/web`'s `build` script is `vite build`, which
// transpiles TypeScript through esbuild and never type-checks (design.md §8 confirms no
// `vite-plugin-checker`/`vue-tsc`-style plugin runs here) -- so a type error added to an `apps/web`
// source file fails `typecheck` (`tsc --noEmit -p src/tsconfig.json`) without also failing `build`.
// The added binding is exported (so `no-unused-vars` does not fire) and syntactically valid (so
// `lint`'s prettier check does not fire either).
import { mutateFile } from '../lib/fs-mutator.mjs'

const TARGET = 'apps/web/src/lib/constants.ts'
const MARKER = '__GATE_MUTATION_TYPECHECK'

export default {
  gate: 'typecheck',
  description: `assigns a string literal to a number-typed exported const in ${TARGET} (TS2322)`,
  targets: [TARGET],
  apply(root) {
    return mutateFile(root, TARGET, (text) => `${text}\nexport const ${MARKER}: number = 'not-a-number'\n`)
  },
}
