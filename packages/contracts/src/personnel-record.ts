import { z } from 'zod'
const field = z.string().max(3000)
export const RELATIVE_TYPES = [
  'Отаси',
  'Онаси',
  'Акаси',
  'Укаси',
  'Опаси',
  'Синглиси',
  'Турмуш ўртоғи',
  'Ўғли',
  'Қизи',
  'Қайнотаси',
  'Қайнонаси',
] as const
export const STUDY_FORMS = ['кундузги', 'сиртқи', 'кечки', 'масофавий'] as const
export const personnelDataSchema = z
  .object({
    fio: field.default(''),
    photo: z
      .string()
      .max(2_000_000)
      .regex(/^data:image\/jpeg;base64,[A-Za-z0-9+/]+=*$/)
      .nullable()
      .default(null),
    birthDate: z.iso.date().or(z.literal('')).default(''),
    birthPlace: field.default(''),
    nationality: field.default(''),
    party: field.default('йўқ'),
    eduLevel: field.default(''),
    specialty: field.default(''),
    degree: field.default('йўқ'),
    title: field.default('йўқ'),
    languages: field.default('йўқ'),
    awards: field.default('йўқ'),
    deputy: field.default('йўқ'),
    schools: z
      .array(
        z
          .object({
            year: z.string().max(4),
            name: field,
            form: z.enum(STUDY_FORMS),
            master: z.boolean(),
          })
          .strict(),
      )
      .max(30)
      .default([]),
    work: z
      .array(
        z
          .object({
            from: z.string().max(4),
            to: z.string().max(4),
            current: z.boolean(),
            since: z.iso.date().or(z.literal('')),
            months: field,
            text: field,
          })
          .strict(),
      )
      .max(100)
      .default([]),
    relatives: z
      .array(
        z
          .object({
            rel: z.enum(RELATIVE_TYPES).or(z.literal('')),
            name: field,
            year: z.string().max(4),
            place: field,
            status: z.enum(['work', 'retired', 'unemployed', 'dead', 'housewife']),
            job: field,
            prevJob: field,
            deathYear: z.string().max(4),
            address: field,
          })
          .strict(),
      )
      .max(50)
      .default([]),
    protectedNames: z
      .array(z.string().trim().min(1).max(300))
      .max(500)
      .default(['Cola', 'Coca-Cola', 'Telegram', 'Google', 'Microsoft', 'Apple', 'OpenAI']),
  })
  .strict()
export type PersonnelData = z.infer<typeof personnelDataSchema>
export const personnelRecordSchema = z.object({
  ownerUserId: z.string().uuid(),
  data: personnelDataSchema,
  version: z.number().int(),
  updatedAt: z.string().nullable(),
})
export const personnelWriteSchema = z
  .object({ data: personnelDataSchema, version: z.number().int().nonnegative() })
  .strict()
export const personnelIssueSchema = z.object({
  id: z.string(),
  msg: z.string(),
  missing: z.boolean().optional(),
})
export type PersonnelIssue = z.infer<typeof personnelIssueSchema>
export const personnelExportRequestSchema = z
  .object({
    ownerUserId: z.uuid(),
    data: personnelDataSchema,
    script: z.enum(['latin', 'cyrillic']),
  })
  .strict()
export const personnelExportResponseSchema = z.object({
  data: personnelDataSchema,
  script: z.enum(['latin', 'cyrillic']),
})
