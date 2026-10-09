import { expect, type Locator } from '@playwright/test'

/** Inspect actual box and glyph bounds; page-wide overflow alone misses text spilling into padding. */
export async function assertStateCardFits(heading: Locator, scenario: string): Promise<void> {
  const containment = await heading.evaluate((element) => {
    const content = element.parentElement!
    const card = content.parentElement!
    const bounds = card.getBoundingClientRect()
    const style = getComputedStyle(card)
    const left = bounds.left + parseFloat(style.borderLeftWidth) + parseFloat(style.paddingLeft)
    const right = bounds.right - parseFloat(style.borderRightWidth) - parseFloat(style.paddingRight)
    return Array.from(content.querySelectorAll('h3, p, button')).map((child) => {
      const box = child.getBoundingClientRect()
      const text = document.createRange()
      text.selectNodeContents(child)
      return {
        tag: child.tagName,
        leftOverflow: Math.max(0, left - box.left),
        rightOverflow: Math.max(0, box.right - right),
        textOverflow: Array.from(text.getClientRects()).some(
          (rect) => rect.left < left - 1 || rect.right > right + 1,
        ),
      }
    })
  })
  expect(containment, `${scenario}: actual state content`).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ tag: 'H3' }),
      expect.objectContaining({ tag: 'P' }),
      expect.objectContaining({ tag: 'BUTTON' }),
    ]),
  )
  containment.forEach((item) => {
    expect(item.leftOverflow, `${scenario}: ${JSON.stringify(item)}`).toBeLessThanOrEqual(1)
    expect(item.rightOverflow, `${scenario}: ${JSON.stringify(item)}`).toBeLessThanOrEqual(1)
    expect(item.textOverflow, `${scenario}: ${JSON.stringify(item)}`).toBe(false)
  })
}
