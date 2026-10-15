#!/usr/bin/env node
// Partition the existing gate profile without omitting or redefining any gate. Every job owns
// its own checkout, database, ports and report. The final required check fails closed if a
// dependency fails, is cancelled, is skipped, or is absent.
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'

export const REQUIRED_CI_JOBS = [
  'source-gates',
  'browser-development',
  'browser-production',
  'workflow-regressions',
]

export function partitionGateProfile(configuration, profile) {
  if (!['integration', 'release'].includes(profile)) throw new Error('Invalid CI gate profile')
  const names = configuration.profiles?.[profile]
  if (
    !Array.isArray(names) ||
    !names.length ||
    new Set(names).size !== names.length ||
    names.some((name) => !configuration.gates?.[name]) ||
    !['e2e', 'a11y'].every((name) => names.includes(name))
  )
    throw new Error('Invalid or incomplete CI gate profile')
  const browser = names.filter((name) => ['e2e', 'a11y'].includes(name))
  // New profile gates join this partition automatically; no workflow allowlist can silently
  // omit a newly added security, migration, build, performance or dependency check.
  const source = names.filter((name) => !browser.includes(name))
  return { source, browser }
}

export function requireSuccessfulDependencies(dependencies) {
  if (
    !dependencies ||
    Array.isArray(dependencies) ||
    typeof dependencies !== 'object' ||
    JSON.stringify(Object.keys(dependencies).sort()) !==
      JSON.stringify([...REQUIRED_CI_JOBS].sort())
  )
    throw new Error('The complete CI dependency set is required')
  const failed = REQUIRED_CI_JOBS.filter((name) => dependencies[name]?.result !== 'success')
  if (failed.length) throw new Error(`CI dependencies did not pass: ${failed.join(', ')}`)
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const part = process.argv[2]
  if (part === 'verify') {
    requireSuccessfulDependencies(JSON.parse(process.env.NEEDS_JSON ?? 'null'))
    console.log('[ci] All independent CI jobs passed for this commit')
  } else {
    if (!['source', 'browser'].includes(part)) throw new Error('Expected source, browser or verify')
    const configuration = JSON.parse(
      readFileSync(new URL('../agentic/gates.json', import.meta.url), 'utf8'),
    )
    const profile = process.env.GATE_PROFILE
    const names = partitionGateProfile(configuration, profile)[part]
    const result = spawnSync(
      process.execPath,
      [
        fileURLToPath(new URL('../agentic/scripts/gate.mjs', import.meta.url)),
        '--profile',
        profile,
        '--gates',
        names.join(','),
      ],
      { stdio: 'inherit', env: process.env },
    )
    if (result.error) console.error(result.error.message)
    process.exit(result.status ?? 1)
  }
}
