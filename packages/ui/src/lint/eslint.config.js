// Lives under `src/` (not a package-root `eslint.config.js`) so it stays inside this item's
// `TOUCHES` (`packages/ui/src/**`); `package.json`'s `lint` script points ESLint at this file
// explicitly with `--config`, which works from any location -- flat config does not require the
// config file to sit at the project root, only that the CLI knows where it is.
import react from '@devon/config/eslint/react.js'
import storybook from 'eslint-plugin-storybook'
import devonShell from './no-shell-truncate.js'

export default [
  ...react,
  ...storybook.configs['flat/recommended'],
  {
    // `@devon/config/eslint/react.js` sets `settings.react.version = 'detect'`, which crashes under
    // this repo's exact ESLint 10.10.0 + eslint-plugin-react 7.37.5 pin (`eslint-plugin-react`
    // calls the ESLint 8-era `context.getFilename()`, removed in ESLint 10's rule context). Pinning
    // the version explicitly here skips that code path entirely without touching the shared
    // `@devon/config` preset (out of this item's TOUCHES). react/react-dom in this workspace are
    // pinned to 19.2.8 (packages/ui/package.json) -- keep this in sync with that pin.
    settings: { react: { version: '19.2.8' } },
    rules: {
      // TypeScript is the prop contract in this repo (TECH-SPEC §16); `react/prop-types` only
      // understands the legacy PropTypes API and does not read `interface Props`, so it produces
      // false positives on every typed component. Off, not "weakened" -- there was never a real
      // check here to weaken.
      'react/prop-types': 'off',
    },
  },
  {
    // AC-6 / design.md §3.5: nothing in the shell may ellipsize a label. Scoped narrowly (matched
    // regardless of whether ESLint resolves `files` glob bases against the CLI cwd or this config
    // file's own directory) so the rule never becomes noise for non-shell components.
    files: ['**/shell/**/*.{ts,tsx}'],
    plugins: { devon: devonShell },
    rules: { 'devon/no-shell-truncate': 'error' },
  },
]
