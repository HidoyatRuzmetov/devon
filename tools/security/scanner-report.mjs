/** Scanner output never needs to reproduce credential matches or source snippets in CI logs. */
export function scannerReport(kind, json) {
  if (kind === 'semgrep') {
    if (!Array.isArray(json.results) || !Array.isArray(json.errors))
      throw new Error('Invalid Semgrep result envelope')
    return {
      findings: json.results.map((item) => ({
        path: item.path,
        line: item.start?.line,
        rule: item.check_id,
        severity: item.extra?.severity,
      })),
      errors: json.errors.map((error) => ({
        code: error.code,
        level: error.level,
        type: Array.isArray(error.type) ? error.type[0] : error.type,
      })),
    }
  }
  if (kind !== 'trivy' || !Array.isArray(json.Results))
    throw new Error('Invalid Trivy result envelope')
  return {
    findings: json.Results.flatMap((target) => [
      ...(target.Vulnerabilities ?? []).map((item) => ({
        path: target.Target,
        rule: item.VulnerabilityID,
        package: item.PkgName,
        severity: item.Severity,
      })),
      ...(target.Secrets ?? []).map((item) => ({
        path: target.Target,
        line: item.StartLine,
        rule: item.RuleID,
        severity: item.Severity,
      })),
    ]),
    errors: [],
  }
}
