import { test } from 'node:test'
import assert from 'node:assert/strict'
import { storyApplicability } from '../source-applicability.mjs'

const facts = {
  runtimeImportSpecifiers: ['react', '@devon/ui', './app.js'],
  runtimeGlobs: ['./*/manifest.ts', './*/manifest.tsx'],
  uiExportTargets: ['./src/index.ts', './src/styles/tokens.css', './src/styles/fonts.css'],
  storybookPatterns: ['../src/**/*.stories.@(ts|tsx)'],
}
const source = 'packages/ui/src/primitives/button.stories.tsx'
test('only the exact story source is inapplicable to colleague routes; real UI remains pending', () => {
  assert.equal(storyApplicability(source, facts).status, 'not-applicable')
  assert.equal(storyApplicability('packages/ui/src/primitives/button.tsx', facts), null)
  assert.equal(
    storyApplicability('apps/web/src/features/work/components/work-board.tsx', facts),
    null,
  )
})
test('a newly imported story withdraws its exclusion instead of hiding a runtime example', () => {
  for (const specifier of [
    './button.stories.js',
    '@devon/ui/storybook',
    '<computed runtime import>',
  ])
    assert.equal(
      storyApplicability(source, { ...facts, runtimeImportSpecifiers: [specifier] }),
      null,
    )
})
test('a broader runtime glob or package export withdraws the classification', () => {
  assert.equal(storyApplicability(source, { ...facts, runtimeGlobs: ['../**/*.tsx'] }), null)
  assert.equal(storyApplicability(source, { ...facts, uiExportTargets: ['./src/*'] }), null)
  assert.equal(storyApplicability(source, { ...facts, runtimeGlobs: [] }), null)
  assert.equal(storyApplicability(source, { ...facts, uiExportTargets: [] }), null)
})
test('the separate Storybook entry must actually select the story files', () => {
  assert.equal(storyApplicability(source, { ...facts, storybookPatterns: [] }), null)
})
