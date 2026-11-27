import * as React from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useT, useLocale, formatDate } from '@devon/i18n'
import { Badge, Button, Input } from '@devon/ui'
import { FileCode2, Upload, Eye, Check } from 'lucide-react'
import { useDepartment, useMeQuery } from '../../lib/session.js'
import { fetchDocuments, uploadDocument, decideDocument } from './api.js'
import { HtmlReader } from './html-reader.js'

export function DocumentsPanel() {
  const t = useT()
  const locale = useLocale()
  const { department, departmentId } = useDepartment()
  const me = useMeQuery().data!
  const qc = useQueryClient()
  const [selectedView, setView] = React.useState<'published' | 'mine' | 'review'>('published')
  const view = selectedView === 'review' && department?.role !== 'head' ? 'published' : selectedView
  const query = useQuery({
    queryKey: ['onboarding-documents', departmentId, me.user.id, view],
    queryFn: () => fetchDocuments(view),
    enabled: Boolean(departmentId),
    refetchInterval: 30_000,
  })
  const [title, setTitle] = React.useState('')
  const [file, setFile] = React.useState<File | null>(null)
  const [preview, setPreview] = React.useState<string | null>(null)
  const [reviewed, setReviewed] = React.useState<string[]>([])
  const [fileError, setFileError] = React.useState(false)
  const input = React.useRef<HTMLInputElement>(null)
  const upload = useMutation({
    mutationFn: async () =>
      uploadDocument(
        { title: title.trim(), filename: file!.name, html: await file!.text() },
        me.csrfToken,
      ),
    onSuccess: async () => {
      setTitle('')
      setFile(null)
      if (input.current) input.current.value = ''
      await qc.invalidateQueries({
        queryKey: ['onboarding-documents', departmentId],
      })
    },
  })
  const decide = useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'publish' | 'reject' }) =>
      decideDocument(id, action, query.data!.revision, me.csrfToken),
    onSuccess: (_result, input) => {
      if (input.action === 'publish') setView('published')
    },
    onSettled: () =>
      qc.invalidateQueries({
        queryKey: ['onboarding-documents', departmentId],
      }),
  })
  if (!departmentId) return <p className="text-muted-foreground">{t('onboarding.joinFirst')}</p>
  return (
    <section className="space-y-6">
      <div>
        <h2 className="text-h3">{t('onboarding.documents.title')}</h2>
        <p className="mt-2 max-w-2xl text-small text-muted-foreground">
          {t(`onboarding.documents.${view}Description`)}
        </p>
      </div>
      <div
        className="flex flex-wrap gap-1 rounded-lg border border-border bg-card p-1"
        role="group"
        aria-label={t('onboarding.documents.tab')}
      >
        {(
          [
            'published',
            'mine',
            ...(department?.role === 'head' ? (['review'] as const) : []),
          ] as const
        ).map((item) => (
          <Button
            key={item}
            size="sm"
            variant={view === item ? 'secondary' : 'ghost'}
            aria-pressed={view === item}
            onClick={() => setView(item)}
          >
            {t(`onboarding.documents.${item}View`)}
          </Button>
        ))}
      </div>
      {view === 'mine' ? (
        <form
          className="rounded-xl border border-border bg-card p-5"
          onSubmit={(e) => {
            e.preventDefault()
            if (file && title.trim() && !fileError) upload.mutate()
          }}
        >
          <div className="grid items-end gap-4 md:grid-cols-2">
            <label className="text-small font-medium">
              {t('onboarding.documents.name')}
              <Input
                className="mt-2"
                required
                maxLength={120}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={t('onboarding.documents.placeholder')}
              />
            </label>
            <label className="text-small font-medium">
              {t('onboarding.documents.file')}
              <input
                ref={input}
                type="file"
                accept=".html,.htm,text/html"
                className="mt-2 block min-h-11 w-full rounded-md border border-border px-3 py-2 text-small file:mr-3 file:rounded file:border-0 file:bg-muted file:px-3 file:py-1 file:text-foreground"
                onChange={(e) => {
                  const selected = e.target.files?.[0] ?? null
                  const invalid = Boolean(
                    selected &&
                    (!/\.html?$/i.test(selected.name) ||
                      selected.size > 2_097_152 ||
                      selected.size === 0),
                  )
                  setFileError(invalid)
                  setFile(invalid ? null : selected)
                  upload.reset()
                }}
              />
            </label>
          </div>
          <p className="mt-3 text-caption text-muted-foreground">
            {t('onboarding.documents.fileHint')}
          </p>
          {fileError || upload.isError ? (
            <p role="alert" className="mt-3 text-small text-destructive">
              {t(fileError ? 'onboarding.documents.invalid' : 'onboarding.saveError')}
            </p>
          ) : null}
          <Button
            type="submit"
            className="mt-4"
            disabled={!file || !title.trim() || fileError}
            loading={upload.isPending}
          >
            <Upload className="size-4" />
            {t('onboarding.documents.submit')}
          </Button>
          {upload.isSuccess ? (
            <p role="status" className="mt-3 text-small text-primary">
              {t('onboarding.documents.submitted')}
            </p>
          ) : null}
        </form>
      ) : null}
      {decide.isError ? (
        <p role="alert" className="text-small text-destructive">
          {t('onboarding.documents.conflict')}
        </p>
      ) : null}
      {query.isPending ? (
        <p role="status">{t('onboarding.loading')}</p>
      ) : query.isError ? (
        <div role="alert">
          <p>{t('onboarding.loadError')}</p>
          <Button onClick={() => void query.refetch()}>{t('onboarding.retry')}</Button>
        </div>
      ) : !query.data?.items.length ? (
        <p className="rounded-lg border border-dashed border-border p-6 text-small text-muted-foreground">
          {t(`onboarding.documents.${view}Empty`)}
        </p>
      ) : (
        <div className="divide-y divide-border rounded-xl border border-border bg-card">
          {query.data.items.map((doc) => (
            <article key={doc.id} className="flex flex-wrap items-center gap-4 p-5">
              <FileCode2 className="size-6 shrink-0 text-muted-foreground" aria-hidden="true" />
              <div className="min-w-0 flex-1 basis-52">
                <h3 className="break-words font-medium">{doc.title}</h3>
                <p className="mt-1 text-caption text-muted-foreground">
                  {doc.uploaderName} · {formatDate(new Date(doc.createdAt), locale)}
                </p>
                <p className="mt-1 truncate text-caption text-muted-foreground">{doc.filename}</p>
              </div>
              <Badge tone={doc.published ? 'primary' : 'neutral'}>
                {t(
                  doc.published
                    ? 'onboarding.documents.published'
                    : doc.rejected
                      ? 'onboarding.documents.rejected'
                      : doc.superseded
                        ? 'onboarding.documents.superseded'
                        : 'onboarding.documents.pending',
                )}
              </Badge>
              <div className="flex flex-wrap gap-2">
                <Button variant="secondary" size="sm" onClick={() => setPreview(doc.id)}>
                  <Eye className="size-4" />
                  {t('onboarding.documents.preview')}
                </Button>
                {view === 'review' &&
                department?.role === 'head' &&
                !doc.published &&
                !doc.rejected &&
                !doc.superseded ? (
                  <>
                    <Button
                      size="sm"
                      disabled={!reviewed.includes(doc.id) || decide.isPending}
                      title={
                        !reviewed.includes(doc.id)
                          ? t('onboarding.documents.reviewFirst')
                          : undefined
                      }
                      onClick={() => decide.mutate({ id: doc.id, action: 'publish' })}
                    >
                      <Check className="size-4" />
                      {t('onboarding.documents.publish')}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={decide.isPending}
                      onClick={() => decide.mutate({ id: doc.id, action: 'reject' })}
                    >
                      {t('onboarding.documents.reject')}
                    </Button>
                  </>
                ) : null}
              </div>
            </article>
          ))}
        </div>
      )}
      <p className="text-caption text-muted-foreground">{t('onboarding.documents.versionHint')}</p>
      {preview ? (
        <HtmlReader
          id={preview}
          onClose={() => {
            setReviewed((items) => [...new Set([...items, preview])])
            setPreview(null)
          }}
        />
      ) : null}
    </section>
  )
}
