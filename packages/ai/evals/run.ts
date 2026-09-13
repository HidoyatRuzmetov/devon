#!/usr/bin/env tsx
// `pnpm --filter @devon/ai evals` -- the `ai-evals` gate (`agentic/gates.json`; v1.1 AI-AUDIT G-7
// moved it into the `integration` and `release` profiles, because a golden set that no profile runs
// has never once caught anything).
//
// Runs the golden set (`cases.ts`) through the real gateway: against the real GLM endpoint when
// `AI_API_KEY` is set in the environment this runs in, against the offline simulator otherwise -- so
// the gate still means something (schema validity, faithfulness, the citation guard rails,
// orthography) on a CI runner with no key configured.
//
// Three things it asserts beyond "the run succeeded":
//   1. the case's own `check()` — faithfulness, language, behaviour;
//   2. `determinism` cases run three times and must be byte-identical (AI-AUDIT §6.3 — the direct
//      test for "feels random");
//   3. a cost ceiling for the whole suite, so a prompt that quietly triples in size fails the gate
//      instead of quietly tripling a ministry's bill (AI-AUDIT §6.4).
import { createProvider, loadAiConfig, hasApiKey, runFeature } from '../src/index.js'
import { EVAL_CASES } from './cases.js'

/** UZS for one full pass of the suite. Generous enough not to be flaky, tight enough that a prompt
 * doubling in length is noticed. Raise it deliberately, in a commit that says why. */
const COST_CEILING_UZS = 4_000

const DETERMINISM_RUNS = 3

async function main(): Promise<void> {
  const config = loadAiConfig()
  const provider = createProvider(config)
  const usingRealProvider = hasApiKey(config)

  console.log(
    `[ai-evals] running ${EVAL_CASES.length} case(s) against ${
      usingRealProvider
        ? `the real GLM endpoint (${config.model})`
        : 'the offline simulator (no AI_API_KEY configured)'
    }`,
  )

  let failures = 0
  let totalTokens = 0
  let totalCostUzs = 0

  for (const evalCase of EVAL_CASES) {
    const result = await runFeature({
      provider,
      config,
      feature: evalCase.feature,
      input: evalCase.input,
    })
    if (result.meta) {
      totalTokens += result.meta.totalTokens
      totalCostUzs += result.meta.costUzs
    }
    if (!result.ok) {
      failures++
      console.log(`[ai-evals] FAIL ${evalCase.id}: run() failed -- ${result.error}`)
      continue
    }

    const checkError = evalCase.check?.(result.data, evalCase.input) ?? null
    if (checkError) {
      failures++
      console.log(`[ai-evals] FAIL ${evalCase.id}: ${checkError}`)
      continue
    }

    if (evalCase.determinism) {
      const first = JSON.stringify(result.data)
      let drifted = false
      for (let i = 1; i < DETERMINISM_RUNS; i++) {
        const again = await runFeature({
          provider,
          config,
          feature: evalCase.feature,
          input: evalCase.input,
        })
        if (again.meta) {
          totalTokens += again.meta.totalTokens
          totalCostUzs += again.meta.costUzs
        }
        if (!again.ok || JSON.stringify(again.data) !== first) {
          drifted = true
          break
        }
      }
      if (drifted) {
        failures++
        console.log(
          `[ai-evals] FAIL ${evalCase.id}: the same input produced different output across ${DETERMINISM_RUNS} runs at temperature 0`,
        )
        continue
      }
    }

    console.log(
      `[ai-evals] PASS ${evalCase.id} (${result.meta.totalTokens} tokens, ${result.meta.latencyMs}ms${
        evalCase.determinism ? `, deterministic over ${DETERMINISM_RUNS} runs` : ''
      })`,
    )
  }

  console.log(`[ai-evals] ${EVAL_CASES.length - failures}/${EVAL_CASES.length} passed`)
  console.log(
    `[ai-evals] ${totalTokens} tokens, ${totalCostUzs} soʻm (ceiling ${COST_CEILING_UZS})`,
  )

  if (totalCostUzs > COST_CEILING_UZS) {
    console.log(
      `[ai-evals] FAIL cost ceiling: the suite cost ${totalCostUzs} soʻm, over the ${COST_CEILING_UZS} soʻm budget`,
    )
    failures++
  }
  if (failures > 0) process.exit(1)
}

main().catch((err: unknown) => {
  console.error('[ai-evals] crashed:', err instanceof Error ? err.message : err)
  process.exit(1)
})
