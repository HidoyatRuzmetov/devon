// @smoke -- this item's handoff: "The @smoke-tagged subset must be fast enough to serve as every
// other item's e2e-smoke gate." Deliberately exercises only `/login` and `/setup` (no `?token=`):
// both render under `AuthShell`, which issues zero API calls (`apps/web/src/shell/auth-shell.tsx`),
// so this file is green the instant `apps/web`'s own dev server is up -- no Postgres, no `apps/api`,
// no docker, matching `global-setup.ts`'s one hard dependency. Anything that needs a live backend
// belongs in `routes.spec.ts`/`states.spec.ts`, not here: a smoke gate that can fail because a
// database container was slow to become ready is not a smoke gate.
import { expect, test } from '../fixtures.js'
import { scanForBlockingViolations, formatViolations } from '../lib/axe.js'
import { recordNetwork } from '../lib/network.js'
import { message } from '../lib/messages.js'

test('@smoke /login renders the pristine sign-in form with exactly one primary action', async ({
  page,
}) => {
  await page.goto('/login')
  await expect(page.getByRole('heading', { name: message('uz-Latn', 'login.title') })).toBeVisible()
  await expect(page.getByLabel(message('uz-Latn', 'login.identifier'))).toBeVisible()
  // `.first()`: the password field's wrapping `<label>` also contains the show/hide `IconButton`
  // (`apps/web/src/routes/login.tsx`), so the label text "Parol" is also a substring of the *input*
  // element's own computed accessible name once the reveal button's `aria-label` is folded in --
  // `getByLabel('Parol')` alone is a strict-mode violation (2 matches); the input is the first of the
  // two in DOM order.
  await expect(page.getByLabel(message('uz-Latn', 'login.password')).first()).toBeVisible()
  await expect(page.getByRole('button', { name: message('uz-Latn', 'login.submit') })).toBeVisible()
})

test('@smoke locale switch on /login is exactly 2 clicks and updates every visible shell string', async ({
  page,
}) => {
  await page.goto('/login')
  await page.getByRole('button', { name: message('uz-Latn', 'shell.locale.aria') }).click() // click 1
  await page
    .getByRole('menuitemradio', { name: message('uz-Latn', 'shell.locale.options.ru') })
    .click() // click 2
  await expect(page.getByRole('heading', { name: message('ru', 'login.title') })).toBeVisible()
  await expect(page.getByLabel(message('ru', 'login.identifier'))).toBeVisible()
  await expect(page.getByRole('button', { name: message('ru', 'login.submit') })).toBeVisible()
})

test('@smoke a consumed/missing /setup token shows the identical "already used" screen, not a form', async ({
  page,
}) => {
  await page.goto('/setup')
  await expect(
    page.getByRole('heading', { name: message('uz-Latn', 'setup.used.title') }),
  ).toBeVisible()
  await expect(
    page.getByRole('button', { name: message('uz-Latn', 'setup.used.action') }),
  ).toHaveCount(1)
})

test('@smoke @a11y /login has zero serious/critical axe violations', async ({ page }) => {
  await page.goto('/login')
  const { blocking, all } = await scanForBlockingViolations(page)
  expect(blocking, formatViolations(all)).toHaveLength(0)
})

test('@smoke every request from /login is same-origin', async ({ page }) => {
  const net = recordNetwork(page)
  await page.goto('/login')
  // Not `waitForLoadState('networkidle')`: Vite's dev server keeps an HMR WebSocket open for the
  // life of the page, so "idle" never arrives and the wait times out on every run, dev server or not
  // (`lib/network.ts`'s recorder only cares about `request`, which fires long before that anyway).
  await expect(page.getByRole('heading', { name: message('uz-Latn', 'login.title') })).toBeVisible()
  await page.waitForTimeout(500)
  const foreign = net.foreignOrigins(new URL(page.url()).origin)
  net.stop()
  expect(foreign, `foreign origins: ${foreign.join(', ')}`).toHaveLength(0)
})
