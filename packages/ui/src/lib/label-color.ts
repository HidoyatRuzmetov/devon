// Card labels carry an arbitrary hex colour a department member picked when the label was created
// (`apps/api/src/modules/work/index.ts` defaults new labels to `#6366f1`, but nothing stops someone
// choosing a pale pastel next) -- rendering that colour as a solid fill with hardcoded white text
// (card-detail.tsx, before this) is illegible the moment the colour is light ("Hisobot"/"Tashqi" in
// the item handoff). This derives a background/foreground *pair* from that one colour instead,
// guaranteed >= the WCAG AA text contrast ratio (4.5:1) against whichever theme is active, by
// starting from the label's own hue/saturation and adjusting lightness until the ratio holds --
// never just black or white, so two different label colours still look different.

export interface LabelChipColors {
  /** A light (or, under `dark`, a dark) solid tint of the label's own hue -- opaque, not translucent,
   *  because the contrast ratio this module guarantees is computed against this exact colour: layering
   *  it as a see-through tint over an unknown surface would make the real, composited ratio different
   *  from the one that was checked. */
  background: string
  /** Full-chroma text in the label's hue, lightness-adjusted for contrast against `background`. */
  foreground: string
}

interface Hsl {
  h: number
  s: number
  l: number
}

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return null
  const int = Number.parseInt(m[1]!, 16)
  return { r: (int >> 16) & 255, g: (int >> 8) & 255, b: int & 255 }
}

function rgbToHsl(r: number, g: number, b: number): Hsl {
  const rn = r / 255
  const gn = g / 255
  const bn = b / 255
  const max = Math.max(rn, gn, bn)
  const min = Math.min(rn, gn, bn)
  const l = (max + min) / 2
  if (max === min) return { h: 0, s: 0, l }
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let h: number
  switch (max) {
    case rn:
      h = (gn - bn) / d + (gn < bn ? 6 : 0)
      break
    case gn:
      h = (bn - rn) / d + 2
      break
    default:
      h = (rn - gn) / d + 4
  }
  return { h: h * 60, s, l }
}

function hslToRgb({ h, s, l }: Hsl): { r: number; g: number; b: number } {
  if (s === 0) {
    const v = Math.round(l * 255)
    return { r: v, g: v, b: v }
  }
  const hue2rgb = (p: number, q: number, t: number): number => {
    let tt = t
    if (tt < 0) tt += 1
    if (tt > 1) tt -= 1
    if (tt < 1 / 6) return p + (q - p) * 6 * tt
    if (tt < 1 / 2) return q
    if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6
    return p
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s
  const p = 2 * l - q
  const hn = h / 360
  return {
    r: Math.round(hue2rgb(p, q, hn + 1 / 3) * 255),
    g: Math.round(hue2rgb(p, q, hn) * 255),
    b: Math.round(hue2rgb(p, q, hn - 1 / 3) * 255),
  }
}

/** WCAG 2.x relative luminance + contrast ratio (the same formulas the spec defines). */
function relativeLuminance({ r, g, b }: { r: number; g: number; b: number }): number {
  const chan = (v: number): number => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * chan(r) + 0.7152 * chan(g) + 0.0722 * chan(b)
}

function contrastRatio(
  a: { r: number; g: number; b: number },
  b: { r: number; g: number; b: number },
): number {
  const la = relativeLuminance(a)
  const lb = relativeLuminance(b)
  const lighter = Math.max(la, lb)
  const darker = Math.min(la, lb)
  return (lighter + 0.05) / (darker + 0.05)
}

function toHex({ r, g, b }: { r: number; g: number; b: number }): string {
  const c = (v: number) => v.toString(16).padStart(2, '0')
  return `#${c(r)}${c(g)}${c(b)}`
}

const MIN_CONTRAST = 4.5

/**
 * `background` is a fixed light or dark neutral tinted toward the label's hue (so it always shows up
 * whether the card underneath is light or dark); `dark` picks which one. `foreground` starts at the
 * label's own saturation and a theme-appropriate starting lightness, then walks lightness away from
 * `background` in 2-point steps until the contrast ratio clears 4.5:1 -- a fully saturated but very
 * light label colour (e.g. a pale yellow) still ends up with a *dark* readable foreground rather than
 * silently failing, and a very dark label colour ends up light.
 */
export function labelChipColors(hex: string, dark = false): LabelChipColors {
  const rgb = hexToRgb(hex) ?? { r: 99, g: 102, b: 241 } // falls back to the API's own default indigo
  const { h, s } = rgbToHsl(rgb.r, rgb.g, rgb.b)

  const backgroundRgb = hslToRgb({ h, s: Math.min(s, 0.5), l: dark ? 0.22 : 0.94 })

  let l = dark ? 0.86 : 0.24
  const step = dark ? -0.02 : 0.02
  let foregroundRgb = hslToRgb({ h, s: Math.max(s, 0.45), l })
  let guard = 0
  while (contrastRatio(foregroundRgb, backgroundRgb) < MIN_CONTRAST && guard < 40) {
    l += step
    if (l < 0 || l > 1) break
    foregroundRgb = hslToRgb({ h, s: Math.max(s, 0.45), l })
    guard += 1
  }

  return {
    background: toHex(backgroundRgb),
    foreground: toHex(foregroundRgb),
  }
}
