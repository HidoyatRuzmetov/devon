/** Accept the invitation token itself, a copied key= token, or the supported invitation URL.
 * This only parses text locally; it never follows a URL and never changes the invitation password. */
export function normalizeInvitationKey(value: string): string {
  const input = value.trim()
  if (!input || input.length > 2048) return ''
  let key: string
  if (/^(?:https?:\/\/|\/join(?:\?|$))/i.test(input)) {
    try {
      const url = new URL(input, 'https://workportal.invalid')
      if (
        !['http:', 'https:'].includes(url.protocol) ||
        url.pathname !== '/join' ||
        url.username ||
        url.password
      )
        return ''
      key = url.searchParams.get('key') ?? ''
    } catch {
      return ''
    }
  } else if (/^key=/i.test(input)) {
    key = new URLSearchParams(input.replace(/^key=/i, 'key=')).get('key') ?? ''
  } else {
    try {
      key = decodeURIComponent(input)
    } catch {
      return ''
    }
  }
  const normalized = key.trim().toUpperCase()
  return /^[A-Z0-9]+$/.test(normalized) ? normalized : ''
}
