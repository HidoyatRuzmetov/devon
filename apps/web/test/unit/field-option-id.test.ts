import { describe, expect, it } from 'vitest'
import { availableOptionId } from '../../src/features/fields/option-id.js'

describe('custom-field option references', () => {
  it('keeps distinct labels with the same normalized slug selectable separately', () => {
    expect(availableOptionId('c', ['c'])).toBe('c_2')
    expect(availableOptionId('c', ['c', 'c_2'])).toBe('c_3')
  })

  it('does not reuse a removed persisted option identity', () => {
    expect(availableOptionId('opt_2', ['opt_1', 'opt_2', 'opt_3'])).toBe('opt_2_2')
  })

  it('keeps the wire identity within its 60-character cap when adding a suffix', () => {
    const base = 'x'.repeat(60)
    const result = availableOptionId(base, [base])
    expect(result).toHaveLength(60)
    expect(result).toBe(`${'x'.repeat(58)}_2`)
  })
})
