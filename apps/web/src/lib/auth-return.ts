/** Only onboarding invitations can request an authentication return destination. Never allow
 * a foreign URL, another privileged route, or the authentication screens themselves. */
export function authReturnPath(value: string | null, fallback: string): string {
  // eslint-disable-next-line no-control-regex -- Reject literal control characters before URL normalization can remove them.
  if (!value || value.length > 2048 || !value.startsWith('/') || /[\\\u0000-\u001f]/.test(value))
    return fallback
  try {
    const parsed = new URL(value, 'https://workportal.invalid')
    if (parsed.origin !== 'https://workportal.invalid' || parsed.pathname !== '/join')
      return fallback
    const key = parsed.searchParams.get('key')
    return key ? `/join?key=${encodeURIComponent(key)}` : '/join'
  } catch {
    return fallback
  }
}

export function authEntryPath(route: '/login' | '/register', returnTo: string): string {
  return `${route}?returnTo=${encodeURIComponent(authReturnPath(returnTo, '/join'))}`
}
