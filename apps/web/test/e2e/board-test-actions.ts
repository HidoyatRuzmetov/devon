import { expect, type Locator, type Page } from '@playwright/test'

/** Idle cards enter selection through their actions menu. Once selection is active, native
 * checkboxes extend it without repeatedly opening menus. Exercise both real user paths. */
export async function selectBoardCard(
  page: Page,
  tile: Locator,
  selectLabel = 'Select card',
): Promise<Locator> {
  await expect(tile).toBeVisible()
  const checkbox = tile.getByRole('checkbox')
  if ((await checkbox.count()) > 0) {
    await checkbox.check()
  } else {
    await tile.locator('button[aria-haspopup="menu"]').click()
    await page.getByRole('menuitem', { name: selectLabel, exact: true }).click()
  }
  await expect(checkbox).toBeChecked()
  return checkbox
}
