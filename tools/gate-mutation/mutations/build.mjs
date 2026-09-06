// One deliberate unresolved-asset defect, isolated to the `build` gate.
//
// Target: `apps/web/src/main.tsx`'s `import './styles.css'`, pointed at a file that does not exist.
// `vite/client`'s ambient `declare module '*.css'` type covers any `*.css` specifier regardless of
// whether the file is actually on disk, so `tsc --noEmit` (the `typecheck` gate) stays green; Vite's
// real bundler resolution for `build` (`vite build`) hits the filesystem and fails with an unresolved
// import. This is the one gate pair (`typecheck`/`build`) where a single TypeScript error would have
// failed both at once, so the defect deliberately exploits the ambient-vs-real-file gap instead.
import { mutateFile } from '../lib/fs-mutator.mjs'

const TARGET = 'apps/web/src/main.tsx'
const NEEDLE = "import './styles.css'"
const MUTATED = "import './styles.does-not-exist.css'"

export default {
  gate: 'build',
  description: `points the global CSS import in ${TARGET} at a nonexistent file (unresolved import)`,
  targets: [TARGET],
  apply(root) {
    return mutateFile(root, TARGET, (text) => {
      if (!text.includes(NEEDLE)) throw new Error(`build mutation: anchor not found in ${TARGET}`)
      return text.replace(NEEDLE, MUTATED)
    })
  },
}
