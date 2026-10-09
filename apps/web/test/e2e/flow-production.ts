export type ProductionBuildReceipt = {
  stable: boolean
  inputsBefore: string
  inputsAfter: string
  forcedStateBuildFlag: boolean
}

/** These component fixtures inject TSX through Vite's development-only /@fs endpoint. The full
 * default dev gate runs all four cases; built verification retains every ordinary app flow. */
export const FLOW_DEV_ONLY_FIXTURE_FILES = [
  'avatar-readability.flow.spec.ts',
  'badge-contrast.flow.spec.ts',
  'dialog-scroll.flow.spec.ts',
] as const

export function flowTestIgnore(production: boolean): string[] {
  return production ? FLOW_DEV_ONLY_FIXTURE_FILES.map((file) => `**/${file}`) : []
}

/** The ordinary CI runner stays on dev. Explicit built-browser verification refuses stale or
 * forced-state artifacts before starting either owned test service. */
export function flowWebCommand(
  production: boolean,
  receipt?: ProductionBuildReceipt,
  currentInputs?: string,
): string {
  if (!production) return 'pnpm --filter @devon/web dev --mode test'
  if (
    !receipt ||
    receipt.stable !== true ||
    receipt.forcedStateBuildFlag !== false ||
    !/^[a-f0-9]{64}$/.test(receipt.inputsBefore) ||
    receipt.inputsBefore !== receipt.inputsAfter ||
    receipt.inputsAfter !== currentInputs
  )
    throw new Error('Built browser flows require a stable current production input receipt')
  return 'pnpm --filter @devon/web preview --mode test'
}
