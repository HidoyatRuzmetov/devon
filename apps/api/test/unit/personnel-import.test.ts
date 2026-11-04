import { describe, expect, it } from 'vitest'
import {
  personnelImportToolSchema,
  validatePersonnelImport,
} from '../../src/modules/ai/personnel-import.js'

const draft = (extra: Record<string, unknown> = {}) =>
  personnelImportToolSchema.parse({
    data: {
      fio: 'Karimov Sardor',
      party: '',
      degree: '',
      title: '',
      languages: '',
      awards: '',
      deputy: '',
      ...extra,
    },
    evidence: [{ path: 'fio', quote: 'Karimov Sardor' }],
    warnings: [],
  })
describe('personnel import source evidence', () => {
  it('accepts exact source facts, leaves missing fields blank and does not invent a photo', () => {
    const result = validatePersonnelImport('Karimov Sardor', draft())
    expect(result.ok).toBe(true)
    expect(draft().data.party).toBe('')
    expect(draft().data).not.toHaveProperty('photo')
  })
  it('rejects invented facts and fabricated supporting quotations', () => {
    const result = draft({ birthPlace: 'London' })
    result.evidence.push({ path: 'birthPlace', quote: 'London' })
    expect(validatePersonnelImport('Karimov Sardor, Toshkent', result).ok).toBe(false)
    result.evidence[1]!.quote = 'Toshkent'
    expect(validatePersonnelImport('Karimov Sardor, Toshkent', result).ok).toBe(false)
  })
  it('never turns a bare year or ambiguous slash date into a fabricated birthday', () => {
    const result = draft({ birthDate: '1995-05-12' })
    for (const quote of ['1995', '05/12/1995', '12.05.1995', '1995-yil 12-may']) {
      result.evidence = [
        { path: 'fio', quote: 'Karimov Sardor' },
        { path: 'birthDate', quote },
      ]
      expect(validatePersonnelImport(`Karimov Sardor ${quote}`, result).ok).toBe(
        ['12.05.1995', '1995-yil 12-may'].includes(quote),
      )
    }
  })
})
