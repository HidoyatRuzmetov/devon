const featureManifestGlobs = new Set(['./*/manifest.ts', './*/manifest.tsx'])
const allowedUiExports = new Set([
  './src/index.ts',
  './src/styles/tokens.css',
  './src/styles/fonts.css',
])

/** Conservative source exclusion for one target: ordinary application routes. This is not a
 * Storybook test pass, nor does it exclude the real component imported by a story. New incoming
 * story imports, broader runtime globs or package exports withdraw this classification. */
export function storyApplicability(source, facts) {
  if (!/^packages\/ui\/src\/.+\.stories\.tsx?$/.test(source)) return null
  if (
    facts.runtimeImportSpecifiers.some(
      (specifier) =>
        specifier === '<computed runtime import>' ||
        /(?:\.stories(?:\.|$)|storybook)/.test(specifier),
    ) ||
    [...featureManifestGlobs].some((pattern) => !facts.runtimeGlobs.includes(pattern)) ||
    facts.runtimeGlobs.some((pattern) => !featureManifestGlobs.has(pattern)) ||
    !facts.uiExportTargets.includes('./src/index.ts') ||
    facts.uiExportTargets.some((target) => !allowedUiExports.has(target)) ||
    !facts.storybookPatterns.includes('../src/**/*.stories.@(ts|tsx)')
  )
    return null
  return {
    target: 'colleague-facing application routes',
    status: 'not-applicable',
    reason:
      'This exact source is a Storybook example, loaded only by the separate gallery entry. Current parsed application/UI TypeScript sources contain no incoming story import; the required runtime glob selects only feature manifests and package exports select the UI barrel/CSS. Its real shared component remains separately in the census. Storybook behavior/pixels are not certified.',
    proofId: 'storybook-source-boundary',
  }
}
