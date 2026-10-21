import { describe, expect, it } from 'vitest'
import { createUnitPalette, unitColorClass } from '../../src/lib/unit-palette.js'

describe('department unit palette', () => {
  it('resolves hash collisions for the first eight units independently of response order', () => {
    const units = Array.from({ length: 8 }, (_, i) => ({ id: `unit-${i * 8}` }))
    const palette = createUnitPalette(units)
    expect(new Set(palette.values()).size).toBe(8)
    expect([...createUnitPalette([...units].reverse())]).toEqual([...palette])
  })
  it('deduplicates unit IDs and handles departments larger than the palette without looping', () => {
    const units = Array.from({ length: 28 }, (_, i) => ({ id: `unit-${i}` }))
    const palette = createUnitPalette([...units, units[0]!])
    expect(palette.size).toBe(28)
    expect([...palette.values()].every((value) => /^bg-unit-[1-8]$/.test(value))).toBe(true)
    expect(unitColorClass(palette, units[0]!.id)).toBe(palette.get(units[0]!.id))
    expect(unitColorClass(palette, null, true)).toBe('bg-primary')
    expect(unitColorClass(palette, null)).toBe('bg-muted-foreground')
  })
})
