import * as React from 'react'
import {
  personnelTemplate as template,
  preserveNames,
  toLatin,
  type PersonnelData,
} from '@devon/contracts'
import { useT } from '@devon/i18n'

/** The approved annotated Word sample, without its editorial notes or instructions. */
export function PersonnelPreview({
  data,
  script,
  readonly,
  onEdit,
}: {
  data: PersonnelData
  script: 'latin' | 'cyrillic'
  readonly: boolean
  onEdit: (path: string) => void
}) {
  const t = useT()
  const wording = (value: string) =>
    script === 'latin' ? preserveNames(value, data.protectedNames, toLatin) : value
  const formatted = (value: string, names: string[]) =>
    script === 'latin'
      ? preserveNames(value, [...data.protectedNames, ...names.filter(Boolean)], toLatin)
      : value
  const field = (path: string, value: string) =>
    readonly ? (
      <span className={!value ? 'paper-placeholder' : undefined}>{value || '—'}</span>
    ) : (
      <button
        type="button"
        data-preview-field={path}
        className={`paper-edit ${value ? '' : 'paper-placeholder'}`}
        onClick={() => onEdit(path)}
      >
        {value || t('personnelDocument.empty')}
      </button>
    )
  const pair = (a: string, b: string, left: React.ReactNode, right: React.ReactNode) => (
    <div className="paper-two">
      <strong>{wording(a)}</strong>
      <strong>{wording(b)}</strong>
      <div>{left}</div>
      <div>{right}</div>
    </div>
  )
  const current = template.currentJob(data)
  const currentIndex = current ? data.work.lastIndexOf(current) : -1
  return (
    <div className="personnel-desk is-preview" data-testid="personnel-document">
      <Paper label={t('personnelDocument.pageOne')}>
        <div className="paper-photo">
          {data.photo ? <img src={data.photo} alt={data.fio} /> : <span>3×4</span>}
        </div>
        <div className="paper-center paper-title paper-heading">{wording('МАЪЛУМОТНОМА')}</div>
        <div className="paper-center paper-title paper-heading" style={{ marginTop: 12 }}>
          {field('fio', data.fio)}
        </div>
        <div style={{ height: 32 }} />
        {current ? (
          <>
            <div style={{ paddingRight: 170 }}>
              {field(
                `work.${currentIndex}.from`,
                wording(template.fmtSince(template.workStartYear(current))),
              )}
            </div>
            <div style={{ paddingRight: 170 }}>
              <strong>{field(`work.${currentIndex}.text`, current.text)}</strong>
            </div>
          </>
        ) : null}
        {pair(
          'Туғилган йили:',
          'Туғилган жойи:',
          field('birthDate', template.fmtDate(data.birthDate)),
          field('birthPlace', data.birthPlace),
        )}
        {pair(
          'Миллати:',
          'Партиявийлиги:',
          field('nationality', data.nationality),
          field('party', data.party),
        )}
        {pair(
          'Маълумоти:',
          'Тамомлаган:',
          field('eduLevel', data.eduLevel),
          <>
            {data.schools.map((school, i) => (
              <React.Fragment key={i}>
                {i ? <br /> : null}
                {field(
                  `schools.${i}.name`,
                  formatted(template.eduLines([school]).join('\n'), [school.name]),
                )}
              </React.Fragment>
            ))}
          </>,
        )}
        <div className="paper-two">
          <strong>{wording('Маълумоти бўйича мутахассислиги:')}</strong>
          {field('specialty', data.specialty)}
        </div>
        {pair(
          'Илмий даражаси:',
          'Илмий унвони:',
          field('degree', data.degree),
          field('title', data.title),
        )}
        {pair(
          'Қайси чет тилларини билади:',
          'Ҳарбий унвони:',
          field('languages', data.languages),
          field('militaryRank', data.militaryRank),
        )}
        {(
          [
            ['awards', 'Давлат мукофотлари билан тақдирланганми (қанақа):'],
            [
              'deputy',
              'Халқ депутатлари республика, вилоят, шаҳар ва туман Кенгаши депутатими ёки бошқа сайланадиган органларнинг аъзосими (тўлиқ кўрсатилиши лозим):',
            ],
          ] as const
        ).map(([key, label]) => (
          <div className="paper-block" key={key}>
            <div>
              <strong>{wording(label)}</strong>
            </div>
            <div className={key === 'deputy' ? 'paper-deputy' : undefined}>
              {field(key, data[key])}
            </div>
          </div>
        ))}
        <div className="paper-center paper-title" style={{ margin: '14px 0 10px' }}>
          {wording('МЕҲНАТ ФАОЛИЯТИ')}
        </div>
        {data.work.map((work, i) =>
          work.text ? (
            <div key={i} className="paper-work">
              {field(
                `work.${i}.text`,
                formatted(template.workLine(work), [work.text, work.months]),
              )}
            </div>
          ) : null,
        )}
      </Paper>
      <Paper label={t('personnelDocument.pageTwo')}>
        <div className="paper-center paper-subtitle">
          {field('fio', data.fio)}
          {wording('нинг яқин қариндошлари ҳақида')}
        </div>
        <div className="paper-center paper-subtitle">{wording('МАЪЛУМОТ')}</div>
        <table className="paper-relatives">
          <colgroup>
            {[1260, 2160, 1980, 2860, 2267].map((width, i) => (
              <col key={i} style={{ width: `${(width / 10527) * 100}%` }} />
            ))}
          </colgroup>
          <thead>
            <tr>
              {[
                'Қариндош-\nлиги',
                'Фамилияси, исми\nва отасининг исми',
                'Туғилган йили\nва жойи',
                'Иш жойи ва лавозими',
                'Турар жойи',
              ].map((label) => (
                <th key={label} scope="col">
                  {wording(label)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.relatives.map((relative, i) =>
              relative.name ? (
                <tr key={i}>
                  <td>{field(`relatives.${i}.rel`, wording(relative.rel))}</td>
                  <td>{field(`relatives.${i}.name`, relative.name)}</td>
                  <td>
                    {field(
                      `relatives.${i}.year`,
                      formatted(
                        template.relBirthLines(relative).join('\n'),
                        relative.place.split(/\s*,\s*/),
                      ),
                    )}
                  </td>
                  <td colSpan={relative.status === 'dead' ? 2 : 1}>
                    {field(
                      `relatives.${i}.${relative.status === 'work' ? 'job' : 'status'}`,
                      formatted(template.relWorkLines(relative).filter(Boolean).join('\n'), [
                        relative.job,
                        relative.prevJob,
                      ]),
                    )}
                  </td>
                  {relative.status !== 'dead' ? (
                    <td>{field(`relatives.${i}.address`, relative.address)}</td>
                  ) : null}
                </tr>
              ) : null,
            )}
          </tbody>
        </table>
      </Paper>
    </div>
  )
}

function Paper({ label, children }: { label: string; children: React.ReactNode }) {
  const outer = React.useRef<HTMLDivElement>(null)
  const inner = React.useRef<HTMLElement>(null)
  const [size, setSize] = React.useState({ scale: 1, height: 1123 })
  React.useLayoutEffect(() => {
    const measure = () => {
      if (!outer.current || !inner.current) return
      const scale = Math.min(1, outer.current.clientWidth / 794),
        height = inner.current.offsetHeight
      setSize((previous) =>
        previous.scale === scale && previous.height === height ? previous : { scale, height },
      )
    }
    let frame = 0
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(measure)
    })
    if (outer.current) observer.observe(outer.current)
    if (inner.current) observer.observe(inner.current)
    measure()
    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
    }
  }, [])
  return (
    <div ref={outer} className="paper-frame" style={{ height: size.height * size.scale }}>
      <article
        ref={inner}
        className="template-paper"
        aria-label={label}
        style={{ transform: `scale(${size.scale})` }}
      >
        {children}
      </article>
    </div>
  )
}
