/** Setup remains reachable, while direct API calls cannot bypass the newcomer requirement. */
export function allowedDuringOnboarding(path: string): boolean {
  return (
    path === '/api/v1/me' ||
    path === '/api/v1/me/active-department' ||
    path === '/api/v1/auth/logout' ||
    path.startsWith('/api/v1/accounts/') ||
    path.startsWith('/api/v1/onboarding/') ||
    path.startsWith('/api/v1/telegram/link') ||
    path === '/api/v1/telegram/status' ||
    path.startsWith('/api/v1/uploads/')
  )
}
