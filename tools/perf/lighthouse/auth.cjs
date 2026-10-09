// Lighthouse CI `--puppeteerScript` (H24.1 baseline): all six main routes require a signed-in
// session, so before each Lighthouse pass we sign in as demo.boshliq using the SAME puppeteer
// `browser` instance Lighthouse itself then drives -- the session cookie set here survives because
// it is one non-incognito browser profile for the whole `lhci collect` invocation.
// Signature required by @lhci/cli's PuppeteerScript type: (browser, {url, options}) => Promise<void>.
module.exports = async (browser, { url }) => {
  const DEMO_USER = process.env.DEVON_PERF_USER || 'demo.boshliq'
  const DEMO_PASSWORD = process.env.DEVON_PERF_PASSWORD || 'Ishonchli#2026'
  const origin = new URL(url).origin

  const page = await browser.newPage()
  try {
    // Idempotent: `invokePuppeteerScriptForUrl` runs once per URL, and lhci may collect >1 run per
    // URL -- skip the login flow entirely if the session is already live.
    const me = await page.goto(`${origin}/api/v1/me`, {
      waitUntil: 'domcontentloaded',
      timeout: 15000,
    })
    if (me && me.ok()) return

    await page.goto(`${origin}/login`, { waitUntil: 'networkidle2', timeout: 30000 })
    await page.waitForSelector('input[name="identifier"]', { timeout: 15000 })
    await page.type('input[name="identifier"]', DEMO_USER)
    await page.type('input[name="password"]', DEMO_PASSWORD)
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 }),
      page.click('button[type="submit"]'),
    ])
    const authenticated = await page.goto(`${origin}/api/v1/me`, {
      waitUntil: 'domcontentloaded',
      timeout: 15000,
    })
    if (!authenticated || !authenticated.ok())
      throw new Error('Local performance authentication did not establish a real session')
  } finally {
    await page.close()
  }
}
