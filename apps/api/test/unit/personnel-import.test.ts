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
  it('never creates negative biographical claims from omitted form defaults', () => {
    const result = personnelImportToolSchema.parse({
      data: { fio: 'Karimov Sardor' },
      evidence: [{ path: 'fio', quote: 'Karimov Sardor' }],
      warnings: [],
    })
    expect(result.data.party).toBe('')
    expect(result.data.degree).toBe('')
    expect(validatePersonnelImport('Karimov Sardor', result).ok).toBe(true)
  })
  it('recognizes source-supported Uzbek date suffixes and bracketed evidence paths', () => {
    const result = draft({
      birthDate: '1995-05-12',
      work: [
        {
          from: '2026',
          to: '',
          current: true,
          since: '2026-11-03',
          months: '',
          text: 'Test markazi',
        },
      ],
    })
    result.evidence.push(
      { path: 'data.birthDate', quote: '1995 йил 12 майда' },
      { path: 'data.work[0].from', quote: '2026 йил 3 ноябрдан ҳозирга қадар' },
      { path: 'work[0].current', quote: '2026 йил 3 ноябрдан ҳозирга қадар' },
      { path: 'work[0].since', quote: '2026 йил 3 ноябрдан ҳозирга қадар' },
      { path: 'work[0].text', quote: 'Test markazi' },
    )
    expect(
      validatePersonnelImport(
        'Karimov Sardor 1995 йил 12 майда 2026 йил 3 ноябрдан ҳозирга қадар Test markazi',
        result,
      ).ok,
    ).toBe(true)
  })
  it('keeps verified facts in a partial draft and blanks every unsupported value', () => {
    const result = draft({
      birthPlace: 'London',
      schools: [{ year: '2017', name: 'Test universiteti', form: 'кундузги', master: true }],
    })
    result.evidence.push(
      { path: 'birthPlace', quote: 'London' },
      { path: 'schools.0.year', quote: '2017 Test universiteti' },
      { path: 'schools.0.name', quote: '2017 Test universiteti' },
      { path: 'schools.0.form', quote: '2017 Test universiteti' },
      { path: 'schools.0.master', quote: '2017 Test universiteti' },
    )
    const source = 'Karimov Sardor 2017 Test universiteti'
    expect(validatePersonnelImport(source, result).ok).toBe(false)
    const partial = validatePersonnelImport(source, result, { allowPartial: true })
    expect(partial.ok).toBe(true)
    if (!partial.ok) return
    expect(partial.output.data).toMatchObject({
      fio: 'Karimov Sardor',
      birthPlace: '',
      schools: [{ name: 'Test universiteti', form: '', master: false }],
    })
    expect(partial.unverifiedFields).toEqual(['birthPlace', 'schools.0.form', 'schools.0.master'])
    expect(result.data.birthPlace).toBe('London')
  })
  it('refuses empty output even when unsupported rows existed in the answer', () => {
    const result = draft({ fio: 'Invented Name' })
    expect(validatePersonnelImport('No biography', result, { allowPartial: true }).ok).toBe(false)
  })
})
