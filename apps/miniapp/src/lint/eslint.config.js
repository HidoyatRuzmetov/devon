// Lives under `src/` (not a package-root `eslint.config.js`) so the whole package stays inside one
// TOUCHES path -- the same convention `apps/web/src/lint/eslint.config.js` and `@devon/ui` use, and
// the reason `package.json`'s `lint` script points ESLint at an explicit `--config`.
import globals from 'globals'
import react from '@devon/config/eslint/react.js'

export default [
  ...react,
  {
    // The shared React preset only adds `globals.browser` for `**/*.{jsx,tsx}`; every plain `.ts`
    // module in this package is browser code too (`fetch`, `window`, `localStorage`, `navigator`).
    files: ['**/*.ts'],
    languageOptions: { globals: { ...globals.browser } },
  },
  {
    // Same pin as `apps/web` and `@devon/ui`: `settings.react.version = 'detect'` from the shared
    // preset crashes under this repo's ESLint 10.10.0 + eslint-plugin-react 7.37.5 pin.
    settings: { react: { version: '19.2.8' } },
    rules: { 'react/prop-types': 'off' },
  },
]
