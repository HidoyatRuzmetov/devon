/** Card links are absolute web URLs; credentials and active/custom schemes are never links. */
export function isPlainHttpUrl(value: unknown): boolean {
  if (typeof value !== 'string') return false
  try {
    const url = new URL(value)
    return (
      (url.protocol === 'http:' || url.protocol === 'https:') &&
      url.hostname !== '' &&
      url.username === '' &&
      url.password === ''
    )
  } catch {
    return false
  }
}
