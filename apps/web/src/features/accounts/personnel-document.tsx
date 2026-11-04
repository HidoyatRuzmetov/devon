import * as React from 'react'
import {
  personnelTemplate,
  RELATIVE_TYPES,
  STUDY_FORMS,
  preserveNames,
  toLatin,
  type PersonnelData,
} from '@devon/contracts'
import { useT } from '@devon/i18n'
import { Camera, Plus, Trash2 } from 'lucide-react'
import { AvatarCrop } from './avatar-crop.js'
import { PersonnelPreview } from './personnel-preview.js'
import './personnel-document.css'

export const blankSchool = (): PersonnelData['schools'][number] => ({
  year: '',
  name: '',
  form: '',
  master: false,
})
export const blankWork = (): PersonnelData['work'][number] => ({
  from: '',
  to: '',
  current: false,
  since: '',
  months: '',
  text: '',
})
export const blankRelative = (
  rel: PersonnelData['relatives'][number]['rel'] = '',
): PersonnelData['relatives'][number] => ({
  rel,
  name: '',
  year: '',
  place: '',
  status: 'work',
  job: '',
  prevJob: '',
  deathYear: '',
  address: '',
})
const labels: Record<string, string> = {
  fio: 'МАЪЛУМОТНОМА',
  birthDate: 'Туғилган йили:',
  birthPlace: 'Туғилган жойи:',
  nationality: 'Миллати:',
  party: 'Партиявийлиги:',
  eduLevel: 'Маълумоти:',
  schools: 'Тамомлаган:',
  specialty: 'Маълумоти бўйича мутахассислиги:',
  degree: 'Илмий даражаси:',
  title: 'Илмий унвони:',
  languages: 'Қайси чет тилларини билади:',
  militaryRank: 'Ҳарбий унвони:',
  awards: 'Давлат мукофотлари билан тақдирланганми (қанақа):',
  deputy:
    'Халқ депутатлари республика, вилоят, шаҳар ва туман Кенгаши депутатими ёки бошқа сайланадиган органларнинг аъзосими (тўлиқ кўрсатилиши лозим):',
  work: 'МЕҲНАТ ФАОЛИЯТИ',
  relatives: 'яқин қариндошлари ҳақида МАЪЛУМОТ',
  rel: 'Қариндошлиги',
  name: 'Фамилияси, исми ва отасининг исми',
  birth: 'Туғилган йили ва жойи',
  job: 'Иш жойи ва лавозими',
  address: 'Турар жойи',
}
type List = 'schools' | 'work' | 'relatives'

