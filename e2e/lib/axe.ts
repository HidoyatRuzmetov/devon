// axe integration (this item's handoff: "axe zero serious/critical on every route in routes.json";
// `agentic/gates.json`'s `a11y_blocking_impacts: ["serious", "critical"]`, I-12). Wraps
// `@axe-core/playwright` so every call site filters and formats violations the same way.
import AxeBuilder from '@axe-core/playwright'
import type { Page } from '@playwright/test'
import type { Result } from 'axe-core'

export const BLOCKING_IMPACTS = ['serious', 'critical'] as const

export interface AxeSummary {
  blocking: Result[]
  all: Result[]
}

export async function scanForBlockingViolations(page: Page): Promise<AxeSummary> {
  const results = await new AxeBuilder({ page }).analyze()
  const blocking = results.violations.filter(
    (v) => v.impact && (BLOCKING_IMPACTS as readonly string[]).includes(v.impact),
  )
  return { blocking, all: results.violations }
}

export function formatViolations(violations: readonly Result[]): string {
  return violations
    .map((v) => {
      const nodes = v.nodes.map((n) => n.target.join(' ')).join(', ')
      return `[${v.impact}] ${v.id}: ${v.help} -- ${nodes}`
    })
    .join('\n')
}
