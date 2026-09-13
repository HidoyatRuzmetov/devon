// One locale's catalogue as its own module, so `messages.ts` can `import()` it lazily.
//
// The JSON is reached through this thin JS module rather than imported directly by the dynamic
// `import()`, because the two runtimes disagree about JSON modules: Node ESM requires the
// `with { type: 'json' }` attribute, while Vite serves a transformed `.json` as `text/javascript`
// and the browser then refuses the module outright ("Expected a JSON module script but the server
// responded with a MIME type of text/javascript" -- found switching locale in the running app).
// A `.ts` module satisfies both: the attribute stays on this static import, and the dynamic import
// that reaches it asks for plain JavaScript. Bundlers still split it into its own chunk.
import catalogue from '../../messages/en.generated.json' with { type: 'json' }
import type { MessageTree } from '../messages.js'

export default catalogue as MessageTree
