import { expect, type Locator, type Page } from '@playwright/test'

/** Selection checkboxes appear on hover/focus and remain visible while selecting. */
export async function selectBoardCard(
  _page: Page,
  tile: Locator,
  _selectLabel = 'Select card',
): Promise<Locator> {
  await expect(tile).toBeVisible()
  const checkbox = tile.getByRole('checkbox')
  await checkbox.focus()
  await checkbox.check()
  await expect(checkbox).toBeChecked()
  return checkbox
}
