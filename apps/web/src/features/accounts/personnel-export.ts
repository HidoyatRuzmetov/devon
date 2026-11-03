import { personnelTemplate, preserveNames, toLatin, type PersonnelData } from '@devon/contracts'
export { preserveNames, preparePersonnelExport, toLatin } from '@devon/contracts'

export function downloadPersonnel(data: PersonnelData, script: 'latin' | 'cyrillic') {
  let photo: Uint8Array | null = null
  if (data.photo)
    photo = Uint8Array.from(atob(data.photo.split(',')[1]!), (character) => character.charCodeAt(0))
  const bytes = personnelTemplate.buildDocx(
    { ...data, photo },
    {
      normalized: true,
      ...(script === 'latin'
        ? { transformText: (text: string) => preserveNames(text, data.protectedNames, toLatin) }
        : {}),
    },
  )
  const url = URL.createObjectURL(
    new Blob([new Uint8Array(bytes)], {
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    }),
  )
  const link = document.createElement('a')
  link.href = url
  link.download = personnelTemplate.fileName(data.fio).replace('.docx', `-${script}.docx`)
  document.body.append(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}
