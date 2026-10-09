import { expect, test } from '@playwright/test'
import {
  authedPatch,
  examplePassword,
  newFlowContext,
  registerUser,
  uniqueLogin,
} from './flow-api.js'
import { THEME_STORAGE_KEY } from '../../src/lib/constants.js'
import { settleCapture, waitForLoadedRoute } from './platform-capture.js'

test('@qa system theme follows browser media changes while explicit preference survives them and reload', async ({
  browser,
}) => {
  const context = await newFlowContext(browser)
  try {
    await registerUser(context, {
      login: uniqueLogin('theme.system'),
      password: examplePassword(),
      givenName: 'Theme',
      familyName: 'Synthetic',
    })
    expect((await authedPatch(context, '/api/v1/me', { locale: 'en' })).status()).toBe(200)
    const page = await context.newPage()
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' })
    await page.goto('/')
    await waitForLoadedRoute(page, '/')
    const root = page.locator('html')
    const toggle = page.getByRole('button', { name: 'Switch theme', exact: true })
    const preference = () => page.evaluate((key) => localStorage.getItem(key), THEME_STORAGE_KEY)
    await expect(root).toHaveAttribute('data-theme', 'light')
    // Native keyboard cycles the existing control: light -> dark -> system.
    await toggle.focus()
    await toggle.press('Enter')
    await expect.poll(preference).toBe('dark')
    await expect(root).toHaveAttribute('data-theme', 'dark')
    await toggle.press('Space')
    await expect.poll(preference).toBe('system')
    await expect(root).toHaveAttribute('data-theme', 'light')
    await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' })
    await expect(root).toHaveAttribute('data-theme', 'dark')
    await expect.poll(preference).toBe('system')
    await settleCapture(page, false)
    await page.screenshot({ path: test.info().outputPath('system-dark.png') })
    await page.reload()
    await waitForLoadedRoute(page, '/')
    await expect(root).toHaveAttribute('data-theme', 'dark')
    await expect.poll(preference).toBe('system')
    await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' })
    await expect(root).toHaveAttribute('data-theme', 'light')
    await settleCapture(page, false)
    await page.screenshot({ path: test.info().outputPath('system-light.png') })
    await toggle.click() // system -> explicit light
    await expect.poll(preference).toBe('light')
    await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' })
    await expect(root).toHaveAttribute('data-theme', 'light')
    await page.reload()
    await waitForLoadedRoute(page, '/')
    await expect(root).toHaveAttribute('data-theme', 'light')
    await expect.poll(preference).toBe('light')
    expect(errors).toEqual([])
    await test.info().attach('theme-environment-boundary', {
      body: JSON.stringify(
        {
          colorScheme: 'browser media emulation, not a physical OS change',
          reducedMotion: 'reduce',
          locale: 'en',
          viewport: page.viewportSize(),
          persisted: 'light',
          errors,
        },
        null,
        2,
      ),
      contentType: 'application/json',
    })
  } finally {
    await context.close()
  }
})
