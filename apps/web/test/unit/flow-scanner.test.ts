import { describe, expect, it } from 'vitest'
import { assertScannerPort } from '../e2e/flow-scanner.js'

describe('owned scanner port guard', () => {
  it('allows a distinct local test port', () => {
    expect(() => assertScannerPort(49003, [49001, 49002, 55432])).not.toThrow()
  })
  it.each([49001, 49002, 55432])('refuses a reserved port %s', (port) => {
    expect(() => assertScannerPort(port, [49001, 49002, 55432])).toThrow()
  })
  it.each([0, 443, 65536, NaN, 49003.5])('refuses invalid test port %s', (port) => {
    expect(() => assertScannerPort(port, [])).toThrow()
  })
})
