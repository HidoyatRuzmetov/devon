import * as personnelTemplate from './personnel-template.js'
import type { PersonnelData } from './personnel-record.js'

const CYRILLIC: Record<string, string> = {
  а: 'a',
  б: 'b',
  в: 'v',
  г: 'g',
  д: 'd',
  е: 'e',
  ё: 'yo',
  ж: 'j',
  з: 'z',
  и: 'i',
  й: 'y',
  к: 'k',
  л: 'l',
  м: 'm',
  н: 'n',
  о: 'o',
  п: 'p',
  р: 'r',
  с: 's',
  т: 't',
  у: 'u',
  ф: 'f',
  х: 'x',
  ц: 'ts',
  ч: 'ch',
  ш: 'sh',
  щ: 'sh',
  ъ: 'ʼ',
  ы: 'i',
  ь: '',
  э: 'e',
  ю: 'yu',
  я: 'ya',
  ў: 'oʻ',
  қ: 'q',
  ғ: 'gʻ',
  ҳ: 'h',
}
export function toLatin(text: string): string {
  return text.replace(/[А-Яа-яЁёЎўҚқҒғҲҳ]+/g, (word) => {
    const capitals = word.length > 1 && word === word.toUpperCase()
    return [...word]
      .map((letter, index) => {
        let mapped = CYRILLIC[letter.toLowerCase()] ?? letter
        if (
          letter.toLowerCase() === 'е' &&
          (index === 0 || /[аоуиэёюяўъь]/i.test(word[index - 1]!))
        )
          mapped = 'ye'
        if (capitals) return mapped.toUpperCase()
        return letter === letter.toUpperCase()
          ? mapped.charAt(0).toUpperCase() + mapped.slice(1)
          : mapped
      })
      .join('')
  })
}
export function preserveNames(
  text: string,
  names: readonly string[],
  transform: (text: string) => string,
): string {
  const tokens: string[] = []
  for (const name of [...names].sort((a, b) => b.length - a.length)) {
    if (name) text = text.split(name).join(`¤${tokens.push(name) - 1}¤`)
  }
  return transform(text).replace(/¤(\d+)¤/g, (_, index: string) => tokens[Number(index)] ?? '')
}
function mapValues(value: unknown, transform: (text: string) => string, key = ''): unknown {
  if (['photo', 'status', 'protectedNames', 'form', 'rel'].includes(key)) return value
  if (typeof value === 'string') return transform(value)
  if (Array.isArray(value)) return value.map((v) => mapValues(v, transform))
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, mapValues(v, transform, k)]),
    )
  return value
}
export function preparePersonnelExport(
  data: PersonnelData,
  script: 'latin' | 'cyrillic',
): PersonnelData {
  // Protect exact proper names before spelling/case normalization, then restore their original bytes.
  const tokens: string[] = [],
    names = [...data.protectedNames].sort((a, b) => b.length - a.length)
  const mask = (text: string) => {
    for (const name of names) text = text.split(name).join(`¤${tokens.push(name) - 1}¤`)
    return text
  }
  const masked = mapValues(data, mask) as PersonnelData
  const normalized = personnelTemplate.normalize(masked)
  normalized.protectedNames = [...data.protectedNames]
  return mapValues(normalized, (text) =>
    (script === 'latin' ? toLatin(text) : text).replace(
      /¤(\d+)¤/g,
      (_, index: string) => tokens[Number(index)] ?? '',
    ),
  ) as PersonnelData
}
export function personnelExportFields(data: PersonnelData): { path: string; value: string }[] {
  const rows: { path: string; value: string }[] = []
  const visit = (value: unknown, path: string) => {
    if (['photo', 'protectedNames', 'status', 'form', 'rel'].includes(path.split('.').at(-1)!))
      return
    if (typeof value === 'string') {
      if (value) rows.push({ path, value })
      return
    }
    if (value && typeof value === 'object')
      for (const [key, child] of Object.entries(value)) visit(child, path ? `${path}.${key}` : key)
  }
  visit(data, '')
  return rows
}
