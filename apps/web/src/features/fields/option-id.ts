/** New labels can share a normalized slug (C++, C#), but answers must not share identities.
 * Reserve persisted IDs too: removing an option must not give its existing answers a new meaning. */
export function availableOptionId(preferred: string, reserved: Iterable<string>): string {
  const occupied = new Set(reserved)
  const base = preferred.slice(0, 60)
  let candidate = base
  let suffix = 2
  while (occupied.has(candidate)) {
    const ending = `_${suffix++}`
    candidate = `${base.slice(0, 60 - ending.length)}${ending}`
  }
  return candidate
}
