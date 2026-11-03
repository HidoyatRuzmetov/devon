import * as React from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  personnelRecordSchema,
  personnelDataSchema,
  personnelExportResponseSchema,
  personnelTemplate,
  type PersonnelData,
  type PersonnelIssue,
} from '@devon/contracts'
import { useLocale, useT } from '@devon/i18n'
import { Button, StateView, Tabs, TabsList, TabsTrigger, TabsContent, toast } from '@devon/ui'
import { ArrowLeft, Download, Eye, FileText, LockKeyhole, Pencil, Sparkles } from 'lucide-react'
import { apiClient } from '../../lib/api-client.js'
import { useDepartment, useMeQuery } from '../../lib/session.js'
import { useDurableDraft } from '../../lib/use-durable-draft.js'
import { ProfessionalProfileSection } from './professional-profile-section.js'
import { PersonnelDocument, blankSchool, blankWork, blankRelative } from './personnel-document.js'
import { downloadPersonnel, toLatin } from './personnel-export.js'

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
      <div className="space-y-4 pt-3" aria-busy="true">
        <div className="h-14 animate-pulse rounded-xl bg-muted" />
        <div className="personnel-desk" aria-hidden="true">
          <div className="personnel-paper">
            <div className="personnel-masthead">
              <div className="space-y-6 pt-4">
                <div className="mx-auto h-5 w-36 animate-pulse bg-muted" />
                <div className="h-9 animate-pulse bg-muted" />
              </div>
              <div className="personnel-portrait animate-pulse bg-muted" />
            </div>
            <div className="personnel-pairs">
              {Array.from({ length: 10 }, (_, i) => (
                <div key={i} className="mb-6 space-y-3">
                  <div className="h-3 w-28 animate-pulse bg-muted" />
                  <div className="h-6 animate-pulse bg-muted" />
                </div>
              ))}
            </div>
            <div className="mx-auto my-8 h-6 w-48 animate-pulse bg-muted" />
            {[0, 1, 2].map((i) => (
              <div key={i} className="mb-4 h-8 animate-pulse bg-muted" />
            ))}
          </div>
        </div>
      </div>
    )
  const initial = query.data.version
    ? query.data.data
    : {
        ...query.data.data,
        party: '',
        degree: '',
        title: '',
        languages: '',
        awards: '',
        deputy: '',
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
  const draft = useDurableDraft(
    `devon.personnel.v1:${departmentId}:${owner}`,
    initial,
    version,
    (value: unknown): value is PersonnelData => personnelDataSchema.safeParse(value).success,
  )
  const data = readonly ? initial : draft.value
  const [issues, setIssues] = React.useState<{
    errors: PersonnelIssue[]
    warnings: PersonnelIssue[]
  } | null>(null)
  const [preview, setPreview] = React.useState(readonly)
  const [exportReview, setExportReview] = React.useState<{
    data: PersonnelData
    script: 'latin' | 'cyrillic'
  } | null>(null)
  const [exportError, setExportError] = React.useState(false)
  const form = React.useRef<HTMLFormElement>(null),
    toolbar = React.useRef<HTMLDivElement>(null)
  const previewButton = React.useRef<HTMLButtonElement>(null)
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
  const prepare = useMutation({
    mutationFn: (script: 'latin' | 'cyrillic') =>
      apiClient.post(
        '/api/v1/accounts/personnel-record/prepare-export',
        { ownerUserId: owner, data, script },
        personnelExportResponseSchema,
        csrf,
      ),
    onMutate: () => setExportError(false),
    onSuccess: (result) => {
      setExportReview(result)
      setPreview(true)
      toolbar.current?.scrollIntoView({ block: 'start', behavior: 'instant' })
      previewButton.current?.focus({ preventScroll: true })
    },
    onError: () => setExportError(true),
  })
  const busy = save.isPending || prepare.isPending
  const editingAllowed = !readonly || !!exportReview
  function edit(path?: string) {
    if (!editingAllowed || busy) return
    setPreview(false)
    if (path)
      requestAnimationFrame(() => {
        const target = form.current?.querySelector<HTMLElement>(`[data-field-path="${path}"]`)
        target?.focus({ preventScroll: true })
        target?.scrollIntoView({ block: 'center', behavior: 'instant' })
      })
  }
  function focusIssue(id: string) {
    if (editingAllowed) setPreview(false)
    requestAnimationFrame(() => {
      const target = form.current?.querySelector<HTMLElement>(`[data-validation-id="${id}"]`)
      target?.scrollIntoView({ block: 'center', behavior: 'instant' })
      target?.querySelector<HTMLElement>('input,textarea,select')?.focus({ preventScroll: true })
    })
  }
  function check(value = data) {
    const result = personnelTemplate.validate(value)
    setIssues(result)
    if (result.errors.length) focusIssue(result.errors[0]!.id)
    return result.errors.length === 0
  }
  function back() {
    setExportReview(null)
    setExportError(false)
    setIssues(null)
    setPreview(readonly)
    previewButton.current?.focus()
  }
  return (
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- Document shortcuts bubble from its native controls; retain form semantics and restore focus when preview replaces the focused input.
    <form
      ref={form}
      className="personnel-workspace space-y-4 pt-3"
      onSubmit={(event) => {
        event.preventDefault()
        if (!readonly && !busy && !exportReview && check()) save.mutate()
      }}
      onKeyDown={(event) => {
        if (
          event.key === 'Escape' &&
          !event.defaultPrevented &&
          form.current?.contains(event.target as Node) &&
          !(event.target as HTMLElement).closest('[role="listbox"],select')
        ) {
          if (preview && editingAllowed) {
            event.preventDefault()
            event.stopPropagation()
            setPreview(false)
            previewButton.current?.focus()
          } else if (exportReview) {
            event.preventDefault()
            back()
          }
        }
        if ((event.ctrlKey || event.metaKey) && event.key === 'Enter' && !busy) {
          event.preventDefault()
          setPreview((value) => (readonly && !exportReview ? true : !value))
          requestAnimationFrame(() => previewButton.current?.focus())
        }
      }}
    >
      <div ref={toolbar} className="personnel-toolbar">
        <div className="flex min-w-0 items-center gap-2 text-small font-medium">
          <FileText className="size-4 shrink-0 text-primary" />
          <span>{t(exportReview ? 'personnelDocument.exportTitle' : 'profileChoices.record')}</span>
        </div>
        <div className="personnel-toolbar-actions">
          {exportReview ? (
            <Button type="button" variant="ghost" size="sm" onClick={back}>
              <ArrowLeft className="size-4" />
              {t('personnelDocument.back')}
            </Button>
          ) : null}
          {!readonly && !exportReview ? (
            <Button
              type="submit"
              variant="secondary"
              size="sm"
              loading={save.isPending}
              disabled={prepare.isPending}
            >
              {t('work.action.save')}
            </Button>
          ) : null}
          {editingAllowed ? (
            <Button
              ref={previewButton}
              type="button"
              size="sm"
              disabled={busy}
              aria-pressed={preview}
              onClick={() => (preview ? edit() : setPreview(true))}
            >
              {preview ? <Pencil className="size-4" /> : <Eye className="size-4" />}
              {t(preview ? 'personnelDocument.edit' : 'personnelDocument.preview')}
            </Button>
          ) : null}
        </div>
      </div>
      <div className="flex flex-wrap items-start justify-between gap-2 px-1 text-caption text-muted-foreground">
        <div className="flex max-w-160 items-start gap-2">
          <LockKeyhole className="mt-0.5 size-3.5 shrink-0" />
          <div>
            <p>{t(exportReview ? 'personnelDocument.exportHint' : 'personnel.private')}</p>
            <p className="mt-1" role="status">
              {t(
                exportReview
                  ? 'personnelDocument.clickToEdit'
                  : draft.storageFailed
                    ? 'profileChoices.draftUnavailable'
                    : readonly
                      ? 'personnelDocument.readonly'
                      : 'personnel.draftSaved',
              )}
            </p>
          </div>
        </div>
        {!readonly && draft.restored && !exportReview ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={busy}
            onClick={() => {
              draft.discard()
              setIssues(null)
            }}
          >
            {t('profileChoices.discardDraft')}
          </Button>
        ) : null}
      </div>
      {issues && (issues.errors.length || issues.warnings.length) ? (
        <div className="space-y-2 rounded-lg border border-border bg-card p-4" role="status">
          <p className="text-small font-medium">{t('personnel.validation')}</p>
          {[...issues.errors, ...issues.warnings].map((issue, index) => (
            <button
              type="button"
              key={`${issue.id}:${index}`}
              className={`block text-left text-small ${index < issues.errors.length ? 'text-destructive' : 'text-muted-foreground'}`}
              onClick={() => focusIssue(issue.id)}
            >
              {locale === 'en' || locale === 'uz-Latn' ? toLatin(issue.msg) : issue.msg}
            </button>
          ))}
        </div>
      ) : null}
      <fieldset disabled={busy} className="min-w-0" aria-busy={busy}>
        <PersonnelDocument
          data={exportReview?.data ?? data}
          preview={preview}
          readonly={!editingAllowed}
          script={
            exportReview?.script ?? (locale === 'ru' || locale === 'uz-Cyrl' ? 'cyrillic' : 'latin')
          }
          onEdit={edit}
          onChange={(next) => {
            if (busy) return
            setIssues(null)
            if (exportReview) setExportReview({ ...exportReview, data: next })
            else draft.update(() => next)
          }}
        />
      </fieldset>
      <div className="sticky bottom-[calc(4rem+env(safe-area-inset-bottom))] z-10 space-y-2 rounded-xl border border-border bg-card/95 p-3 backdrop-blur-md md:bottom-2">
        {exportError ? (
          <p role="alert" className="text-small text-destructive">
            {t('personnelDocument.exportError')}
          </p>
        ) : null}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="flex max-w-120 items-start gap-2 text-caption text-muted-foreground">
            <Sparkles className="mt-0.5 size-4 shrink-0" />
            <span role="status">
              {t(
                prepare.isPending
                  ? 'personnelDocument.preparing'
                  : exportReview
                    ? 'personnelDocument.reviewHint'
                    : 'personnelDocument.aiHint',
              )}
            </span>
          </p>
          <div className="flex flex-wrap gap-2">
            {exportReview ? (
              <Button
                type="button"
                onClick={() => {
                  if (check(exportReview.data))
                    downloadPersonnel(exportReview.data, exportReview.script)
                }}
              >
                <Download className="size-4" />
                {t('personnel.downloadReviewed')}
              </Button>
            ) : (
              (['latin', 'cyrillic'] as const).map((script) => (
                <Button
                  key={script}
                  type="button"
                  variant="secondary"
                  size="sm"
                  disabled={busy}
                  loading={prepare.isPending && prepare.variables === script}
                  onClick={() => {
                    if (check()) prepare.mutate(script)
                  }}
                >
                  <Download className="size-4" />
                  {t(`personnel.${script}`)}
                </Button>
              ))
            )}
          </div>
        </div>
      </div>
    </form>
  )
}
