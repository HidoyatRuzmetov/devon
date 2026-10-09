/** Setup credentials are needed in memory for bootstrap, never in failed-test console output. */
export function safeFlowDiagnostics(lines: readonly string[]): string {
  return lines
    .join('\n')
    .replace(/(\/setup\?token=)[^&\s"]+/g, '$1[redacted]')
    .replace(/(postgres(?:ql)?:\/\/[^:\s]+:)[^@\s]+@/g, '$1[redacted]@')
}
