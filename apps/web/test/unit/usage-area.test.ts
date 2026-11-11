import { describe, expect, it } from 'vitest'
import { stackUsageAreas, usageAreaSamples } from '../../src/features/admin/usage-area.js'
import { usageBuckets, type UsageCounts } from '../../src/features/admin/usage-series.js'

const depts = [{ id: 'operations' }, { id: 'delivery' }]
function buckets(rows: number[][]) {
  return rows.map((row) => ({
    values: new Map<string, UsageCounts>(
      row.map((tokens, i) => [depts[i]!.id, { tokens, costUzs: tokens * 2, runs: 1 }]),
    ),
  }))
}
const center = (i: number, count: number) => ((i + 0.5) * (usageAreaSamples - 1)) / count

describe('monotone stacked usage areas', () => {
  it('joins the flat edges of a two-observation series with a smooth cubic', () => {
    const top = stackUsageAreas(buckets([[0], [100]]), [depts[0]!], 'tokens', 100)[0]!.top
    // One-quarter and three-quarters of the distance between the two bucket centers.
    expect(top[72]).toBe(84.375)
    expect(top[120]).toBe(15.625)
    expect(top[96]).toBe(50)
  })

  it('places observations at bucket centers and holds the first and last values to the edges', () => {
    const series = usageBuckets([], { from: 0, to: 0 }, [
      { hour: 0, departmentId: 'operations', tokens: 40, costUzs: 10, runs: 1 },
      { hour: 0, departmentId: 'delivery', tokens: 20, costUzs: 5, runs: 1 },
      { hour: 23, departmentId: 'delivery', tokens: 60, costUzs: 15, runs: 2 },
    ])
    const [first, second] = stackUsageAreas(series, depts, 'tokens', 100)
    expect(first!.top).toHaveLength(193)
    expect(first!.id).toBe('operations')
    expect(second!.id).toBe('delivery')
    for (let i = 0; i < 24; i++) {
      expect(first!.top[center(i, 24)]).toBe(i === 0 ? 60 : 100)
      expect(second!.top[center(i, 24)]).toBe(i === 0 || i === 23 ? 40 : 100)
    }
    expect(first!.top.slice(0, 5)).toEqual(Array(5).fill(60))
    expect(second!.top.slice(-5)).toEqual(Array(5).fill(40))
    expect(stackUsageAreas(series, depts, 'costUzs', 100)[1]!.top[0]).toBe(85)
  })

  it('keeps each layer monotonic between observations and never invents a peak in the stacked total', () => {
    const rows = [
      [15, 5],
      [70, 20],
      [80, 10],
      [80, 55],
    ]
    const [first, second] = stackUsageAreas(buckets(rows), depts, 'tokens', 200)
    for (let bucket = 0; bucket < rows.length - 1; bucket++) {
      const start = center(bucket, rows.length),
        end = center(bucket + 1, rows.length)
      let previous = rows[bucket]!
      for (let i = start; i <= end; i++) {
        const top = second!.top[i]!,
          middle = first!.top[i]!
        const current = [(100 - middle) * 2, (middle - top) * 2]
        for (let layer = 0; layer < depts.length; layer++) {
          const from = rows[bucket]![layer]!,
            to = rows[bucket + 1]![layer]!
          const value = current[layer]!
          expect(value).toBeGreaterThanOrEqual(Math.min(from, to) - 1e-10)
          expect(value).toBeLessThanOrEqual(Math.max(from, to) + 1e-10)
          expect((value - previous[layer]!) * Math.sign(to - from)).toBeGreaterThanOrEqual(-1e-10)
        }
        if (bucket === 1) expect(top).toBeCloseTo(55, 10)
        previous = current
      }
    }
  })

  it('keeps zero gaps empty and lets a department appear and disappear without crossing another band', () => {
    const [base, overlay] = stackUsageAreas(
      buckets([
        [0, 2],
        [25, 0],
        [0, 0],
        [0, 11],
      ]),
      depts,
      'tokens',
      25,
    )
    for (let i = 0; i < usageAreaSamples; i++) {
      expect(overlay!.top[i]).toBeLessThanOrEqual(base!.top[i]!)
      expect(overlay!.top[i]).toBeGreaterThanOrEqual(0)
      expect(base!.top[i]).toBeLessThanOrEqual(100)
    }
    expect(base!.top.slice(center(2, 4))).toEqual(Array(usageAreaSamples - center(2, 4)).fill(100))
    expect(overlay!.top.slice(center(1, 4), center(2, 4) + 1)).toEqual(
      base!.top.slice(center(1, 4), center(2, 4) + 1),
    )
  })

  it('draws stable flat boundaries for a single observation, an empty metric, or a missing department', () => {
    const one = stackUsageAreas(buckets([[8, 2]]), [depts[1]!, depts[0]!], 'tokens', 20)
    expect(one.map((layer) => [layer.id, new Set(layer.top)])).toEqual([
      ['delivery', new Set([90])],
      ['operations', new Set([50])],
    ])
    expect(stackUsageAreas(buckets([[], []]), depts.slice(0, 1), 'tokens', 0)[0]!.top).toEqual(
      Array(193).fill(100),
    )
    expect(stackUsageAreas([], depts, 'runs', 10)[1]!.top).toEqual(Array(193).fill(100))
    expect(stackUsageAreas(buckets([[8]]), [], 'runs', 10)).toEqual([])
  })
})
