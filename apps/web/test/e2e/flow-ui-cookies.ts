import type { BrowserContext } from '@playwright/test'
import { applySetCookies } from './flow-api.js'
import { FLOW_WEB_BASE_URL } from './flow-env.js'
import { localSetCookieHeader } from './flow-cookie-options.js'

/** WebKit rejects production Secure cookies over plain HTTP loopback. Successful real API auth
 * status/body remain unchanged; only actual cookie Secure attributes use the local fixture adapter.
 * No authentication result, credential, status or response body is manufactured. This does not
 * cover production HTTPS cookie transport, whose Secure behavior remains unchanged. */
export async function adaptLocalUiSessionCookies(context: BrowserContext): Promise<void> {
  await adaptLocalUiCookies(context, [
    '/api/v1/auth/login',
    '/api/v1/accounts/register',
    '/api/v1/accounts/2fa/login-verify',
  ])
}

/** The same production Secure-cookie boundary applies to the signed department-choice cookie. */
export async function adaptLocalUiDepartmentCookie(context: BrowserContext): Promise<void> {
  await adaptLocalUiCookies(context, ['/api/v1/me/active-department'])
}

async function adaptLocalUiCookies(
  context: BrowserContext,
  paths: readonly string[],
): Promise<void> {
  if (context.browser()?.browserType().name() !== 'webkit') return
  const local = new URL(FLOW_WEB_BASE_URL)
  if (local.protocol !== 'http:' || local.hostname !== '127.0.0.1')
    throw new Error('UI cookie adaptation is restricted to the literal local HTTP test origin')
  for (const path of paths)
    await context.route(`${FLOW_WEB_BASE_URL}${path}`, async (route) => {
      const request = route.request()
      if (request.method() !== 'POST') return route.fallback()
      const url = new URL(request.url())
      if (url.origin !== local.origin || url.pathname !== path)
        throw new Error('UI cookie adaptation refused an unexpected origin or endpoint')
      const actual = await route.fetch({ maxRedirects: 0 })
      if (!actual.ok()) return route.fulfill({ response: actual })
      await applySetCookies(context, actual)
      // Fulfilment also applies response cookies in WebKit. Leaving its original Secure flag here
      // overwrites the local jar adaptation before the immediately following /me request.
      const headers = actual.headers()
      const setCookie = headers['set-cookie']
      await route.fulfill({
        response: actual,
        headers: {
          ...headers,
          ...(setCookie ? { 'set-cookie': localSetCookieHeader(setCookie) } : {}),
        },
      })
    })
}
