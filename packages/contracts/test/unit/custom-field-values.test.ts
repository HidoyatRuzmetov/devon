import { describe, expect, it } from 'vitest'
import { validateFieldValue, type FieldDef } from '../../src/custom-fields.js'

const dateField: FieldDef = {
  id: 'synthetic-date-field',
  departmentId: '10000000-0000-4000-8000-000000000001',
  appliesTo: 'person',
  key: 'review_date',
  label: { en: 'Review date' },
  description: null,
  type: 'date',
  options: [],
  required: false,
  defaultValue: null,
  showInTable: true,
  showOnCardTile: false,
  selfEditable: true,
  visibleTo: 'everyone',
  order: 0,
  archivedAt: null,
}

describe('custom field calendar dates', () => {
  it.each(['2026-02-28', '2024-02-29', '2000-02-29', '2026-04-30', '2026-12-31'])(
    'retains the real calendar date %s',
    (value) => expect(validateFieldValue(dateField, value)).toEqual({ ok: true, value }),
  )

  it.each(['2026-02-29', '2026-02-31', '1900-02-29', '2026-04-31', '2026-13-01', '2026-01-00'])(
    'refuses an impossible calendar date %s instead of normalizing it into another month',
    (value) =>
      expect(validateFieldValue(dateField, value)).toEqual({ ok: false, error: 'not_a_date' }),
  )

  it('keeps the existing timestamp-to-date coercion for a valid date', () => {
    expect(validateFieldValue(dateField, '2026-10-09T18:20:00.000Z')).toEqual({
      ok: true,
      value: '2026-10-09',
    })
  })

  it('keeps the empty and required rules separate', () => {
    expect(validateFieldValue(dateField, null)).toEqual({ ok: true, value: null })
    expect(validateFieldValue({ ...dateField, required: true }, null)).toEqual({
      ok: false,
      error: 'required',
    })
  })
})
