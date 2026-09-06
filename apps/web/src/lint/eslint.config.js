// Lives under `src/` (not a package-root `eslint.config.js`) so it stays inside this item's
// `TOUCHES` (`apps/web/src/**`) -- mirrors `@devon/ui`'s `src/lint/eslint.config.js` and
// `@devon/api`'s pattern of pointing the `lint` script at an explicit `--config` path.
import globals from 'globals'
import react from '@devon/config/eslint/react.js'

export default [
  ...react,
  {
    // `@devon/config/eslint/react.js` only adds `globals.browser` for `**/*.{jsx,tsx}` (the base
    // preset underneath applies `globals.node` to everything). Plain `.ts` modules in this package
    // (`src/lib/**`) are still browser code (`fetch`, `window`, `localStorage`, `navigator`,
    // `document`) -- without this, `no-undef` (part of `eslint:recommended`) would flag every one of
    // them.
    files: ['**/*.ts'],
    languageOptions: { globals: { ...globals.browser } },
  },
  {
    // Same pin as `@devon/ui` (`packages/ui/src/lint/eslint.config.js`): `settings.react.version =
    // 'detect'` from the shared preset crashes under this repo's exact ESLint 10.10.0 +
    // eslint-plugin-react 7.37.5 pin. react/react-dom here are pinned to 19.2.8 (package.json) --
    // keep this in sync with that pin.
    settings: { react: { version: '19.2.8' } },
    rules: {
      // TypeScript is the prop contract in this repo (TECH-SPEC §16); `react/prop-types` does not
      // understand `interface Props` and produces false positives on every typed component.
      'react/prop-types': 'off',
    },
  },
]
