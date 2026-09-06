// canonicalJson: keys sorted ascending, no whitespace, UTF-8 (design.md §1.9). This is deliberately
// narrow -- it is only ever called on the fixed, flat shape {v, command, nonce, issued_at} that the
// wire contract signs, never on arbitrary input. A general-purpose canonicalizer (nested objects,
// arrays, number formatting edge cases) is more code than this service will ever need.
export function canonicalJson(fields) {
  const keys = Object.keys(fields).sort()
  const parts = keys.map((k) => `${JSON.stringify(k)}:${JSON.stringify(fields[k])}`)
  return `{${parts.join(',')}}`
}
