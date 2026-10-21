import { z } from 'zod'

const text = z.string().trim().max(500)
const period = {
  startYear: z.number().int().min(1900).max(2200).nullable(),
  endYear: z.number().int().min(1900).max(2200).nullable(),
  current: z.boolean(),
}
const orderedPeriod = (v: { startYear: number | null; endYear: number | null }) =>
  v.startYear === null || v.endYear === null || v.endYear >= v.startYear
export const professionalProfileSchema = z
  .object({
    headline: text.default(''),
    about: z.string().trim().max(10000).default(''),
    phone: z.string().trim().max(80).default(''),
    location: text.default(''),
    skills: z.array(z.string().trim().min(1).max(100)).max(100).default([]),
    languages: z.array(z.string().trim().min(1).max(100)).max(50).default([]),
    education: z
      .array(
        z
          .object({ institution: text, degree: text, field: text, ...period })
          .strict()
          .refine(orderedPeriod, 'End year must follow start year'),
      )
      .max(30)
      .default([]),
    experience: z
      .array(
        z
          .object({ organization: text, role: text, description: z.string().max(5000), ...period })
          .strict()
          .refine(orderedPeriod, 'End year must follow start year'),
      )
      .max(50)
      .default([]),
    certifications: z
      .array(
        z
          .object({
            name: text,
            issuer: text,
            year: z.number().int().min(1900).max(2200).nullable(),
          })
          .strict(),
      )
      .max(50)
      .default([]),
    links: z
      .array(
        z
          .object({
            label: text,
            url: z
              .string()
              .url()
              .max(2000)
              .refine((value) => /^https?:\/\//i.test(value), 'Use an HTTP or HTTPS link'),
          })
          .strict(),
      )
      .max(20)
      .default([]),
  })
  .strict()
export type ProfessionalProfile = z.infer<typeof professionalProfileSchema>
export const professionalProfileRecordSchema = z.object({
  profile: professionalProfileSchema,
  version: z.number().int(),
})
