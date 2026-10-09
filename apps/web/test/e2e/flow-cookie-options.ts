/** Parse actual local response cookies for the plain HTTP QA cookie jar. Only Secure changes;
 * response values, domain, path, expiry, HttpOnly and SameSite remain authoritative. */
export function localResponseCookie(header: string, responseUrl: string, now = Date.now()) {
  const url = new URL(responseUrl)
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1')
    throw new Error('QA cookie adaptation requires literal HTTP loopback')
  const [first, ...attributes] = header.split(';').map((part) => part.trim())
  const equals = first?.indexOf('=') ?? -1
  if (!first || equals < 1) throw new Error('Malformed local response cookie')
  const name = first.slice(0, equals)
  const value = first.slice(equals + 1)
  let domain = url.hostname
  let path = '/'
  let sameSite: 'Strict' | 'Lax' | 'None' = 'Lax'
  let httpOnly = false
  let expires: number | undefined
  let maxAge: number | undefined
  for (const attribute of attributes) {
    const separator = attribute.indexOf('=')
    const key = (separator < 0 ? attribute : attribute.slice(0, separator)).toLowerCase()
    const attributeValue = separator < 0 ? '' : attribute.slice(separator + 1).trim()
    if (key === 'domain') {
      if (attributeValue.replace(/^\./, '') !== url.hostname)
        throw new Error('QA response cookie refused a foreign domain')
      domain = attributeValue
    } else if (key === 'path' && attributeValue) path = attributeValue
    else if (key === 'httponly') httpOnly = true
    else if (key === 'samesite') {
      const lower = attributeValue.toLowerCase()
      if (!['strict', 'lax', 'none'].includes(lower)) throw new Error('Invalid SameSite cookie')
      sameSite = lower === 'strict' ? 'Strict' : lower === 'none' ? 'None' : 'Lax'
    } else if (key === 'max-age') {
      if (!/^-?\d+$/.test(attributeValue)) throw new Error('Invalid Max-Age cookie')
      maxAge = Number(attributeValue)
    } else if (key === 'expires') {
      const date = Date.parse(attributeValue)
      if (!Number.isFinite(date)) throw new Error('Invalid Expires cookie')
      expires = date / 1000
    }
  }
  // Max-Age takes precedence over Expires in the actual HTTP cookie contract.
  if (maxAge !== undefined) expires = Math.floor(now / 1000) + maxAge
  return {
    name,
    value,
    domain,
    path,
    httpOnly,
    secure: false,
    sameSite,
    ...(expires === undefined ? {} : { expires }),
  }
}

/** Remove only a Secure attribute from actual successful allowlisted local response cookies. */
export function localSetCookieHeader(header: string): string {
  return header.replace(/;\s*Secure(?=;|\n|$)/gi, '')
}
