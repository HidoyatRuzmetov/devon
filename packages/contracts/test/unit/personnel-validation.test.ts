import { describe, expect, it } from 'vitest'
import { personnelDataSchema } from '../../src/personnel-record.js'
import { validate } from '../../src/personnel-template.js'

describe('personnel validation destinations', () => {
  it('requires photo and an explicit military rank', () => {
    const data = personnelDataSchema.parse({})
    expect(validate(data).errors.map((issue) => issue.path)).toEqual(
      expect.arrayContaining(['photo', 'militaryRank']),
    )
    data.photo = 'data:image/jpeg;base64,/9j/2Q=='
    data.militaryRank = 'yo‘q'
    expect(validate(data).errors.map((issue) => issue.path)).not.toEqual(
      expect.arrayContaining(['photo', 'militaryRank']),
    )
  })
  it('targets the exact field and original row index after blank rows', () => {
    const data = personnelDataSchema.parse({
      schools: [
        { year: '', name: '', form: '', master: false },
        { year: '2012', name: 'Test universiteti', form: '', master: false },
      ],
      work: [
        { from: '', to: '', current: false, since: '', months: '', text: '' },
        { from: '2020', to: '2019', current: false, since: '', months: '', text: '' },
      ],
      relatives: [
        {
          rel: '',
          name: '',
          year: '',
          place: '',
          status: '',
          job: '',
          prevJob: '',
          deathYear: '',
          address: '',
        },
        {
          rel: 'Онаси',
          name: 'Karimova Dilbar Olimovna',
          year: '1967',
          place: 'Toshkent shahri',
          status: 'housewife',
          job: '',
          prevJob: '',
          deathYear: '',
          address: '',
        },
      ],
    })
    const errors = validate(data).errors
    expect(errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'school-1', path: 'schools.1.form' }),
        expect.objectContaining({ id: 'work-1', path: 'work.1.to' }),
        expect.objectContaining({ id: 'work-1', path: 'work.1.text' }),
        expect.objectContaining({ id: 'rel-1', path: 'relatives.1.address' }),
      ]),
    )
  })
})
