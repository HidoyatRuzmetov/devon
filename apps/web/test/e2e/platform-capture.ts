import { expect, type Page } from '@playwright/test'

/** The app uses px typography tokens. Scale actual type/line heights while preserving spacing and
 * icons; a root font-size change alone would not exercise 200% text enlargement here. */
export async function setTextScale(page: Page, scale: number): Promise<void> {
  await page.evaluate((factor) => {
    const root = document.documentElement
    const names = ['eyebrow', 'caption', 'small', 'body', 'lead', 'h3', 'h2', 'h1', 'hero'].flatMap(
      (name) => [`--text-${name}`, `--text-${name}--line-height`],
    )
    for (const name of names) root.style.removeProperty(name)
    const computed = getComputedStyle(root)
    const values = names.map((name) => ({
      name,
      value: parseFloat(computed.getPropertyValue(name)),
    }))
    for (const { name, value } of values)
      if (Number.isFinite(value)) root.style.setProperty(name, `${value * factor}px`)
  }, scale)
}

/** Wait for the actual route and queries; a lazy-route or data skeleton is not a loaded screen. */
export async function waitForLoadedRoute(page: Page, path: string): Promise<void> {
  await expect(page.locator('main')).toBeVisible()
  await expect
    .poll(
      async () =>
        page.locator('main').evaluate((main) => {
          const visible = (e: Element) => {
            const rect = e.getBoundingClientRect()
            return rect.width > 0 && rect.height > 0
          }
          return (
            [...main.querySelectorAll('h1, h2, h3')].some(visible) &&
            ![...main.querySelectorAll('[aria-busy="true"], .devon-shimmer')].some(visible)
          )
        }),
      { message: `${path}: loaded route content without skeletons` },
    )
    .toBe(true)
  await page.evaluate(() => document.fonts.ready)
}

/** Exercise actual scrolling so on-view entrances/lazy images can appear in a full-page capture. */
export async function settleCapture(page: Page, fullPage = true): Promise<void> {
  await page.evaluate(async (scrollPage) => {
    const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
    if (scrollPage) {
      let passes = 0
      for (
        let y = 0;
        y < document.documentElement.scrollHeight;
        y += Math.max(1, innerHeight * 0.75)
      ) {
        if (++passes > 200) throw new Error('Page keeps extending during full-page capture')
        window.scrollTo({ top: y, behavior: 'instant' })
        await frame()
        await frame()
      }
      window.scrollTo({ top: 0, behavior: 'instant' })
    }
    await frame()
    await frame()
  }, fullPage)
  await expect
    .poll(
      () =>
        page.evaluate(
          () =>
            document.getAnimations().filter((animation) => {
              const timing = animation.effect?.getComputedTiming()
              // Ambient loops are inspected separately; an entrance/crossfade must actually finish.
              return timing?.iterations !== Infinity && animation.playState === 'running'
            }).length,
        ),
      { message: 'finite entrance animations settled before capture' },
    )
    .toBe(0)
  await expect
    .poll(
      () =>
        page.locator('main [data-devon-entrance]').evaluateAll(
          (elements) =>
            elements.filter((element) => {
              const rect = element.getBoundingClientRect()
              return (
                rect.width > 0 &&
                rect.height > 0 &&
                Number(getComputedStyle(element).opacity) < 0.99
              )
            }).length,
        ),
      { message: 'visible entrance content reached its readable state' },
    )
    .toBe(0)
}
