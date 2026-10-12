// Department request drafts use sRGB hex; Structure stores the eight categorical OKLCH hues from
// packages/ui/src/styles/tokens.css. Keep the nearest perceived hue, without persisting raw colours.
// Linear-sRGB -> Oklab matrix: Björn Ottosson's public-domain implementation,
// https://bottosson.github.io/posts/oklab/#converting-from-linear-srgb-to-oklab
export function requestedUnitColour(hex: string | undefined): number | null {
  if (!hex || !/^#[0-9a-f]{6}$/i.test(hex)) return null
  const channel = (offset: number) => {
    const value = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  }
  const red = channel(1)
  const green = channel(3)
  const blue = channel(5)
  const l = Math.cbrt(0.4122214708 * red + 0.5363325363 * green + 0.0514459929 * blue)
  const m = Math.cbrt(0.2119034982 * red + 0.6806995451 * green + 0.1073969566 * blue)
  const s = Math.cbrt(0.0883024619 * red + 0.2817188376 * green + 0.6299787005 * blue)
  const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s
  const b = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s
  // Neutral colours have no meaningful hue; use Structure's stable automatic category.
  if (Math.hypot(a, b) < 0.00001) return null
  const hue = (Math.atan2(b, a) * 180) / Math.PI
  const hues = [20, 65, 110, 155, 200, 245, 290, 335]
  const distances = hues.map((candidate) => Math.abs(((hue - candidate + 540) % 360) - 180))
  return distances.indexOf(Math.min(...distances)) + 1
}
