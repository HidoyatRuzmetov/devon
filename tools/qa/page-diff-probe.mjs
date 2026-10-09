// Deliberately run as an isolated, heap-bounded process. This valid~36KB document must not
// allocate a quadratic~144million-cell history grid or freeze the colleague's browser.
import { diffText } from '../../apps/web/src/features/pages/diff.ts'
const before = 'alpha '.repeat(6000)
const after = 'bravo '.repeat(6000)
const began = performance.now()
const parts = diffText(before, after)
if (parts.filter(part => part.type !== 'added').map(part => part.text).join('') !== before)
  throw new Error('Before-document reconstruction changed')
if (parts.filter(part => part.type !== 'removed').map(part => part.text).join('') !== after)
  throw new Error('After-document reconstruction changed')
console.log(JSON.stringify({ words: 6000, parts: parts.length, elapsedMs: performance.now()-began, heapUsedBytes: process.memoryUsage().heapUsed }))