type FieldProps = {
  path: string
  label: string
  value: string
  placeholder: string
  preview: boolean
  readonly: boolean
  onChange: (value: string) => void
  onEdit: (path: string) => void
  options?: { value: string; label: string }[]
  type?: 'date' | 'year'
  display?: string
  compact?: boolean
}
function DocumentField({
  path,
  label,
  value,
  placeholder,
  preview,
  readonly,
  onChange,
  onEdit,
  options,
  type,
  display,
  compact,
}: FieldProps) {
  const ref = React.useRef<HTMLTextAreaElement>(null)
  React.useLayoutEffect(() => {
    if (ref.current) {
      ref.current.style.height = '0px'
      ref.current.style.height = `${ref.current.scrollHeight + 2}px`
    }
  }, [value, preview, placeholder])
  React.useEffect(() => {
    const element = ref.current
    if (!element) return
    let width = element.clientWidth
    let frame = 0
    const observer = new ResizeObserver(() => {
      if (element.clientWidth === width) return
      width = element.clientWidth
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        element.style.height = '0px'
        element.style.height = String(element.scrollHeight + 2) + 'px'
      })
    })
    observer.observe(element)
    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
    }
  }, [preview])
  const shown = display ?? options?.find((option) => option.value === value)?.label ?? value
  if (preview)
    return readonly ? (
      <span className="personnel-value">{shown || '—'}</span>
    ) : (
      <button
        type="button"
        className={`personnel-value personnel-edit-target ${!shown ? 'is-empty' : ''}`}
        aria-label={label}
        onClick={() => onEdit(path)}
      >
        {shown || placeholder}
      </button>
    )
  const common = {
    'aria-label': label,
    'data-field-path': path,
    value,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
      onChange(e.target.value),
    className: 'personnel-input',
    disabled: readonly,
  }
  if (options)
    return (
      <select {...common}>
        {!value ? (
          <option value="" disabled>
            {placeholder}
          </option>
        ) : null}
        {options.map((option) => (
          <option value={option.value} key={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    )
  if (type)
    return (
      <span className={`personnel-date ${value ? 'has-value' : ''}`}>
        <input
          {...common}
          type={type === 'date' ? 'date' : 'text'}
          inputMode={type === 'year' ? 'numeric' : undefined}
          maxLength={type === 'year' ? 4 : undefined}
          placeholder={placeholder}
        />
        {type === 'date' && !value ? (
          <span aria-hidden="true" className="personnel-date-example">
            {placeholder}
          </span>
        ) : null}
      </span>
    )
  return (
    <textarea
      {...common}
      ref={ref}
      rows={1}
      maxLength={3000}
      placeholder={placeholder}
      className={`personnel-input ${compact ? 'is-compact' : ''}`}
    />
  )
}

export function PersonnelDocument({
  data,
  onChange,
  preview,
  readonly,
  script,
  onEdit,
}: {
  data: PersonnelData
  onChange: (data: PersonnelData) => void
  preview: boolean
  readonly: boolean
  script: 'latin' | 'cyrillic'
  onEdit: (path: string) => void
}) {
  const t = useT(),
    [crop, setCrop] = React.useState<File | null>(null)
  const photoInput = React.useRef<HTMLInputElement>(null)
  // Only generated template wording changes script here. User-entered text remains verbatim
  // until the explicit AI-assisted export, so preview never silently rewrites a draft.
  const wording = (text: string) =>
    script === 'latin' ? preserveNames(text, data.protectedNames, toLatin) : text
  const formatted = (text: string, originals: string[]) =>
    script === 'latin'
      ? preserveNames(text, [...data.protectedNames, ...originals.filter(Boolean)], toLatin)
      : text
  function update(path: string, value: unknown) {
    const next = structuredClone(data),
      parts = path.split('.')
    let target = next as unknown as Record<string, unknown>
    for (const part of parts.slice(0, -1)) target = target[part] as Record<string, unknown>
    target[parts.at(-1)!] = value
    onChange(next)
  }
  function field(path: string, options?: FieldProps['options'], display?: string) {
    const parts = path.split('.'),
      key = parts.at(-1)!,
      example = key === 'name' && parts[0] === 'schools' ? 'school' : key
    let value: unknown = data
    for (const part of parts) value = (value as Record<string, unknown>)[part]
    if (key === 'from' && parts[0] === 'work')
      value = personnelTemplate.workStartYear(data.work[Number(parts[1])]!)
    return (
      <DocumentField
        path={path}
        label={t(`personnel.fields.${key}`)}
        value={String(value ?? '')}
        placeholder={
          options ? t('personnelDocument.choose') : t(`personnelDocument.examples.${example}`)
        }
        preview={preview}
        readonly={readonly}
        onChange={(v) => update(path, v)}
        onEdit={onEdit}
        {...(options ? { options } : {})}
        {...(display !== undefined ? { display } : {})}
        {...(key === 'birthDate'
          ? { type: 'date' as const }
          : ['year', 'from', 'to', 'deathYear'].includes(key)
            ? { type: 'year' as const }
            : {})}
      />
    )
  }
  function block(key: keyof PersonnelData, options?: FieldProps['options']) {
    return (
      <div className={`personnel-block personnel-${key}`} data-validation-id={key}>
        <div className="personnel-label">{wording(labels[key]!)}</div>
        {field(
          key,
          options,
          key === 'birthDate' ? personnelTemplate.fmtDate(data.birthDate) : undefined,
        )}
      </div>
    )
  }
  function check(path: string, checked: boolean) {
    return (
      <label className="personnel-check">
        <input type="checkbox" checked={checked} onChange={(e) => update(path, e.target.checked)} />
        {t(`personnel.fields.${path.split('.').at(-1)}`)}
      </label>
    )
  }
  function remove(list: List, index: number) {
    return !preview && !readonly ? (
      <button
        className="personnel-remove"
        type="button"
        aria-label={t('personnelDocument.remove', { section: t(`personnel.sections.${list}`) })}
        onClick={() =>
          update(
            list,
            data[list].filter((_, i) => i !== index),
          )
        }
      >
        <Trash2 size={14} />
      </button>
    ) : null
  }
  function add(list: List) {
    return !preview && !readonly ? (
      <button
        type="button"
        className="personnel-add"
        disabled={data[list].length >= (list === 'schools' ? 30 : list === 'work' ? 100 : 50)}
        onClick={() =>
          update(list, [
            ...data[list],
            list === 'schools' ? blankSchool() : list === 'work' ? blankWork() : blankRelative(),
          ])
        }
      >
        <Plus size={14} />
        {t(`personnelDocument.add.${list}`)}
      </button>
    ) : null
  }
  function composed(path: string, content: string) {
    return readonly ? (
      <span className="personnel-value">{content || '—'}</span>
    ) : (
      <button
        type="button"
        className="personnel-value personnel-edit-target"
        onClick={() => onEdit(path)}
      >
        {content || t('personnelDocument.empty')}
      </button>
    )
  }
  const current = personnelTemplate.currentJob(data)
  if (preview)
    return <PersonnelPreview data={data} script={script} readonly={readonly} onEdit={onEdit} />
  return (
    <div
      className={`personnel-desk ${preview ? 'is-preview' : 'is-editing'}`}
      data-testid="personnel-document"
    >
      <article className="personnel-paper" aria-label={t('personnelDocument.pageOne')}>
        <div className="personnel-masthead">
          <div className="personnel-name" data-validation-id="fio">
            <h2>{wording(labels['fio']!)}</h2>
            {field('fio')}
            {current ? (
              <div className="personnel-current">
                {composed(
                  `work.${data.work.lastIndexOf(current)}.text`,
                  `${wording(personnelTemplate.fmtSince(personnelTemplate.workStartYear(current)))}\n${current.text}`,
                )}
              </div>
            ) : null}
          </div>
          <div className="personnel-portrait" data-validation-id="photo">
            {data.photo ? (
              <img src={data.photo} alt={data.fio || t('accounts.photo.choose')} />
            ) : (
              <div className="personnel-photo-empty">
                <Camera size={25} />
                <span>3 × 4</span>
              </div>
            )}
            {!readonly ? (
              <button
                type="button"
                className="personnel-photo-action"
                aria-label={t(data.photo ? 'accounts.photo.change' : 'accounts.photo.choose')}
                onClick={() => photoInput.current?.click()}
              >
                <Camera size={15} />
                <span>{t(data.photo ? 'accounts.photo.change' : 'accounts.photo.choose')}</span>
              </button>
            ) : null}
            {!preview && data.photo && !readonly ? (
              <button
                type="button"
                className="personnel-photo-remove"
                aria-label={t('accounts.photo.remove')}
                onClick={() => update('photo', null)}
              >
                <Trash2 size={14} />
              </button>
            ) : null}
            <input
              ref={photoInput}
              className="sr-only"
              type="file"
              accept="image/jpeg,image/png,image/webp"
              aria-label={t('accounts.photo.choose')}
              tabIndex={-1}
              onChange={(e) => {
                setCrop(e.target.files?.[0] ?? null)
                e.target.value = ''
              }}
            />
          </div>
        </div>
        <div className="personnel-pairs">
          {block('birthDate')}
          {block('birthPlace')}
          {block('nationality')}
          {block('party')}
          {block(
            'eduLevel',
            ['ўрта', 'ўрта махсус', 'олий', 'тугалланмаган олий'].map((value) => ({
              value: toLatin(data.eduLevel) === data.eduLevel ? toLatin(value) : value,
              label: wording(value),
            })),
          )}
          <section className="personnel-block" data-validation-id="schools">
            <div className="personnel-label">{wording(labels['schools']!)}</div>
            {data.schools.map((school, i) => (
              <div key={i} className="personnel-entry" data-validation-id={`school-${i}`}>
                {preview ? (
                  composed(
                    `schools.${i}.name`,
                    formatted(personnelTemplate.eduLines([school]).join('\n'), [school.name]),
                  )
                ) : (
                  <>
                    <div className="personnel-school-line">
                      {field(`schools.${i}.year`)}
                      {field(`schools.${i}.name`)}
                    </div>
                    <div className="personnel-entry-options">
                      {field(
                        `schools.${i}.form`,
                        STUDY_FORMS.map((value) => ({ value, label: wording(value) })),
                      )}
                      {check(`schools.${i}.master`, school.master)}
                    </div>
                  </>
                )}
                {remove('schools', i)}
              </div>
            ))}
            {add('schools')}
          </section>
        </div>
        {block('specialty')}
        <div className="personnel-pairs">
          {block('degree')}
          {block('title')}
        </div>
        <div className="personnel-pairs">
          {block('languages')}
          {block('militaryRank')}
        </div>
        {block('awards')}
        {block('deputy')}
        <section className="personnel-employment" data-validation-id="work">
          <h3>{wording(labels['work']!)}</h3>
          {data.work.map((work, i) => (
            <div
              className="personnel-entry personnel-work-entry"
              key={i}
              data-validation-id={`work-${i}`}
            >
              {preview ? (
                composed(
                  `work.${i}.text`,
                  formatted(personnelTemplate.workLine(work), [work.text, work.months]),
                )
              ) : (
                <>
                  <div className="personnel-work-dates">
                    {field(`work.${i}.from`)}
                    {!work.current ? (
                      <>
                        <span aria-hidden="true">—</span>
                        {field(`work.${i}.to`)}
                      </>
                    ) : null}
                  </div>
                  <div className="personnel-work-description">
                    {field(`work.${i}.text`)}
                    <div className="personnel-entry-options">
                      {check(`work.${i}.current`, work.current)}
                    </div>
                  </div>
                </>
              )}
              {remove('work', i)}
            </div>
          ))}
          {add('work')}
        </section>
      </article>
      <article
        className="personnel-paper personnel-family-paper"
        aria-label={t('personnelDocument.pageTwo')}
      >
        <header className="personnel-family-title">
          <div>{composed('fio', data.fio)}</div>
          <h2>{wording(labels['relatives']!)}</h2>
        </header>
        <div className="personnel-table-wrap" data-validation-id="relatives">
          <table className="personnel-family-table">
            <thead>
              <tr>
                {['rel', 'name', 'birth', 'job', 'address'].map((key) => (
                  <th key={key} scope="col">
                    {wording(labels[key]!)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.relatives.map((relative, i) => (
                <tr key={i} data-validation-id={`rel-${i}`}>
                  <td>
                    {field(
                      `relatives.${i}.rel`,
                      RELATIVE_TYPES.map((value) => ({ value, label: wording(value) })),
                    )}
                    {remove('relatives', i)}
                  </td>
                  <td>{field(`relatives.${i}.name`)}</td>
                  <td>
                    {preview ? (
                      composed(
                        `relatives.${i}.year`,
                        formatted(
                          personnelTemplate.relBirthLines(relative).join('\n'),
                          relative.place.split(/\s*,\s*/),
                        ),
                      )
                    ) : (
                      <>
                        {field(`relatives.${i}.year`)}
                        {field(`relatives.${i}.place`)}
                      </>
                    )}
                  </td>
                  <td>
                    {preview ? (
                      composed(
                        `relatives.${i}.${relative.status === 'work' ? 'job' : 'status'}`,
                        wording(
                          personnelTemplate.relWorkLines(relative).filter(Boolean).join('\n'),
                        ),
                      )
                    ) : (
                      <>
                        {field(
                          `relatives.${i}.status`,
                          ['work', 'retired', 'unemployed', 'dead', 'housewife'].map((value) => ({
                            value,
                            label: t(`personnel.status.${value}`),
                          })),
                        )}
                        {relative.status === 'work'
                          ? field(`relatives.${i}.job`)
                          : relative.status !== 'housewife'
                            ? field(`relatives.${i}.prevJob`)
                            : null}
                        {relative.status === 'dead' ? field(`relatives.${i}.deathYear`) : null}
                      </>
                    )}
                  </td>
                  <td>
                    {relative.status === 'dead' ? <span>—</span> : field(`relatives.${i}.address`)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {add('relatives')}
      </article>
      {crop ? (
        <AvatarCrop
          file={crop}
          aspectRatio={3 / 4}
          onClose={() => setCrop(null)}
          onSave={(file) => {
            const reader = new FileReader()
            reader.onload = () => {
              update('photo', String(reader.result))
              setCrop(null)
            }
            reader.readAsDataURL(file)
          }}
        />
      ) : null}
    </div>
  )
}
