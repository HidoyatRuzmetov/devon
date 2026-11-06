import { ViewSkeleton } from '../../lib/view-skeleton.js'
import * as React from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  personnelRecordSchema,
  personnelDataSchema,
  personnelExportResponseSchema,
  personnelImportResponseSchema,
  personnelTemplate,
  type PersonnelData,
  type PersonnelIssue,
} from '@devon/contracts'
import { useLocale, useT } from '@devon/i18n'
import { Button, StateView, toast } from '@devon/ui'
import { ArrowLeft, Download, Eye, FileText, LockKeyhole, Pencil, Sparkles } from 'lucide-react'
import { apiClient, ApiError } from '../../lib/api-client.js'
import { useDepartment, useMeQuery } from '../../lib/session.js'
import { useDurableDraft } from '../../lib/use-durable-draft.js'
import { PersonnelDocument, blankSchool, blankWork, blankRelative } from './personnel-document.js'
import { downloadPersonnel, toLatin } from './personnel-export.js'

export function PersonnelRecordSection({
  ownerUserId,
  initialExportScript,
}: {
  ownerUserId?: string
  initialExportScript?: 'latin' | 'cyrillic' | undefined
}) {
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
  if (!query.data) return <ViewSkeleton view="personnel" />
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
      initialExportScript={initialExportScript}
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
  initialExportScript,
}: {
  owner: string
  departmentId: string
  initial: PersonnelData
  version: number
  readonly: boolean
  csrf: string
  initialExportScript?: 'latin' | 'cyrillic' | undefined
}) {
  const t = useT(),
    locale = useLocale(),
    qc = useQueryClient()
  const draft = useDurableDraft(
    `devon.personnel.v1:${departmentId}:${owner}`,
    initial,
    version,
    (value) => (personnelDataSchema.safeParse(value).success ? (value as PersonnelData) : null),
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
  const [importError, setImportError] = React.useState<string | null>(null)
  const [importUndo, setImportUndo] = React.useState<PersonnelData | null>(null)
  const importInput = React.useRef<HTMLInputElement>(null)
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
      void qc.invalidateQueries({ queryKey: ['structure', 'members', departmentId] })
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
  const [importWarnings, setImportWarnings] = React.useState<string[]>([])
  const [unverifiedFields, setUnverifiedFields] = React.useState<string[]>([])
  const importer = useMutation({
    mutationFn: async (file: File) => {
      if (file.size > 8 * 1024 * 1024 || !/\.(pdf|docx|odt|rtf|txt|md|html|htm)$/i.test(file.name))
        throw new ApiError(422, 'validation_failed', null)
      const content = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onerror = () => reject(new Error('file_read_failed'))
        reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '')
        reader.readAsDataURL(file)
      })
      return apiClient.post(
        '/api/v1/accounts/personnel-record/import',
        { name: file.name, content },
        personnelImportResponseSchema,
        csrf,
      )
    },
    onMutate: () => setImportError(null),
    onSuccess: (result) => {
      setImportWarnings(result.warnings)
      setUnverifiedFields(result.unverifiedFields)
      setImportUndo(structuredClone(data))
      draft.update(() => ({ ...result.data, photo: data.photo }))
      setPreview(false)
      setIssues(null)
      toast.success(t('personnelDocument.importReview'))
    },
    onError: (error) =>
      setImportError(
        error instanceof ApiError && error.errors.some((issue) => issue.code === 'ai_unverified')
          ? 'personnelDocument.importUnverified'
          : error instanceof ApiError && error.status === 422
            ? 'personnelDocument.importUnreadable'
            : 'personnelDocument.importError',
      ),
  })
  const busy = save.isPending || prepare.isPending || importer.isPending
  const autoPrepared = React.useRef(false)
  React.useEffect(() => {
    if (!initialExportScript || autoPrepared.current) return
    autoPrepared.current = true
    if (check()) prepare.mutate(initialExportScript)
    // One preparation per opened record. A new dialog remounts the editor.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialExportScript])
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
  function focusIssue(issue: PersonnelIssue, showError = true) {
    if (editingAllowed) setPreview(false)
    requestAnimationFrame(() => {
      const scope = form.current?.querySelector<HTMLElement>(
        `[data-validation-id="${CSS.escape(issue.id)}"]`,
      )
      const target =
        (issue.path &&
          form.current?.querySelector<HTMLElement>(
            `[data-field-path="${CSS.escape(issue.path)}"]`,
          )) ||
        scope?.querySelector<HTMLElement>('input:not([type="file"]),textarea,select,button') ||
        scope
      target?.focus({ preventScroll: true })
      target?.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' })
      if (
        showError &&
        (target instanceof HTMLInputElement ||
          target instanceof HTMLTextAreaElement ||
          target instanceof HTMLSelectElement)
      ) {
        // Anchor the browser's accessible error message to the exact input, not the whole row.
        target.setCustomValidity(
          locale === 'en' || locale === 'uz-Latn' ? toLatin(issue.msg) : issue.msg,
        )
        target.reportValidity()
      }
    })
  }
  function check(value = data) {
    const result = personnelTemplate.validate(value)
    setIssues(result)
    if (result.errors.length) focusIssue(result.errors[0]!)
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
      noValidate
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
              disabled={prepare.isPending || importer.isPending}
            >
              {t('work.action.save')}
            </Button>
          ) : null}
          {!readonly && !exportReview ? (
            <>
              <input
                ref={importInput}
                type="file"
                className="sr-only"
                tabIndex={-1}
                accept=".pdf,.docx,.odt,.rtf,.txt,.md,.html,.htm"
                aria-label={t('personnelDocument.import')}
                disabled={busy}
                onChange={(event) => {
                  const file = event.target.files?.[0]
                  event.target.value = ''
                  if (file && !busy) importer.mutate(file)
                }}
              />
              <Button
                type="button"
                size="sm"
                variant="secondary"
                disabled={busy}
                loading={importer.isPending}
                onClick={() => importInput.current?.click()}
              >
                <Sparkles className="size-4" />
                {t('personnelDocument.import')}
              </Button>
            </>
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
      {importWarnings.length || unverifiedFields.length ? (
        <div role="status" className="rounded-md border border-border bg-accent p-3 text-small">
          <p className="font-medium">{t('personnelDocument.importReview')}</p>
          <ul className="mt-2 list-disc pl-5">
            {unverifiedFields.map((path) => (
              <li key={path}>
                <button
                  type="button"
                  className="text-left underline underline-offset-2"
                  onClick={() => edit(path)}
                >
                  {t('personnelDocument.importFieldUnverified', {
                    field: t(`personnel.fields.${path.split('.').at(-1)}`),
                  })}
                </button>
              </li>
            ))}
            {importWarnings.map((warning, index) => (
              <li key={index}>{warning}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {importError ? (
        <p role="alert" className="text-small text-destructive">
          {t(importError)}
        </p>
      ) : null}
      {importUndo && !exportReview ? (
        <div
          className="flex items-center justify-between gap-3 rounded-lg bg-accent/40 px-3 py-2 text-small"
          role="status"
        >
          <span>{t('personnelDocument.importReview')}</span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={busy}
            onClick={() => {
              draft.update(() => importUndo)
              setImportUndo(null)
              setImportWarnings([])
              setUnverifiedFields([])
            }}
          >
            {t('personnelDocument.undoImport')}
          </Button>
        </div>
      ) : null}
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
              id={`personnel-issue-${index}`}
              className={`block text-left text-small ${index < issues.errors.length ? 'text-destructive' : 'text-muted-foreground'}`}
              onClick={() => focusIssue(issue, index < issues.errors.length)}
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
          errors={issues?.errors ?? []}
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
