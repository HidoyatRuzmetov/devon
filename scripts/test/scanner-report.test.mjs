import assert from 'node:assert/strict'
import test from 'node:test'
import { scannerReport } from '../../tools/security/scanner-report.mjs'

test('Semgrep reports retain rule and source location without raw source or error data', () => {
  const report = scannerReport('semgrep', {
    results: [
      {
        path: 'source.ts',
        start: { line: 12 },
        check_id: 'blocking-rule',
        extra: { severity: 'ERROR', lines: 'synthetic credential match' },
      },
    ],
    errors: [{ code: 2, level: 'error', type: 'ParseError', message: 'synthetic private data' }],
  })
  assert.equal(report.findings.length, 1)
  assert.equal(report.findings[0].rule, 'blocking-rule')
  assert.equal(report.findings[0].line, 12)
  assert.equal(report.errors.length, 1)
  assert.equal(JSON.stringify(report).includes('synthetic'), false)
})

test('Trivy reports keep vulnerability and secret findings while discarding raw matches', () => {
  const report = scannerReport('trivy', {
    Results: [
      {
        Target: 'current/source.ts',
        Vulnerabilities: [{ VulnerabilityID: 'CVE-fixture', PkgName: 'fixture', Severity: 'HIGH' }],
        Secrets: [
          {
            RuleID: 'fixture-private-key',
            StartLine: 3,
            Severity: 'HIGH',
            Match: 'synthetic private match',
          },
        ],
      },
    ],
  })
  assert.equal(report.findings.length, 2)
  assert.deepEqual(
    report.findings.map((finding) => finding.rule),
    ['CVE-fixture', 'fixture-private-key'],
  )
  assert.equal(JSON.stringify(report).includes('synthetic'), false)
})

test('invalid scanner output fails closed and an actual clean envelope remains empty', () => {
  assert.throws(() => scannerReport('semgrep', {}), /Invalid/)
  assert.throws(() => scannerReport('trivy', {}), /Invalid/)
  assert.deepEqual(scannerReport('semgrep', { results: [], errors: [] }), {
    findings: [],
    errors: [],
  })
  assert.deepEqual(scannerReport('trivy', { Results: [] }), { findings: [], errors: [] })
})
