// Small fetch helpers shared by the `*:prove` scripts.
export function parseCookies(setCookies: string[]): Record<string, string> {
  const out: Record<string, string> = {}
  for (const line of setCookies) {
    const [pair] = line.split(';')
    const eq = pair?.indexOf('=') ?? -1
    if (pair && eq > 0) out[pair.slice(0, eq)] = pair.slice(eq + 1)
  }
  return out
}

export function cookieHeader(cookies: Record<string, string>): string {
  return Object.entries(cookies)
    .map(([k, v]) => `${k}=${v}`)
    .join('; ')
}

export function step(title: string): void {
  console.log(`\n=== ${title} ===`)
}

export function assertEqual<T>(actual: T, expected: T, label: string): void {
  if (actual !== expected) {
    throw new Error(
      `ASSERTION FAILED: ${label} -- expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    )
  }
  console.log(`  ok: ${label} = ${JSON.stringify(actual)}`)
}

export function assertTrue(actual: boolean, label: string): void {
  if (!actual) throw new Error(`ASSERTION FAILED: ${label}`)
  console.log(`  ok: ${label}`)
}
