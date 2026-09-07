import { describe, expect, it } from 'vitest'
import { labelChipColors } from './label-color.js'

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const int = Number.parseInt(hex.slice(1), 16)
  return { r: (int >> 16) & 255, g: (int >> 8) & 255, b: int & 255 }
}

function relativeLuminance({ r, g, b }: { r: number; g: number; b: number }): number {
  const chan = (v: number) => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * chan(r) + 0.7152 * chan(g) + 0.0722 * chan(b)
}

function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(hexToRgb(a))
  const lb = relativeLuminance(hexToRgb(b))
  const lighter = Math.max(la, lb)
  const darker = Math.min(la, lb)
  return (lighter + 0.05) / (darker + 0.05)
}

// Real label colours from the demo seed plus the pale ones the item handoff called out by name
// ("Hisobot"/"Tashqi" were "effectively illegible" -- pastel fills with hardcoded white text).
const SAMPLE_COLOURS = [
  '#6366f1', // API default indigo
  '#fde68a', // pale yellow -- the pastel-with-white-text failure mode
  '#fbcfe8', // pale pink
  '#052e16', // near-black green
  '#ffffff', // white
  '#000000', // black
  '#22c55e', // saturated green
  '#ef4444', // saturated red
  '#38bdf8', // light blue
]

describe('labelChipColors', () => {
  it.each(SAMPLE_COLOURS)('meets WCAG AA (>= 4.5:1) in light mode for %s', (hex) => {
    const { background, foreground } = labelChipColors(hex, false)
    expect(contrastRatio(background, foreground)).toBeGreaterThanOrEqual(4.5)
  })

  it.each(SAMPLE_COLOURS)('meets WCAG AA (>= 4.5:1) in dark mode for %s', (hex) => {
    const { background, foreground } = labelChipColors(hex, true)
    expect(contrastRatio(background, foreground)).toBeGreaterThanOrEqual(4.5)
  })

  it('produces visibly different colours for two different hues', () => {
    const a = labelChipColors('#ef4444', false)
    const b = labelChipColors('#38bdf8', false)
    expect(a.background).not.toBe(b.background)
    expect(a.foreground).not.toBe(b.foreground)
  })

  it('falls back to the API default indigo for a malformed colour', () => {
    const { background, foreground } = labelChipColors('not-a-colour', false)
    expect(contrastRatio(background, foreground)).toBeGreaterThanOrEqual(4.5)
  })
})
