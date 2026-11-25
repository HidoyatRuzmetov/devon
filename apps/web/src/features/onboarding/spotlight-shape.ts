export type SpotlightRect = {
  x: number
  y: number
  width: number
  height: number
}
type Point = [number, number]

/** Outline the union of the page, navigation tabs and narrow connecting corridors.
 * Rounding the resulting polygon also rounds the inward joins, not only the outside boxes. */
export function spotlightPath(input: SpotlightRect[], radius = 14): string {
  if (!input.length) return ''
  const rects = [...input]
  // Join only neighbouring, aligned regions. Distant controls remain separate islands.
  input.forEach((a, i) =>
    input.slice(i + 1).forEach((b) => {
      const left = a.x < b.x ? a : b,
        right = left === a ? b : a
      const top = a.y < b.y ? a : b,
        bottom = top === a ? b : a
      const gapX = right.x - left.x - left.width
      const overlapY = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y)
      const gapY = bottom.y - top.y - top.height
      const overlapX = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)
      if (gapX > 0 && gapX <= 48 && overlapY >= 20) {
        const y = Math.max(a.y, b.y) + (overlapY - 20) / 2
        rects.push({ x: left.x + left.width - 10, y, width: gapX + 20, height: 20 })
      } else if (gapY > 0 && gapY <= 48 && overlapX >= 20) {
        const x = Math.max(a.x, b.x) + (overlapX - 20) / 2
        rects.push({ x, y: top.y + top.height - 10, width: 20, height: gapY + 20 })
      }
    }),
  )
  const xs = [...new Set(rects.flatMap((r) => [r.x, r.x + r.width]))].sort((a, b) => a - b)
  const ys = [...new Set(rects.flatMap((r) => [r.y, r.y + r.height]))].sort((a, b) => a - b)
  const cells = ys
    .slice(0, -1)
    .map((y, j) =>
      xs
        .slice(0, -1)
        .map((x, i) =>
          rects.some(
            (r) =>
              (x + xs[i + 1]!) / 2 > r.x &&
              (x + xs[i + 1]!) / 2 < r.x + r.width &&
              (y + ys[j + 1]!) / 2 > r.y &&
              (y + ys[j + 1]!) / 2 < r.y + r.height,
          ),
        ),
    )
  const edges = new Map<string, Point>()
  const add = (a: Point, b: Point) => edges.set(a.join(','), b)
  cells.forEach((row, j) =>
    row.forEach((inside, i) => {
      if (!inside) return
      const x = xs[i]!,
        xx = xs[i + 1]!,
        y = ys[j]!,
        yy = ys[j + 1]!
      if (!cells[j - 1]?.[i]) add([x, y], [xx, y])
      if (!row[i + 1]) add([xx, y], [xx, yy])
      if (!cells[j + 1]?.[i]) add([xx, yy], [x, yy])
      if (!row[i - 1]) add([x, yy], [x, y])
    }),
  )
  const outlines: string[] = []
  while (edges.size) {
    const start = edges.keys().next().value!
    const points: Point[] = []
    let key = start
    do {
      points.push(key.split(',').map(Number) as Point)
      const next = edges.get(key)
      edges.delete(key)
      if (!next) break
      key = next.join(',')
    } while (key !== start && edges.has(key))
    outlines.push(roundOutline(points, radius))
  }
  return outlines.join(' ')
}

function roundOutline(points: Point[], radius: number) {
  const corners = points.filter((p, i) => {
    const a = points[(i + points.length - 1) % points.length]!,
      b = points[(i + 1) % points.length]!
    return (a[0] !== p[0] || p[0] !== b[0]) && (a[1] !== p[1] || p[1] !== b[1])
  })
  return (
    corners
      .map((p, i) => {
        const a = corners[(i + corners.length - 1) % corners.length]!,
          b = corners[(i + 1) % corners.length]!
        const before = Math.hypot(a[0] - p[0], a[1] - p[1]),
          after = Math.hypot(b[0] - p[0], b[1] - p[1])
        const r = Math.min(radius, before / 2, after / 2)
        const enter = [p[0] + ((a[0] - p[0]) * r) / before, p[1] + ((a[1] - p[1]) * r) / before]
        const exit = [p[0] + ((b[0] - p[0]) * r) / after, p[1] + ((b[1] - p[1]) * r) / after]
        return `${i ? 'L' : 'M'}${enter.join(' ')} Q${p.join(' ')} ${exit.join(' ')}`
      })
      .join(' ') + ' Z'
  )
}
