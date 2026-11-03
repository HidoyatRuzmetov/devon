import type { PersonnelData, PersonnelIssue } from './personnel-record.js'
export function documentZip(files: { name: string; data: string | Uint8Array }[]): Uint8Array
export function normalize<T>(data: T): T
export function validate(data: PersonnelData): {
  errors: PersonnelIssue[]
  warnings: PersonnelIssue[]
}
export function toCyrillic(value: string): string
export function fileName(name: string): string
export function currentJob(data: PersonnelData): PersonnelData['work'][number] | null
export function fmtDate(value: string): string
export function fmtSince(value: string): string
export function eduLines(schools: PersonnelData['schools']): string[]
export function workLine(work: PersonnelData['work'][number]): string
export function relWorkLines(relative: PersonnelData['relatives'][number]): string[]
export function relBirthLines(relative: PersonnelData['relatives'][number]): string[]
export function buildDocx(
  data: Omit<PersonnelData, 'photo'> & { photo: Uint8Array | null },
  options?: { normalized?: boolean; transformText?: (value: string) => string },
): Uint8Array
