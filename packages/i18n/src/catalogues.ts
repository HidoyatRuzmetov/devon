// "Give me all four locales, now, synchronously" -- the Node-side entry point.
//
// `./messages.js` statically bundles only the default locale so that a browser downloads the one
// catalogue it is actually rendering in (see the note at the top of that file). Node-side callers
// have no such constraint and often genuinely need every locale at once -- the i18n tests that
// compare key sets across catalogues, the `break:*` CLIs, and any test suite that renders a
// component after `setLocale('ru')` and asserts on the Russian string. Importing this module for its
// side effect registers the other three eagerly and restores exactly the pre-v1.1 behaviour:
//
//     import '@devon/i18n/catalogues'
//
// It is deliberately NOT re-exported from the package barrel: a browser that reached it through
// `index.ts` would pull all four catalogues back into the shell chunk.
import uzCyrl from '../messages/uz-Cyrl.generated.json' with { type: 'json' }
import ru from '../messages/ru.generated.json' with { type: 'json' }
import en from '../messages/en.generated.json' with { type: 'json' }
import { registerCatalogue, type MessageTree } from './messages.js'

export function registerAllCatalogues(): void {
  registerCatalogue('uz-Cyrl', uzCyrl as MessageTree)
  registerCatalogue('ru', ru as MessageTree)
  registerCatalogue('en', en as MessageTree)
}

registerAllCatalogues()
