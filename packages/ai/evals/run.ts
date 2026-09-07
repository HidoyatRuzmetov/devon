#!/usr/bin/env tsx
// `pnpm --filter @devon/ai evals` (`agentic/gates.json`'s `ai-evals` gate: non-blocking until
// EPIC-012, blocking on release per TECH-SPEC §12). Runs the golden set (`cases.ts`) through the real
// gateway -- against the real GLM endpoint when `AI_API_KEY` is set in the environment this runs in,
// against the offline simulator otherwise, so the gate still means something (schema validity, the
// citation guard rails) on a machine/CI runner with no key configured.
//
// This is a small, purpose-built harness rather than a dependency on the `promptfoo` CLI itself: the
// case shape (`cases.ts`'s `EvalCase`) is deliberately promptfoo-compatible (id, feature-as-provider,
// vars-as-input, an assertion function) so wiring the real `promptfoo eval` command in later -- once
// it is added to the toolchain -- is a config file pointing at this same `cases.ts`, not a rewrite.
import { createProvider, loadAiConfig, hasApiKey, runFeature } from '../src/index.js'
import { EVAL_CASES } from './cases.js'

async function main(): Promise<void> {
  const config = loadAiConfig()
  const provider = createProvider(config)
  const usingRealProvider = hasApiKey(config)

  console.log(
    `[ai-evals] running ${EVAL_CASES.length} case(s) against ${usingRealProvider ? `the real GLM endpoint (${config.model})` : 'the offline simulator (no AI_API_KEY configured)'}`,
  )

  let failures = 0
  for (const evalCase of EVAL_CASES) {
    const result = await runFeature({
      provider,
      config,
      feature: evalCase.feature,
      input: evalCase.input,
    })
    if (!result.ok) {
      failures++
      console.log(`[ai-evals] FAIL ${evalCase.id}: run() failed -- ${result.error}`)
      continue
    }
    const checkError = evalCase.check?.(result.data) ?? null
    if (checkError) {
      failures++
      console.log(`[ai-evals] FAIL ${evalCase.id}: ${checkError}`)
      continue
    }
    console.log(
      `[ai-evals] PASS ${evalCase.id} (${result.meta.totalTokens} tokens, ${result.meta.latencyMs}ms)`,
    )
  }

  console.log(`[ai-evals] ${EVAL_CASES.length - failures}/${EVAL_CASES.length} passed`)
  if (failures > 0) process.exit(1)
}

main().catch((err: unknown) => {
  console.error('[ai-evals] crashed:', err instanceof Error ? err.message : err)
  process.exit(1)
})
