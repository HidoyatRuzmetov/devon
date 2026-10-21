/** The model never supplies navigation. Only same-origin paths from validated citations can
 * become links; reject protocol-relative URLs and slash/control-character normalization tricks. */
export function chatSourceHref(href: string, conversationId?: string): string | null {
  if (
    !href.startsWith('/') ||
    href.startsWith('//') ||
    href.includes('\\') ||
    [...href].some((char) => char.charCodeAt(0) <= 32)
  )
    return null
  try {
    const url = new URL(href, 'https://workportal.invalid')
    if (url.origin !== 'https://workportal.invalid') return null
    url.searchParams.set('from', 'overview')
    if (
      conversationId &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        conversationId,
      )
    )
      url.searchParams.set('conversation', conversationId)
    return `${url.pathname}${url.search}${url.hash}`
  } catch {
    return null
  }
}
