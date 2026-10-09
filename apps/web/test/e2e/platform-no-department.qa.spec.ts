/* eslint-disable no-restricted-syntax -- Locale, viewport and enlarged-text transitions inspect one account/page in order. */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import {
  authedPatch,
  examplePassword,
  loginAsSuperAdmin,
  newFlowContext,
  registerUser,
  uniqueLogin,
} from './flow-api.js'
import { setTextScale, settleCapture, waitForLoadedRoute } from './platform-capture.js'
import { assertStateCardFits } from './state-card-geometry.js'
import { THEME_STORAGE_KEY } from '../../src/lib/constants.js'

type Catalogue = {
  departments: { detail: { noDepartment: { title: string; body: string; action: string } } }
  home: { empty: { admin: { title: string; body: string; action: string } } }
}
const root = join(import.meta.dirname, '../../../..')
for (const role of ['member', 'super_admin'] as const) {
  for (const theme of ['light', 'dark']) {
    test(`@qa ${role} without membership receives its actual next step in every locale in ${theme}`, async ({
      browser,
    }) => {
      test.setTimeout(120_000)
      const context = await newFlowContext(browser)
      try {
        if (role === 'super_admin') {
          await loginAsSuperAdmin(context)
          const departments = await context.request.get('/api/v1/admin/departments?status=active')
          expect(departments.status()).toBe(200)
          expect((await departments.json()).departments.length).toBeGreaterThan(0)
        } else {
          await registerUser(context, {
            login: uniqueLogin('onboarding.empty'),
            password: examplePassword(),
            givenName: 'New',
            familyName: 'Synthetic',
          })
        }
        const me = await (await context.request.get('/api/v1/me')).json()
        expect(me.memberships).toEqual([])
        await context.addInitScript(({ key, theme }) => localStorage.setItem(key, theme), {
          key: THEME_STORAGE_KEY,
          theme,
        })
        const page = await context.newPage()
        const errors: string[] = []
        page.on('pageerror', (error) => errors.push(error.message))
        await page.emulateMedia({ reducedMotion: 'reduce' })
        for (const locale of ['en', 'ru', 'uz-Latn', 'uz-Cyrl']) {
          expect((await authedPatch(context, '/api/v1/me', { locale })).status()).toBe(200)
          const catalogue = JSON.parse(
            readFileSync(join(root, `packages/i18n/messages/${locale}.generated.json`), 'utf8'),
          ) as Catalogue
          const content =
            role === 'super_admin'
              ? catalogue.home.empty.admin
              : catalogue.departments.detail.noDepartment
          await page.goto('/')
          await expect(
            page.getByRole('heading', { name: content.title, exact: true }),
          ).toBeVisible()
          await expect(page.getByText(content.body, { exact: true })).toBeVisible()
          await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
          for (const env of [
            { width: 1440, height: 900, scale: 1 },
            { width: 320, height: 480, scale: 2 },
          ]) {
            await page.setViewportSize({ width: env.width, height: env.height })
            await setTextScale(page, env.scale)
            const action = page
              .locator('main')
              .getByRole('button', { name: content.action, exact: true })
            await expect(action).toBeVisible()
            await action.scrollIntoViewIfNeeded()
            const box = await action.boundingBox()
            expect(box).not.toBeNull()
            expect(box!.width).toBeGreaterThanOrEqual(24)
            expect(box!.height).toBeGreaterThanOrEqual(24)
            expect(
              await page.evaluate(() => document.documentElement.scrollWidth),
            ).toBeLessThanOrEqual(env.width + 1)
            await settleCapture(page)
            await page.screenshot({
              path: test.info().outputPath(`${role}-${locale}-${env.width}-text${env.scale}.png`),
              fullPage: true,
            })
            await assertStateCardFits(
              page.getByRole('heading', { name: content.title, exact: true }),
              `${role}/${locale}/${env.width}/text${env.scale}`,
            )
          }
          await page
            .locator('main')
            .getByRole('button', { name: content.action, exact: true })
            .click()
          const destination = role === 'super_admin' ? '/admin' : '/departments'
          await expect(page).toHaveURL(new RegExp(`${destination}$`))
          await waitForLoadedRoute(page, destination)
        }
        expect(errors).toEqual([])
      } finally {
        await context.close()
      }
    })
  }
}
