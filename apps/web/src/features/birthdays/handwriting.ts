import glyphData from './assets/allure-glyphs.json'

const glyphs: Record<string, { advance: number; path: string }> = glyphData
export type InkStroke = { path: string; x: number; y: number; scale: number }

export function normalizeLetterPunctuation(text: string) {
  return text
    .replace(/[‘’ʼʻ]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/…/g, '...')
    .replace(/\u00a0/g, ' ')
}

/** Real open stroke glyphs, including pen lifts. Nothing traces a typeface's outer contour. */
export function layoutLetter(message: string, width: number) {
  const strokes: InkStroke[] = []
  const compact = width < 430
  let y = compact ? 25 : 36
  function paragraph(text: string, size: number, indent = 0) {
    const scale = size / 1000
    const space = glyphs[' ']!.advance * scale
    const lineHeight = size * 1.08
    let x = indent
    for (const word of text.split(/\s+/)) {
      const characters = [...word]
      const wordWidth = characters.reduce(
        (sum, character) => sum + (glyphs[character]?.advance ?? glyphs['?']!.advance) * scale,
        0,
      )
      if (x > indent && x + wordWidth > width - 18) {
        y += lineHeight
        x = indent
      }
      for (const character of characters) {
        const glyph = glyphs[character] ?? glyphs['?']!
        for (const path of glyph.path.split(/(?=M)/).filter(Boolean))
          strokes.push({ path, x, y, scale })
        x += glyph.advance * scale
      }
      x += space
    }
    y += lineHeight
    return { end: x - space, baseline: y - lineHeight }
  }
  paragraph(normalizeLetterPunctuation(message), compact ? 27 : 45)
  y += compact ? 10 : 18
  const wishes = paragraph('With warm wishes,', compact ? 26 : 41)
  const signature = paragraph('From the team', compact ? 30 : 50)
  const sealSize = compact ? 64 : 88
  const seal = {
    left: Math.min(width - sealSize, Math.max(wishes.end, signature.end) + (compact ? 14 : 28)),
    top: signature.baseline - sealSize * 0.72,
    size: sealSize,
  }
  return { strokes, height: Math.max(signature.baseline + 12, seal.top + seal.size) + 12, seal }
}
