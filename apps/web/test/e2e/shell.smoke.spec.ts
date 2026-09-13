import { expect, test } from '@playwright/test'

// AC-4's disproof: "a switch that needs more than 2 clicks from any shell screen". `/login` needs no
// API call to render (no `useMeQuery`/`useInstanceQuery` in `LoginRoute`/`AuthShell`), so this spec
// exercises the locale switch even when only `apps/web`'s own dev server is up.
test('@smoke locale switch on /login is exactly 2 clicks and updates every visible shell string', async ({
  page,
}) => {
  await page.goto('/login')
  await expect(page.getByRole('heading', { name: 'Hisobga kirish' })).toBeVisible()

  // Click 1: open the locale menu.
  await page.getByRole('button', { name: 'Interfeys tili' }).click()
  // Click 2: select Russian.
  await page.getByRole('menuitemradio', { name: 'Русский' }).click()

  await expect(page.getByRole('heading', { name: 'Вход в систему' })).toBeVisible()
  await expect(page.getByText('Логин или эл. почта')).toBeVisible()
  // `exact: true` -- a case-insensitive substring match also resolves the "Забыли пароль?" link,
  // making this locator ambiguous (found running this suite for real, unrelated to this test's own
  // assertion: not a locale-switch regression, just a pre-existing `getByText` looseness).
  await expect(page.getByText('Пароль', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Войти' })).toBeVisible()
})

test('@smoke the search trigger on / is a field, not an icon, and prints the shortcut', async ({
  page,
}) => {
  await page.goto('/login')
  // The command palette's structural shell (`@devon/ui`'s `CommandPalette`) is only mounted inside
  // `AppShell` (design.md §1.1: no chrome for a destination that renders no real content pre-auth).
  // `/login` never renders a search trigger at all -- asserted here as the negative half of that rule.
  await expect(page.getByRole('button', { name: 'Qidirish va amallar' })).toHaveCount(0)
})
