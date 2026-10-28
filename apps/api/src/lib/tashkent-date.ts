/** A local date independent of the API container timezone. */
export function tashkentDateString(at: Date = new Date()): string {
  return new Date(at.getTime() + 5 * 60 * 60_000).toISOString().slice(0, 10)
}
