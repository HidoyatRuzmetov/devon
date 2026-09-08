// H15.1 ("/metrics endpoint (Prometheus format)"): the hand-rolled Counter/Gauge/Histogram in
// `src/lib/metrics.ts` -- render() output is asserted against the exact Prometheus text-exposition
// shape (# HELP / # TYPE / one sample line per label set / _bucket+_sum+_count for a histogram).
import { describe, expect, it } from 'vitest'
import { Counter, Gauge, Histogram } from '../../../src/lib/metrics.js'

describe('Counter', () => {
  it('renders HELP/TYPE and accumulates by label set independently', () => {
    const c = new Counter('devon_test_total', 'a test counter')
    c.inc({ route: '/a', status: '200' })
    c.inc({ route: '/a', status: '200' })
    c.inc({ route: '/b', status: '500' }, 3)
    const text = c.render()
    expect(text).toContain('# HELP devon_test_total a test counter')
    expect(text).toContain('# TYPE devon_test_total counter')
    expect(text).toContain('devon_test_total{route="/a",status="200"} 2')
    expect(text).toContain('devon_test_total{route="/b",status="500"} 3')
  })

  it('with no labels renders a single bare sample line', () => {
    const c = new Counter('devon_bare_total', 'no labels')
    c.inc()
    c.inc()
    expect(c.render()).toContain('devon_bare_total 2')
  })

  it('escapes quotes, backslashes and newlines in label values', () => {
    const c = new Counter('devon_escape_total', 'escaping')
    c.inc({ msg: 'a "quoted"\\thing\nline2' })
    const text = c.render()
    expect(text).toContain('msg="a \\"quoted\\"\\\\thing\\nline2"')
  })
})

describe('Gauge', () => {
  it('set() replaces the value for a given label set rather than accumulating', () => {
    const g = new Gauge('devon_test_gauge', 'a test gauge')
    g.set(3, { name: 'ai' })
    g.set(7, { name: 'ai' })
    g.set(1, { name: 'telegram' })
    const text = g.render()
    expect(text).toContain('# TYPE devon_test_gauge gauge')
    expect(text).toContain('devon_test_gauge{name="ai"} 7')
    expect(text).toContain('devon_test_gauge{name="telegram"} 1')
  })
})

describe('Histogram', () => {
  it('buckets are cumulative, +Inf equals the total count, and sum/count are exact', () => {
    const h = new Histogram('devon_test_duration_seconds', 'a test histogram', [0.1, 0.5, 1])
    h.observe(0.05, { route: '/x' })
    h.observe(0.3, { route: '/x' })
    h.observe(2, { route: '/x' }) // past every finite bucket
    const text = h.render()

    expect(text).toContain('# TYPE devon_test_duration_seconds histogram')
    expect(text).toContain('devon_test_duration_seconds_bucket{route="/x",le="0.1"} 1')
    expect(text).toContain('devon_test_duration_seconds_bucket{route="/x",le="0.5"} 2')
    expect(text).toContain('devon_test_duration_seconds_bucket{route="/x",le="1"} 2')
    expect(text).toContain('devon_test_duration_seconds_bucket{route="/x",le="+Inf"} 3')
    expect(text).toContain('devon_test_duration_seconds_sum{route="/x"} 2.35')
    expect(text).toContain('devon_test_duration_seconds_count{route="/x"} 3')
  })

  it('keeps separate series per label combination', () => {
    const h = new Histogram('devon_test2_seconds', 'h', [1])
    h.observe(0.5, { route: '/a' })
    h.observe(0.5, { route: '/b' })
    h.observe(0.5, { route: '/b' })
    const text = h.render()
    expect(text).toContain('devon_test2_seconds_count{route="/a"} 1')
    expect(text).toContain('devon_test2_seconds_count{route="/b"} 2')
  })
})
