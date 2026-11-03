import { expect, it } from 'vitest'
import { personnelDataSchema, personnelTemplate } from '@devon/contracts'
import {
  preparePersonnelExport,
  preserveNames,
  toLatin,
} from '../../src/features/accounts/personnel-export.js'

it('preserves protected names, internal choices and original drafts during script conversion', () => {
  const draft = personnelDataSchema.parse({
    fio: 'Karimov Sardor Akmalovich',
    work: [
      {
        from: '2020',
        to: '',
        current: true,
        since: '2020-01-01',
        months: '',
        text: 'Cola va B&O kompaniyasi bosh mutaxassisi',
      },
    ],
    protectedNames: ['Cola', 'B&O', 'Ўзбренд'],
  })
  const cyr = preparePersonnelExport(draft, 'cyrillic')
  expect(cyr.work[0]!.text).toContain('Cola')
  expect(cyr.work[0]!.text).toContain('B&O')
  expect(draft.work[0]!.text).toContain('kompaniyasi')
  expect(toLatin('МЕҲНАТ ФАОЛИЯТИ')).toBe('MEHNAT FAOLIYATI')
  expect(toLatin('Европа поезд')).toBe('Yevropa poyezd')
  expect(preserveNames('Ўзбренд ва Cola', draft.protectedNames, toLatin)).toBe('Ўзбренд va Cola')
  const latin = preparePersonnelExport(
    {
      ...draft,
      schools: [{ year: '2020', name: 'Toshkent universiteti', form: 'кундузги', master: false }],
    },
    'latin',
  )
  expect(latin.schools[0]!.form).toBe('кундузги')
})

it('exports a valid stored ZIP and escapes reviewed text after conversion', () => {
  const data = personnelDataSchema.parse({
    fio: 'Karimov Sardor Akmalovich',
    specialty: 'B&O <engineering>',
  })
  const bytes = personnelTemplate.buildDocx(
    { ...data, photo: null },
    { normalized: true, transformText: (text) => text.replace('B&O', 'R&D') },
  )
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  expect(view.getUint32(0, true)).toBe(0x04034b50)
  const decoder = new TextDecoder(),
    files = new Map<string, string>()
  let at = 0
  while (view.getUint32(at, true) === 0x04034b50) {
    const size = view.getUint32(at + 18, true),
      nameLength = view.getUint16(at + 26, true),
      extra = view.getUint16(at + 28, true)
    const start = at + 30 + nameLength + extra
    files.set(
      decoder.decode(bytes.slice(at + 30, at + 30 + nameLength)),
      decoder.decode(bytes.slice(start, start + size)),
    )
    at = start + size
  }
  const xml = files.get('word/document.xml')!
  expect(xml).toContain('R&amp;D &lt;engineering&gt;')
  expect(
    new DOMParser().parseFromString(xml, 'application/xml').getElementsByTagName('parsererror'),
  ).toHaveLength(0)
  expect(files.has('[Content_Types].xml')).toBe(true)
})

it('rejects impossible dates before private records reach the database', () => {
  expect(personnelDataSchema.safeParse({ birthDate: '1995-02-30' }).success).toBe(false)
  expect(personnelDataSchema.safeParse({ birthDate: 'not-a-date' }).success).toBe(false)
})
