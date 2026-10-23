import { describe, expect, it } from 'vitest'
import {
  professionalProfileSchema,
  professionalProfileWriteSchema,
} from '../../src/professional-profile.js'

describe('professional profile publishing', () => {
  it('keeps old optional records readable and supplies hobbies for existing users', () => {
    expect(professionalProfileSchema.parse({}).hobbies).toEqual([])
    expect(
      professionalProfileSchema.safeParse({
        education: [
          {
            institution: '',
            degree: '',
            field: '',
            startYear: null,
            endYear: null,
            current: false,
          },
        ],
      }).success,
    ).toBe(true)
  })
  it('requires meaningful entries on writes and preserves multiple education periods', () => {
    const period = { startYear: 2020, endYear: 2024, current: false }
    expect(
      professionalProfileWriteSchema.safeParse({
        experience: [{ organization: '', role: '', description: '', ...period }],
      }).success,
    ).toBe(false)
    expect(
      professionalProfileWriteSchema.safeParse({
        certifications: [{ name: ' ', issuer: '', year: null }],
      }).success,
    ).toBe(false)
    const result = professionalProfileWriteSchema.parse({
      education: [
        { institution: 'University', degree: 'Bachelor', field: 'Policy', ...period },
        {
          institution: 'Graduate school',
          degree: 'Master',
          field: 'Economics',
          startYear: 2025,
          endYear: 2027,
          current: true,
        },
      ],
      hobbies: ['Hiking'],
    })
    expect(result.education).toHaveLength(2)
    expect(result.hobbies).toEqual(['Hiking'])
  })
  it('rejects inverted years, non-http links and oversized interest lists', () => {
    expect(
      professionalProfileWriteSchema.safeParse({
        education: [
          {
            institution: 'University',
            degree: '',
            field: '',
            startYear: 2025,
            endYear: 2020,
            current: false,
          },
        ],
      }).success,
    ).toBe(false)
    expect(
      professionalProfileWriteSchema.safeParse({
        links: [{ label: 'Unsafe', url: 'javascript:alert(1)' }],
      }).success,
    ).toBe(false)
    expect(
      professionalProfileWriteSchema.safeParse({
        hobbies: Array.from({ length: 51 }, () => 'Hobby'),
      }).success,
    ).toBe(false)
  })
})
