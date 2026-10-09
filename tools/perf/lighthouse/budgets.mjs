export function assessBuiltRoute(report) {
  const lcp = report.audits?.['largest-contentful-paint']?.numericValue
  const cls = report.audits?.['cumulative-layout-shift']?.numericValue
  const score = report.categories?.performance?.score
  const measured = [lcp, cls, score].every(
    (value) => typeof value === 'number' && Number.isFinite(value),
  )
  return {
    lcpMs: lcp ?? null,
    cls: cls ?? null,
    score: score ?? null,
    // HARDENING H24.1 and TECH-SPEC §1; INP requires real interaction/field evidence.
    pass: !report.runtimeError && measured && lcp < 2500 && cls < 0.1 && score >= 0.9,
  }
}
