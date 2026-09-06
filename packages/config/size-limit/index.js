// Shared size-limit preset. `agentic/gates.json` sets `limits.bundle_main_kb_max = 350`; the "main
// bundle" budget is narrower (DESIGN.md: shell should ship well under that ceiling on its own).
// Consume from a package's .size-limit.json / size-limit.config.js:
//   import { mainBundleLimit } from '@devon/config/size-limit'
//   export default [mainBundleLimit({ path: 'dist/assets/index-*.js' })]
export const BUNDLE_MAIN_KB_MAX = 350

export function mainBundleLimit({ path, name = 'main bundle', limitKb = 200 } = {}) {
  if (!path) throw new Error('mainBundleLimit({ path }) requires a build output glob')
  return {
    name,
    path,
    limit: `${limitKb} KB`,
    gzip: true,
  }
}
