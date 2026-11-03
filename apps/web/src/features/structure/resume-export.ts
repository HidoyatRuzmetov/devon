import { personnelTemplate, type ProfessionalProfile } from '@devon/contracts'

type ResumeIdentity = { name: string; position: string; email: string; unit: string }
export type ResumeLabels = {
  about: string
  experience: string
  education: string
  skills: string
  languages: string
  certifications: string
  links: string
  present: string
  highlights: string
  resume: string
  educationDegrees: Record<string, string>
}
const xml = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]!,
  )
const clip = (text: string, limit: number) =>
  text.length > limit ? text.slice(0, limit).replace(/\s+\S*$/, '') + '…' : text

/** A concise professional résumé. Long profiles use a second page of selected history;
 * the public profile remains the complete record. No private personnel data is read. */
export function buildResumeDocx(
  identity: ResumeIdentity,
  profile: ProfessionalProfile,
  labels: ResumeLabels,
): Uint8Array {
  const run = (text: string, bold = false, color = '253248', size = 21) =>
    `<w:r><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri"/><w:color w:val="${color}"/><w:sz w:val="${size}"/>${bold ? '<w:b/>' : ''}</w:rPr><w:t xml:space="preserve">${xml(text)}</w:t></w:r>`
  const p = (text: string, style = 'Body', bold = false) =>
    `<w:p><w:pPr><w:pStyle w:val="${style}"/></w:pPr>${run(text, bold, style === 'Section' ? '17365D' : style === 'Meta' ? '64748B' : '253248', style === 'Meta' ? 19 : 21)}</w:p>`
  const heading = (text: string) => p(text, 'Section', true)
  const sort = (
    a: { current: boolean; endYear: number | null; startYear: number | null },
    b: typeof a,
  ) =>
    (b.current ? 9999 : (b.endYear ?? b.startYear ?? 0)) -
    (a.current ? 9999 : (a.endYear ?? a.startYear ?? 0))
  const experience = [...profile.experience].sort(sort).slice(0, 5)
  const education = [...profile.education].sort(sort).slice(0, 3)
  const period = (item: { current: boolean; startYear: number | null; endYear: number | null }) =>
    [item.startYear, item.current ? labels.present : item.endYear].filter(Boolean).join(' – ')
  const twoPages =
    experience.length > 3 ||
    education.length > 2 ||
    profile.about.length > 700 ||
    experience.reduce((n, e) => n + e.description.length, 0) > 1000
  const contact = [identity.position, identity.unit].filter(Boolean).join(' · ')
  let body = `<w:p><w:pPr><w:pStyle w:val="Name"/></w:pPr>${run(identity.name, true, '17365D', 42)}</w:p>`
  body += p(clip(profile.headline || contact, 180), 'Subtitle')
  if (profile.headline && contact) body += p(clip(contact, 180), 'Meta')
  body += p([identity.email, profile.phone, profile.location].filter(Boolean).join('  ·  '), 'Meta')
  if (profile.about) body += heading(labels.about) + p(clip(profile.about, twoPages ? 700 : 550))
  if (profile.skills.length)
    body += heading(labels.skills) + p(clip(profile.skills.slice(0, 20).join(' · '), 400))
  if (profile.languages.length)
    body += heading(labels.languages) + p(clip(profile.languages.join(' · '), 160))
  const renderExperience = (items: typeof experience) =>
    items
      .map(
        (item) =>
          p(clip([item.role, item.organization].filter(Boolean).join(' — '), 110), 'Entry', true) +
          p(period(item), 'Meta') +
          (item.description ? p(clip(item.description, 240)) : ''),
      )
      .join('')
  const renderEducation = () =>
    education
      .map(
        (item) =>
          p(clip(item.institution, 100), 'Entry', true) +
          p(
            [
              labels.educationDegrees[item.degree] ?? item.degree,
              clip(item.field, 80),
              period(item),
            ]
              .filter(Boolean)
              .join(' · '),
            'Meta',
          ),
      )
      .join('')
  if (twoPages) {
    if (experience.length)
      body += heading(labels.experience) + renderExperience(experience.slice(0, 2))
    body += '<w:p><w:r><w:br w:type="page"/></w:r></w:p>'
    body += p(identity.name, 'Subtitle', true)
    if (experience.length > 2)
      body += heading(labels.experience) + renderExperience(experience.slice(2))
    if (education.length) body += heading(labels.education) + renderEducation()
  } else {
    if (experience.length) body += heading(labels.experience) + renderExperience(experience)
    if (education.length) body += heading(labels.education) + renderEducation()
  }
  if (profile.certifications.length)
    body +=
      heading(labels.certifications) +
      p(
        clip(
          profile.certifications
            .slice(0, 6)
            .map((item) => [item.name, item.issuer, item.year].filter(Boolean).join(' — '))
            .join('; '),
          400,
        ),
      )
  if (profile.links.length)
    body +=
      heading(labels.links) +
      p(
        clip(
          profile.links
            .slice(0, 3)
            .map((item) => [item.label, item.url].filter(Boolean).join(': '))
            .join('  ·  '),
          250,
        ),
        'Meta',
      )
  if (
    profile.experience.length > 5 ||
    profile.education.length > 3 ||
    profile.skills.length > 20 ||
    profile.about.length > (twoPages ? 700 : 550) ||
    profile.experience.some((e) => e.description.length > 240)
  )
    body += p(labels.highlights, 'Meta')
  const styles = `<?xml version="1.0" encoding="UTF-8"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:sz w:val="21"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="100" w:line="260" w:lineRule="auto"/><w:widowControl/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Body"><w:name w:val="Body"/></w:style><w:style w:type="paragraph" w:styleId="Name"><w:name w:val="Name"/><w:pPr><w:keepNext/><w:spacing w:after="100"/></w:pPr></w:style><w:style w:type="paragraph" w:styleId="Subtitle"><w:name w:val="Subtitle"/><w:pPr><w:keepNext/><w:spacing w:after="120"/></w:pPr></w:style><w:style w:type="paragraph" w:styleId="Meta"><w:name w:val="Details"/><w:pPr><w:spacing w:after="90" w:line="240" w:lineRule="auto"/></w:pPr><w:rPr><w:color w:val="64748B"/><w:sz w:val="19"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Entry"><w:name w:val="Entry"/><w:pPr><w:keepNext/><w:spacing w:before="110" w:after="50"/></w:pPr></w:style><w:style w:type="paragraph" w:styleId="Section"><w:name w:val="Section"/><w:pPr><w:keepNext/><w:spacing w:before="230" w:after="130"/><w:pBdr><w:bottom w:val="single" w:sz="5" w:space="5" w:color="D9E2EE"/></w:pBdr></w:pPr></w:style></w:styles>`
  return personnelTemplate.documentZip([
    {
      name: '[Content_Types].xml',
      data: '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>',
    },
    {
      name: '_rels/.rels',
      data: '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
    },
    {
      name: 'word/_rels/document.xml.rels',
      data: '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="styles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>',
    },
    { name: 'word/styles.xml', data: styles },
    {
      name: 'word/document.xml',
      data: `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1000" w:bottom="1000" w:left="1200" w:right="1200"/></w:sectPr></w:body></w:document>`,
    },
  ])
}
export function downloadResume(
  identity: ResumeIdentity,
  profile: ProfessionalProfile,
  labels: ResumeLabels,
) {
  const bytes = buildResumeDocx(identity, profile, labels)
  const url = URL.createObjectURL(
    new Blob([new Uint8Array(bytes)], {
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    }),
  )
  const link = document.createElement('a')
  link.href = url
  link.download = `${identity.name.replace(/[<>:"/\\|?*]/g, '_')} - ${labels.resume}.docx`
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
