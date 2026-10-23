import { describe, expect, it } from 'vitest'
import { draftPageInputSchema, draftPageSpec } from '../../src/prompts/draft-page.js'

const input = draftPageInputSchema.parse({
  locale: 'en',
  title: 'Center-wide phonebook',
  instructions:
    'Write a short introduction for staff to download the attached HTML directory. Do not invent contact details.',
})
describe('grounded page drafts', () => {
  it('gives the provider a short grounded example and excludes invented organizational processes', () => {
    const prompt = draftPageSpec.systemPrompt(input)
    expect(prompt).toContain('1–3 sentences')
    expect(prompt).toContain('Plausible advice is still invented policy')
    expect(prompt).toContain(
      'Download the attached HTML phonebook to find contact details for colleagues across the center.',
    )
  })
  it('removes only an exact repeated leading title and preserves the authored body', () => {
    const markdown = 'Download the attached HTML directory.'
    expect(
      draftPageSpec.validateOutput!(input, { markdown: `# Center-wide phonebook\n\n${markdown}` }),
    ).toEqual({ ok: true, output: { markdown } })
    expect(
      draftPageSpec.validateOutput!(input, { markdown: `## Contacts\n\n${markdown}` }),
    ).toEqual({ ok: true, output: { markdown: `## Contacts\n\n${markdown}` } })
  })
  it('rejects a title-only response instead of applying an empty body', () => {
    expect(draftPageSpec.validateOutput!(input, { markdown: '# Center-wide phonebook' }).ok).toBe(
      false,
    )
  })
})
