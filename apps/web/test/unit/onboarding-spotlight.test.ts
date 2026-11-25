import { expect, it } from 'vitest'
import { spotlightPath } from '../../src/features/onboarding/spotlight-shape.js'

it('keeps distant navigation and detail panels as two independent highlights', () => {
  const path = spotlightPath([
    { x: 850, y: 70, width: 570, height: 900 },
    { x: 12, y: 250, width: 240, height: 44 },
  ])
  expect(path.match(/M/g)).toHaveLength(2)
  expect(path).not.toMatch(/NaN|Infinity/)
})
it('rounds a short join between an adjacent tab and its page', () => {
  const path = spotlightPath([
    { x: 289, y: 70, width: 1100, height: 900 },
    { x: 12, y: 250, width: 240, height: 44 },
  ])
  expect(path.match(/M/g)).toHaveLength(1)
  expect(path.match(/Q/g)!.length).toBeGreaterThan(4)
})
it('keeps an overlaid profile panel and its page in one outline without losing a distant tab', () => {
  const path = spotlightPath([
    { x: 850, y: 70, width: 570, height: 900 },
    { x: 12, y: 20, width: 240, height: 44 },
    { x: 289, y: 100, width: 1100, height: 700 },
  ])
  expect(path.match(/M/g)).toHaveLength(2)
})
