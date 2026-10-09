import { expect, it } from 'vitest'
import { safeFlowDiagnostics } from '../e2e/flow-diagnostics.js'

it('keeps startup failures useful without displaying ephemeral setup or database credentials', () => {
  const output = safeFlowDiagnostics([
    'First-boot setup link (single use):',
    'http://127.0.0.1:48942/setup?token=synthetic-example-setup-token',
    'postgres://app_devon_flow_e2e:synthetic-example-password@127.0.0.1:55432/devon_flow_e2e',
    'Error: Local QA API blocked an external DNS lookup: 0.0.0.0',
  ])
  expect(output).not.toContain('synthetic-example-setup-token')
  expect(output).not.toContain('synthetic-example-password')
  expect(output).toContain('setup?token=[redacted]')
  expect(output).toContain('Local QA API blocked an external DNS lookup: 0.0.0.0')
})
