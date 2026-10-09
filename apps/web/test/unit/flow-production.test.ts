import { describe, expect, it } from 'vitest'
import {
  FLOW_DEV_ONLY_FIXTURE_FILES,
  flowTestIgnore,
  flowWebCommand,
  type ProductionBuildReceipt,
} from '../e2e/flow-production.js'

const sourceHash = 'a'.repeat(64)
const receipt: ProductionBuildReceipt = {
  stable: true,
  inputsBefore: sourceHash,
  inputsAfter: sourceHash,
  forcedStateBuildFlag: false,
}

describe('supported built browser runner boundary', () => {
  it('retains all dev cases and excludes only the exact Vite-only fixture files in preview', () => {
    expect(flowTestIgnore(false)).toEqual([])
    expect(FLOW_DEV_ONLY_FIXTURE_FILES).toEqual([
      'avatar-readability.flow.spec.ts',
      'badge-contrast.flow.spec.ts',
      'dialog-scroll.flow.spec.ts',
    ])
    expect(flowTestIgnore(true)).toEqual([
      '**/avatar-readability.flow.spec.ts',
      '**/badge-contrast.flow.spec.ts',
      '**/dialog-scroll.flow.spec.ts',
    ])
  })
  it('preserves ordinary dev behavior without requiring a build receipt', () => {
    expect(flowWebCommand(false)).toBe('pnpm --filter @devon/web dev --mode test')
  })
  it('selects production preview only for the current stable non-forced build', () => {
    expect(flowWebCommand(true, receipt, sourceHash)).toBe(
      'pnpm --filter @devon/web preview --mode test',
    )
  })
  it('refuses missing, unstable, forced-state and stale build receipts', () => {
    expect(() => flowWebCommand(true)).toThrow('production input receipt')
    for (const change of [
      { stable: false },
      { forcedStateBuildFlag: true },
      { inputsBefore: 'invalid' },
      { inputsAfter: 'b'.repeat(64) },
    ])
      expect(() => flowWebCommand(true, { ...receipt, ...change }, sourceHash)).toThrow(
        'production input receipt',
      )
    expect(() => flowWebCommand(true, receipt, 'c'.repeat(64))).toThrow('production input receipt')
  })
})
