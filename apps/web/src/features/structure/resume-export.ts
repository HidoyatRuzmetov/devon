import { personnelTemplate, type ProfessionalProfile } from '@devon/contracts'

type ResumeIdentity = { name: string; position: string; email: string; unit: string }
export type ResumeLabels = {
  about: string
  experience: string
  education: string
  skills: string
  hobbies: string
  languages: string
  certifications: string
  links: string
  present: string
  resume: string
  educationDegrees: Record<string, string>
}
const xml = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]!,
  )
/** Complete public professional profile; private personnel data is never read. */
export function buildResumeDocx(
  identity: ResumeIdentity,
  profile: ProfessionalProfile,
  labels: ResumeLabels,
): Uint8Array {
  const run = (text: string, bold = false, color = '222222', size = 21) =>
    `<w:r><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri"/><w:color w:val="${color}"/><w:sz w:val="${size}"/>${bold ? '<w:b/>' : ''}</w:rPr><w:t xml:space="preserve">${xml(text).replace(/\r?\n/g, '</w:t><w:br/><w:t xml:space="preserve">')}</w:t></w:r>`
  const p = (text: string, style = 'Body', bold = false) =>
    `<w:p><w:pPr><w:pStyle w:val="${style}"/></w:pPr>${run(text, bold, style === 'Meta' ? '555555' : '000000', style === 'Meta' ? 19 : 21)}</w:p>`
  const detail = (label: string, text: string) =>
    '<w:p><w:pPr><w:pStyle w:val="Body"/><w:spacing w:before="100"/></w:pPr>' +
    run(label + ': ', true) +
    run(text) +
    '</w:p>'
  const heading = (text: string) => p(text, 'Section', true)
  const sort = (
    a: { current: boolean; endYear: number | null; startYear: number | null },
    b: typeof a,
  ) =>
    (b.current ? 9999 : (b.endYear ?? b.startYear ?? 0)) -
    (a.current ? 9999 : (a.endYear ?? a.startYear ?? 0))
  const experience = [...profile.experience].sort(sort)
  const education = [...profile.education].sort(sort)
  const period = (item: { current: boolean; startYear: number | null; endYear: number | null }) =>
    [item.startYear, item.current ? labels.present : item.endYear].filter(Boolean).join(' – ')
  // Let Word paginate complete entries. A fixed break after two jobs wastes half a page.
  const contact = [identity.position, identity.unit].filter(Boolean).join(' · ')
  let body = `<w:p><w:pPr><w:pStyle w:val="Title"/></w:pPr>${run(identity.name, true, '000000', 44)}</w:p>`
  body += p(profile.headline || contact, 'Subtitle')
  if (profile.headline && contact) body += p(contact, 'Meta')
  body += p([identity.email, profile.phone, profile.location].filter(Boolean).join('  ·  '), 'Meta')
  if (profile.about) body += heading(labels.about) + p(profile.about)
  const renderExperience = (items: typeof experience) =>
    items
      .map(
        (item) =>
          p([item.role, item.organization].filter(Boolean).join(' — '), 'Entry', true) +
          p(period(item), 'Meta') +
          (item.description ? p(item.description) : ''),
      )
      .join('')
  const renderEducation = () =>
    education
      .map(
        (item) =>
          p(item.institution, 'Entry', true) +
          p(
            [labels.educationDegrees[item.degree] ?? item.degree, item.field, period(item)]
              .filter(Boolean)
              .join(' · '),
            'Meta',
          ),
      )
      .join('')
  if (experience.length) body += heading(labels.experience) + renderExperience(experience)
  if (education.length) body += heading(labels.education) + renderEducation()
  if (profile.skills.length) body += detail(labels.skills, profile.skills.join(' · '))
  if (profile.languages.length) body += detail(labels.languages, profile.languages.join(' · '))
  if (profile.hobbies.length) body += detail(labels.hobbies, profile.hobbies.join(' · '))
  if (profile.certifications.length)
    body += profile.certifications
      .map((item) =>
        detail(
          labels.certifications,
          [item.name, item.issuer, item.year].filter(Boolean).join(' — '),
        ),
      )
      .join('')
  if (profile.links.length)
    body +=
      heading(labels.links) +
      profile.links
        .map((item) => p([item.label, item.url].filter(Boolean).join(': '), 'Meta'))
        .join('')
  const styles = `<?xml version="1.0" encoding="UTF-8"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:color w:val="222222"/><w:sz w:val="21"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="90" w:line="260" w:lineRule="auto"/><w:widowControl/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Body"><w:name w:val="Normal"/></w:style><w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:pPr><w:keepNext/><w:spacing w:after="90"/></w:pPr><w:rPr><w:color w:val="000000"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Subtitle"><w:name w:val="Subtitle"/><w:pPr><w:keepNext/><w:spacing w:after="90"/></w:pPr></w:style><w:style w:type="paragraph" w:styleId="Meta"><w:name w:val="Details"/><w:pPr><w:spacing w:after="65" w:line="240" w:lineRule="auto"/></w:pPr><w:rPr><w:color w:val="555555"/><w:sz w:val="19"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Entry"><w:name w:val="Entry"/><w:pPr><w:keepNext/><w:spacing w:before="100" w:after="35"/></w:pPr></w:style><w:style w:type="paragraph" w:styleId="Section"><w:name w:val="Heading 1"/><w:pPr><w:keepNext/><w:spacing w:before="190" w:after="85"/></w:pPr><w:rPr><w:color w:val="000000"/></w:rPr></w:style></w:styles>`
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
      data: `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="850" w:bottom="850" w:left="1050" w:right="1050"/></w:sectPr></w:body></w:document>`,
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
