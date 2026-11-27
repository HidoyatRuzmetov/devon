import { z } from 'zod'

export const onboardingKeys = [
  'reading',
  'tour',
  'telegram',
  'account',
  'resume',
  'personnel',
] as const
export type OnboardingKey = (typeof onboardingKeys)[number]
export const onboardingFactsSchema = z.object({
  telegram: z.boolean(),
  account: z.boolean(),
  resume: z.boolean(),
  personnel: z.boolean(),
})
export const onboardingDocumentSchema = z.object({
  id: z.uuid(),
  title: z.string(),
  filename: z.string(),
  uploadedBy: z.uuid(),
  uploaderName: z.string(),
  createdAt: z.string(),
  rejected: z.boolean(),
  published: z.boolean(),
  superseded: z.boolean().default(false),
})
export const onboardingSessionSchema = z.object({
  resumeDepartmentId: z.uuid().optional(),
  required: z.boolean(),
  eligible: z.boolean(),
  facts: onboardingFactsSchema,
  run: z
    .object({
      departmentId: z.uuid(),
      cardId: z.uuid().nullable(),
      documentId: z.uuid().nullable(),
      htmlDone: z.boolean(),
      tourStep: z.number().int(),
      tourCompleted: z.boolean(),
      paused: z.boolean(),
      setupCompleted: z.boolean(),
    })
    .nullable(),
})
export type OnboardingSession = z.infer<typeof onboardingSessionSchema>
export type OnboardingDocument = z.infer<typeof onboardingDocumentSchema>

/** The editor and saved completion check use the same minimum résumé requirements. */
export function onboardingResumeMissing(value: unknown): ('about' | 'skills' | 'education')[] {
  const profile = value as Record<string, unknown> | null
  const text = (v: unknown) => typeof v === 'string' && v.trim().length > 0
  const entries = (v: unknown) => (Array.isArray(v) ? (v as Record<string, unknown>[]) : [])
  const missing: ('about' | 'skills' | 'education')[] = []
  if (!text(profile?.['about'])) missing.push('about')
  if (!Array.isArray(profile?.['skills']) || !profile['skills'].some(text)) missing.push('skills')
  if (
    !entries(profile?.['education']).some((e) => text(e?.['institution'])) &&
    !entries(profile?.['experience']).some((e) => text(e?.['organization']) && text(e?.['role']))
  )
    missing.push('education')
  return missing
}

/** Completion is derived from saved values, never from a checked box or a page visit. */
export function onboardingFacts(input: {
  telegram: boolean
  givenName: string
  familyName: string
  title: string | null
  dateOfBirth: string | null
  workStartDate?: string | null
  professional: unknown
  personnel: unknown
}) {
  const r = input.personnel as Record<string, unknown> | null
  const text = (value: unknown) => typeof value === 'string' && value.trim().length > 0
  const array = (value: unknown) =>
    Array.isArray(value) ? (value as Record<string, unknown>[]) : []
  return {
    telegram: input.telegram,
    account:
      text(input.givenName) &&
      text(input.familyName) &&
      text(input.title) &&
      text(input.dateOfBirth) &&
      text(input.workStartDate),
    resume: onboardingResumeMissing(input.professional).length === 0,
    personnel: Boolean(
      r &&
      ['fio', 'birthDate', 'birthPlace', 'nationality', 'eduLevel', 'specialty'].every((k) =>
        text(r[k]),
      ) &&
      array(r['work']).some((w) => text(w['text']) && (text(w['since']) || text(w['from']))),
    ),
  }
}
