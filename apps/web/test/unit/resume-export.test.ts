import { expect, it } from 'vitest'
import { professionalProfileSchema } from '@devon/contracts'
import { buildResumeDocx } from '../../src/features/structure/resume-export.js'

it('exports every public profile entry and full description without highlights or a forced page break', () => {
  const description = 'Complete paragraph & details. '.repeat(100) + 'FINAL DESCRIPTION SENTENCE.'
  const profile = professionalProfileSchema.parse({
    about: 'Full biography. '.repeat(100),
    hobbies: ['Reading'],
    skills: Array.from({ length: 30 }, (_, i) => `Skill ${i}`),
    experience: Array.from({ length: 7 }, (_, i) => ({
      role: `Role ${i}`,
      organization: `Organization ${i}`,
      description,
      startYear: 2010 + i,
      endYear: 2011 + i,
      current: false,
    })),
    education: Array.from({ length: 4 }, (_, i) => ({
      institution: `University ${i}`,
      degree: 'bachelor',
      field: 'Computer science',
      startYear: 2000 + i,
      endYear: 2001 + i,
      current: false,
    })),
    certifications: Array.from({ length: 8 }, (_, i) => ({
      name: `Certificate ${i}`,
      issuer: 'Institute',
      year: 2020,
    })),
    links: Array.from({ length: 5 }, (_, i) => ({
      label: `Portfolio ${i}`,
      url: `https://example.com/${i}`,
    })),
  })
  const bytes = buildResumeDocx(
    { name: 'Example Person', email: '', unit: '', position: '' },
    profile,
    {
      about: 'Profile',
      experience: 'Experience',
      education: 'Education',
      hobbies: 'Interests',
      skills: 'Skills',
      languages: 'Languages',
      certifications: 'Certifications',
      links: 'Links',
      present: 'Present',
      resume: 'Résumé',
      educationDegrees: { bachelor: 'Bachelor' },
    },
  )
  const zipText = new TextDecoder().decode(bytes)
  for (const item of profile.experience) expect(zipText).toContain(item.role)
  for (const item of profile.education) expect(zipText).toContain(item.institution)
  for (const item of profile.certifications) expect(zipText).toContain(item.name)
  for (const item of profile.links) expect(zipText).toContain(item.url)
  expect(zipText.match(/FINAL DESCRIPTION SENTENCE\./g)).toHaveLength(7)
  expect(zipText).toContain('Skill 29')
  expect(zipText).toContain('Reading')
  expect(zipText).not.toContain('highlights')
  expect(zipText).not.toContain('People')
  expect(zipText).not.toContain('<w:br w:type="page"')
  expect(zipText).toContain('w:val="Title"')
})
