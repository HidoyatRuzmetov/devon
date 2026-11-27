import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

test('Interactive HTML works through production proxy headers and stays isolated', async ({
  browser,
}) => {
  const proxy = process.env['FILE_VIEWER_PROXY_URL']
  test.skip(!proxy, 'Optional production-Caddy proof against the owned Docker review stack')
  // An internal certificate is trusted only for this explicitly loopback-only test listener.
  expect(proxy).toBe('https://127.0.0.1:48944')
  const context = await browser.newContext({ baseURL: proxy!, ignoreHTTPSErrors: true })
  try {
    const account = JSON.parse(
      readFileSync(
        resolve(import.meta.dirname, '.tmp/devon_qa_onboarding_docker/file-viewer-account.json'),
        'utf8',
      ),
    )
    const signedIn = await context.request.post('/api/v1/auth/login', {
      data: { login: account.login, password: account.password },
    })
    expect(signedIn.status()).toBe(204)
    const page = await context.newPage()
    const shell = await page.goto(`/pages?page=${account.pageId}`)
    expect(shell?.headers()['x-frame-options']).toBe('DENY')
    const response = page.waitForResponse((res) => res.url().endsWith('/preview/html'))
    await page.getByRole('button', { name: 'Open Welcome.html', exact: true }).click()
    const html = await response
    expect(html.status()).toBe(200)
    expect(html.headers()['x-frame-options']).toBe('SAMEORIGIN')
    expect(html.headers()['content-security-policy']).toContain("connect-src 'none'")
    expect(html.headers()['content-security-policy']).not.toContain('allow-same-origin')
    const viewer = page.getByRole('dialog', { name: 'File viewer', exact: true })
    const frame = viewer.frameLocator('iframe')
    await frame.getByRole('button', { name: 'Show the next section', exact: true }).click()
    await expect(frame.getByRole('status')).toHaveText('The next section is open.')
    expect(await page.locator('body').getAttribute('data-preview-escaped')).toBeNull()
    await page.screenshot({
      path: resolve(
        import.meta.dirname,
        '../../../../artifacts/qa/file-viewer/production-proxy-html.png',
      ),
      animations: 'disabled',
    })
  } finally {
    await context.close()
  }
})
