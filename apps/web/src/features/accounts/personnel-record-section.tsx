import * as React from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  personnelRecordSchema,
  personnelDataSchema,
  personnelTemplate,
  RELATIVE_TYPES,
  STUDY_FORMS,
  type PersonnelData,
  type PersonnelIssue,
} from '@devon/contracts'
import { useLocale, useT } from '@devon/i18n'
import {
  Button,
  Dialog,
  DialogContent,
  IconButton,
  Input,
  StateView,
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
  toast,
} from '@devon/ui'
import { Download, LockKeyhole, Plus, Trash2 } from 'lucide-react'
import { apiClient } from '../../lib/api-client.js'
import { useDepartment, useMeQuery } from '../../lib/session.js'
import { useDurableDraft } from '../../lib/use-durable-draft.js'
import { ProfessionalProfileSection } from './professional-profile-section.js'
import { AvatarPicker } from './avatar-picker.js'
import {
  downloadPersonnel,
  personnelExportFields,
  preparePersonnelExport,
  replacePersonnelField,
  toLatin,
} from './personnel-export.js'

export function ProfessionalSettings() {
  const t = useT()
  return (
    <Tabs defaultValue="resume">
      <TabsList aria-label={t('portal.profile.title')}>
        <TabsTrigger value="resume">{t('profileChoices.resume')}</TabsTrigger>
        <TabsTrigger value="record">{t('profileChoices.record')}</TabsTrigger>
      </TabsList>
      <TabsContent value="resume">
        <ProfessionalProfileSection />
      </TabsContent>
      <TabsContent value="record">
        <PersonnelRecordSection />
      </TabsContent>
    </Tabs>
  )
}
const blankSchool = (): PersonnelData['schools'][number] => ({
  year: '',
  name: '',
  form: 'кундузги',
  master: false,
})
const blankWork = (): PersonnelData['work'][number] => ({
  from: '',
  to: '',
  current: false,
  since: '',
  months: '',
  text: '',
})
const blankRelative = (
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

export function PersonnelRecordSection({ ownerUserId }: { ownerUserId?: string }) {
  const me = useMeQuery().data,
    { departmentId, department } = useDepartment()
  const owner = ownerUserId ?? me?.user.id ?? ''
  const allowed = owner === me?.user.id || department?.role === 'head'
  const query = useQuery({
    queryKey: ['accounts', 'personnel', departmentId, owner],
    enabled: !!departmentId && !!owner && allowed,
    queryFn: () =>
      apiClient.get(
        `/api/v1/accounts/personnel-record?ownerUserId=${owner}`,
        personnelRecordSchema,
      ),
    gcTime: 0,
  })
  if (!departmentId || !allowed)
    return <StateView kind="empty" titleKey="analytics.context.title" />
  if (query.isError)
    return (
      <StateView
        kind="error"
        titleKey="state.error.title"
        action={{ labelKey: 'state.error.action', onAction: () => query.refetch() }}
      />
    )
  if (!query.data)
    return (
      <div className="grid gap-5 py-5" aria-busy="true">
        {[1, 2, 3].map((i) => (
          <div key={i} className="rounded-lg border border-border p-5">
            <div className="mb-5 h-6 w-40 animate-pulse rounded bg-muted" />
            <div className="grid grid-cols-2 gap-4">
              {[1, 2, 3, 4].map((n) => (
                <div key={n} className="h-16 animate-pulse rounded bg-muted" />
              ))}
            </div>
          </div>
        ))}
      </div>
    )
  const initial = query.data.version
    ? query.data.data
    : {
        ...query.data.data,
        schools: [blankSchool()],
        work: [blankWork()],
        relatives: [blankRelative('Отаси'), blankRelative('Онаси')],
      }
  if (owner !== me?.user.id && query.data.version === 0)
    return (
      <StateView
        kind="empty"
        titleKey="peopleDownloads.noRecord"
        bodyKey="peopleDownloads.noRecordHint"
      />
    )
  return (
    <PersonnelEditor
      key={`${departmentId}:${owner}:${query.data.version}`}
      owner={owner}
      departmentId={departmentId}
      initial={initial}
      version={query.data.version}
      readonly={owner !== me?.user.id}
      csrf={me?.csrfToken ?? ''}
    />
  )
}

function PersonnelEditor({
  owner,
  departmentId,
  initial,
  version,
  readonly,
  csrf,
}: {
  owner: string
  departmentId: string
  initial: PersonnelData
  version: number
  readonly: boolean
  csrf: string
}) {
  const t = useT(),
    locale = useLocale(),
    qc = useQueryClient()
  const validateDraft = (value: unknown): value is PersonnelData =>
    personnelDataSchema.safeParse(value).success
  const draft = useDurableDraft(
    `devon.personnel.v1:${departmentId}:${owner}`,
    initial,
    version,
    validateDraft,
  )
  const data = readonly ? initial : draft.value
  const [issues, setIssues] = React.useState<{
    errors: PersonnelIssue[]
    warnings: PersonnelIssue[]
  } | null>(null)
  const [exportReview, setExportReview] = React.useState<{
    data: PersonnelData
    script: 'latin' | 'cyrillic'
  } | null>(null)
  const form = React.useRef<HTMLFormElement>(null)
  const save = useMutation({
    mutationFn: () =>
      apiClient.put(
        '/api/v1/accounts/personnel-record',
        { data, version: draft.baseRevision },
        personnelRecordSchema,
        csrf,
      ),
    onSuccess: (record) => {
      draft.acknowledge(data, record.version)
      qc.setQueryData(['accounts', 'personnel', departmentId, owner], record)
      toast.success(t('profileEdit.saved'))
    },
    onError: () => toast.error(t('portal.profile.saveError')),
  })
  const set = <K extends keyof PersonnelData>(key: K, value: PersonnelData[K]) => {
    draft.update((previous) => ({ ...previous, [key]: value }))
    setIssues(null)
  }
  const documentText = (value: string) =>
    locale === 'uz-Latn' || locale === 'en' ? toLatin(value) : value
  function check() {
    const result = personnelTemplate.validate(data)
    setIssues(result)
    if (result.errors.length)
      requestAnimationFrame(() =>
        form.current
          ?.querySelector<HTMLElement>(
            `[data-validation-id="${result.errors[0]!.id}"] input,[data-validation-id="${result.errors[0]!.id}"] select`,
          )
          ?.focus(),
      )
    return result.errors.length === 0
  }
  function input(key: keyof PersonnelData, type = 'text', options?: readonly string[]) {
    return (
      <label
        key={key}
        data-validation-id={key}
        className="flex min-w-0 flex-col gap-1.5 text-small"
      >
        <span>{t(`personnel.fields.${key}`)}</span>
        {options ? (
          <select
            className="h-11 rounded-md border border-border bg-card px-3"
            value={String(data[key] ?? '')}
            onChange={(e) => set(key, e.target.value)}
          >
            <option value="">{t('profileChoices.choose')}</option>
            {options.map((option) => (
              <option key={option} value={option}>
                {documentText(option)}
              </option>
            ))}
          </select>
        ) : (
          <Input
            type={type}
            maxLength={type === 'date' ? 10 : 3000}
            value={String(data[key] ?? '')}
            onChange={(e) => set(key, e.target.value)}
          />
        )}
      </label>
    )
  }
  type List = 'schools' | 'work' | 'relatives'
  function updateRow(list: List, index: number, key: string, value: string | boolean) {
    draft.update((previous) => ({
      ...previous,
      [list]: previous[list].map((row, i) => (i === index ? { ...row, [key]: value } : row)),
    }))
    setIssues(null)
  }
  function rowFields(
    list: List,
    index: number,
    row: Record<string, string | boolean>,
    keys: string[],
  ) {
    return (
      <div className="grid gap-3 sm:grid-cols-2">
        {keys.map((key) => {
          const val = row[key],
            options =
              key === 'rel'
                ? RELATIVE_TYPES
                : key === 'form'
                  ? STUDY_FORMS
                  : key === 'status'
                    ? ['work', 'retired', 'unemployed', 'dead', 'housewife']
                    : null
          return (
            <label
              key={key}
              className={`flex min-w-0 ${typeof val === 'boolean' ? 'flex-row items-center gap-2' : 'flex-col gap-1.5'} text-small ${['text', 'name', 'address', 'job', 'prevJob'].includes(key) ? 'sm:col-span-2' : ''}`}
            >
              {typeof val === 'boolean' ? (
                <input
                  type="checkbox"
                  className="size-4 accent-primary"
                  checked={val}
                  onChange={(e) => updateRow(list, index, key, e.target.checked)}
                />
              ) : null}
              <span>
                {t(
                  list === 'schools' && key === 'name'
                    ? 'portal.profile.institution'
                    : `personnel.fields.${key}`,
                )}
              </span>
              {options ? (
                <select
                  className="h-11 rounded-md border border-border bg-card px-3"
                  value={String(val ?? '')}
                  onChange={(e) => updateRow(list, index, key, e.target.value)}
                >
                  {key === 'rel' ? <option value="">{t('profileChoices.choose')}</option> : null}
                  {options.map((option, i) => (
                    <option key={option} value={option}>
                      {key === 'status'
                        ? t(`personnel.status.${option}`)
                        : key === 'rel'
                          ? t(`personnel.relatives.${i}`)
                          : documentText(option)}
                    </option>
                  ))}
                </select>
              ) : typeof val !== 'boolean' ? (
                <Input
                  type={key === 'since' ? 'date' : 'text'}
                  inputMode={
                    ['year', 'deathYear', 'from', 'to'].includes(key) ? 'numeric' : undefined
                  }
                  maxLength={
                    ['year', 'deathYear', 'from', 'to'].includes(key)
                      ? 4
                      : key === 'since'
                        ? 10
                        : 3000
                  }
                  value={String(val ?? '')}
                  onChange={(e) => updateRow(list, index, key, e.target.value)}
                />
              ) : null}
            </label>
          )
        })}
      </div>
    )
  }
  function list(list: List) {
    return (
      <section
        data-validation-id={list}
        className="space-y-4 rounded-xl border border-border bg-card p-4 sm:p-5"
      >
        <h2 className="text-lead font-semibold">{t(`personnel.sections.${list}`)}</h2>
        {data[list].map((entry, index) => (
          <div
            key={index}
            data-validation-id={`${list === 'schools' ? 'school' : list === 'relatives' ? 'rel' : 'work'}-${index}`}
            className="border-t border-border pt-4 first:border-0"
          >
            <div className="mb-3 flex items-center justify-between">
              <span className="text-caption font-medium text-muted-foreground">{index + 1}</span>
              {!readonly ? (
                <IconButton
                  aria-label={t('work.action.delete')}
                  disabled={save.isPending}
                  onClick={() => set(list, data[list].filter((_, i) => i !== index) as never)}
                >
                  <Trash2 />
                </IconButton>
              ) : null}
            </div>
            {rowFields(
              list,
              index,
              entry as unknown as Record<string, string | boolean>,
              list === 'schools'
                ? ['year', 'name', 'form', 'master']
                : list === 'work'
                  ? [
                      'from',
                      'current',
                      ...('current' in entry && entry.current ? ['since'] : ['to', 'months']),
                      'text',
                    ]
                  : [
                      'rel',
                      'name',
                      'year',
                      'place',
                      'status',
                      ...('status' in entry && entry.status === 'work'
                        ? ['job']
                        : 'status' in entry && entry.status === 'housewife'
                          ? []
                          : ['prevJob']),
                      ...('status' in entry && entry.status === 'dead'
                        ? ['deathYear']
                        : ['address']),
                    ],
            )}
          </div>
        ))}
        {!readonly ? (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={data[list].length >= (list === 'schools' ? 30 : list === 'work' ? 100 : 50)}
            onClick={() =>
              set(list, [
                ...data[list],
                list === 'schools'
                  ? blankSchool()
                  : list === 'work'
                    ? blankWork()
                    : blankRelative(),
              ] as never)
            }
          >
            <Plus className="size-4" />
            {t('personnel.addRow')}
          </Button>
        ) : null}
      </section>
    )
  }
  return (
    <form
      ref={form}
      className="space-y-4 pt-4"
      onSubmit={(event) => {
        event.preventDefault()
        if (!readonly && !save.isPending && check()) save.mutate()
      }}
    >
      <p className="flex items-start gap-2 rounded-lg bg-muted/50 p-3 text-small text-muted-foreground">
        <LockKeyhole className="mt-0.5 size-4 shrink-0" />
        {t('personnel.private')}
      </p>
      {!readonly ? (
        <div className="flex flex-wrap items-center justify-between gap-2 text-caption text-muted-foreground">
          <span role="status">
            {t(draft.storageFailed ? 'profileChoices.draftUnavailable' : 'personnel.draftSaved')}
          </span>
          {draft.restored ? (
            <Button type="button" variant="ghost" size="sm" onClick={draft.discard}>
              {t('profileChoices.discardDraft')}
            </Button>
          ) : null}
        </div>
      ) : null}
      <fieldset disabled={readonly || save.isPending} className="space-y-4">
        <section className="space-y-4 rounded-xl border border-border bg-card p-4 sm:p-5">
          <h2 className="text-lead font-semibold">{t('personnel.sections.personal')}</h2>
          <div data-validation-id="photo">
            <AvatarPicker
              currentSrc={data.photo}
              file={null}
              alt={data.fio}
              initials=""
              hueSeed={owner}
              disabled={readonly}
              compact
              aspectRatio={3 / 4}
              onRemove={() => set('photo', null)}
              onSelect={(file) => {
                const reader = new FileReader()
                reader.onload = () => set('photo', String(reader.result))
                reader.readAsDataURL(file)
              }}
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            {input('fio')}
            {input('birthDate', 'date')}
            {input('birthPlace')}
            {input('nationality')}
            {input('party')}
          </div>
        </section>
        <section className="grid gap-4 rounded-xl border border-border bg-card p-4 sm:grid-cols-2 sm:p-5">
          {input('eduLevel', 'text', ['ўрта', 'ўрта махсус', 'олий', 'тугалланмаган олий'])}
          {input('specialty')}
        </section>
        {list('schools')}
        <section className="grid gap-4 rounded-xl border border-border bg-card p-4 sm:grid-cols-2 sm:p-5">
          {(['degree', 'title', 'languages', 'awards', 'deputy'] as const).map((key) => input(key))}
        </section>
        {list('work')}
        {list('relatives')}
        <label className="flex flex-col gap-2 rounded-xl border border-border bg-card p-4 text-small">
          <span className="font-medium">{t('personnel.protectedNames')}</span>
          <Input
            key={draft.resetKey}
            defaultValue={data.protectedNames.join(', ')}
            maxLength={30000}
            onChange={(e) =>
              set(
                'protectedNames',
                e.target.value
                  .split(',')
                  .map((v) => v.trim())
                  .filter(Boolean),
              )
            }
          />
          <span className="text-caption text-muted-foreground">{t('personnel.protectedHint')}</span>
        </label>
      </fieldset>
      {issues ? (
        <div className="space-y-2 rounded-lg border border-border p-4" role="status">
          <p className="text-small font-medium">{t('personnel.validation')}</p>
          {[...issues.errors, ...issues.warnings].map((issue, index) => (
            <button
              type="button"
              key={`${issue.id}:${index}`}
              className={`block text-left text-small ${index < issues.errors.length ? 'text-destructive' : 'text-muted-foreground'}`}
              onClick={() => {
                const target = form.current?.querySelector<HTMLElement>(
                  `[data-validation-id="${issue.id}"]`,
                )
                target?.scrollIntoView({
                  block: 'center',
                  behavior: matchMedia('(prefers-reduced-motion: reduce)').matches
                    ? 'instant'
                    : 'smooth',
                })
                target?.querySelector<HTMLElement>('input,select')?.focus({ preventScroll: true })
              }}
            >
              {documentText(issue.msg)}
            </button>
          ))}
        </div>
      ) : null}
      <div className="sticky bottom-[calc(4rem+env(safe-area-inset-bottom))] z-10 grid grid-cols-2 items-center gap-2 border-t border-border bg-card/95 px-2 py-3 backdrop-blur-sm sm:flex sm:flex-wrap sm:justify-end md:bottom-0">
        {(['latin', 'cyrillic'] as const).map((script) => (
          <Button
            type="button"
            key={script}
            variant="secondary"
            onClick={() => {
              if (check()) setExportReview({ data: preparePersonnelExport(data, script), script })
            }}
          >
            <Download className="size-4" />
            {t(`personnel.${script}`)}
          </Button>
        ))}
        {!readonly ? (
          <Button type="submit" className="col-span-2" loading={save.isPending}>
            {t('work.action.save')}
          </Button>
        ) : null}
      </div>
      <Dialog
        open={!!exportReview}
        onOpenChange={(open) => {
          if (!open) setExportReview(null)
        }}
      >
        <DialogContent title={t('personnel.reviewTitle')} className="max-w-180">
          <p className="my-3 text-small text-muted-foreground">{t('personnel.reviewHint')}</p>
          {exportReview ? (
            <>
              <div className="max-h-[60dvh] space-y-3 overflow-y-auto pr-2">
                {personnelExportFields(exportReview.data).map((row) => (
                  <label key={row.path} className="flex flex-col gap-1 text-small">
                    <span className="text-caption text-muted-foreground">
                      {t(`personnel.fields.${row.path.split('.').at(-1)}`)}
                    </span>
                    <Input
                      value={row.value}
                      onChange={(e) =>
                        setExportReview({
                          ...exportReview,
                          data: replacePersonnelField(exportReview.data, row.path, e.target.value),
                        })
                      }
                    />
                  </label>
                ))}
              </div>
              <div className="mt-5 flex justify-end">
                <Button
                  onClick={() => {
                    downloadPersonnel(exportReview.data, exportReview.script)
                    setExportReview(null)
                  }}
                >
                  {t('personnel.downloadReviewed')}
                </Button>
              </div>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </form>
  )
}
