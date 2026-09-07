// `/pages` (TECH-SPEC §3.5, EPIC-011): a list of the department's pages plus, via `?page=<id>`
// (URL-as-state, MODULE-GUIDE.md's "no path params yet" tradeoff), one page's editor + version
// history. `?tab=onboarding` switches the list view to the onboarding checklist template editor.
import * as React from 'react'
import { useT, formatDate, useLocale } from '@devon/i18n'
import { Button, Input, StateView, toast } from '@devon/ui'
import { ApiError } from '../../lib/api-client.js'
import { useMeQuery } from '../../lib/session.js'
import { useSearchParams, navigate } from '../../lib/router.js'
import { fetchMembers } from '../structure/api.js'
import { useDepartment } from '../../lib/session.js'
import { FileText, Plus } from 'lucide-react'
import {
  useCreatePageMutation,
  useDeletePageMutation,
  usePageQuery,
  usePagesQuery,
  usePatchPageMutation,
} from './use-pages.js'
import { PageEditor } from './page-editor.js'
import { VersionHistory } from './version-history.js'
import { OnboardingTemplatesPanel } from './onboarding-templates.js'
import type { PageKind, TiptapNode } from './types.js'
import type { MentionCandidate } from './mention-suggestion.js'

const PAGE_KINDS: PageKind[] = ['how_we_work', 'brief', 'note', 'onboarding']

function useDebouncedCallback<A extends unknown[]>(fn: (...args: A) => void, delayMs: number) {
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  return React.useCallback(
    (...args: A) => {
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(() => fn(...args), delayMs)
    },
    [fn, delayMs],
  )
}

function useMentionCandidates(): MentionCandidate[] {
  const { departmentId } = useDepartment()
  const [candidates, setCandidates] = React.useState<MentionCandidate[]>([])
  React.useEffect(() => {
    if (!departmentId) return
    let cancelled = false
    fetchMembers(departmentId).then((members) => {
      if (cancelled) return
      setCandidates(members.map((m) => ({ id: m.userId, label: `${m.givenName} ${m.familyName}` })))
    })
    return () => {
      cancelled = true
    }
  }, [departmentId])
  return candidates
}

function CreatePageForm({ onCreated }: { onCreated: (id: string) => void }) {
  const t = useT()
  const [open, setOpen] = React.useState(false)
  const [kind, setKind] = React.useState<PageKind>('note')
  const [title, setTitle] = React.useState('')
  const createPage = useCreatePageMutation()

  if (!open) {
    return (
      <Button size="sm" onClick={() => setOpen(true)}>
        <Plus className="mr-1.5 size-4" aria-hidden="true" />
        {t('pages.create')}
      </Button>
    )
  }

  return (
    <form
      className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-card p-3"
      onSubmit={(e) => {
        e.preventDefault()
        if (!title.trim()) return
        createPage.mutate(
          { kind, title: title.trim() },
          { onSuccess: (page) => onCreated(page.id) },
        )
      }}
    >
      <select
        value={kind}
        onChange={(e) => setKind(e.target.value as PageKind)}
        aria-label={t('pages.create')}
        className="h-9 rounded-sm border border-border bg-card px-2 text-small text-foreground"
      >
        {PAGE_KINDS.map((k) => (
          <option key={k} value={k}>
            {t(`pages.kind.${k}`)}
          </option>
        ))}
      </select>
      <Input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder={t('pages.newTitlePlaceholder')}
        aria-label={t('pages.newTitlePlaceholder')}
        autoFocus
        className="max-w-64"
      />
      <Button type="submit" size="sm" loading={createPage.isPending}>
        {t('pages.create')}
      </Button>
    </form>
  )
}

function PageList({ onOpen }: { onOpen: (id: string) => void }) {
  const t = useT()
  const pagesQuery = usePagesQuery()
  const locale = useLocale()

  if (pagesQuery.isPending) return <StateView kind="loading" titleKey="state.loading" />
  if (pagesQuery.isError) {
    return (
      <StateView
        kind="error"
        titleKey="state.error.title"
        bodyKey="state.error.body"
        action={{ labelKey: 'state.error.action', onAction: () => pagesQuery.refetch() }}
      />
    )
  }
  const pages = pagesQuery.data
  if (pages.length === 0) {
    return <StateView kind="empty" titleKey="pages.empty.title" bodyKey="pages.empty.body" />
  }

  return (
    <ul className="flex flex-col gap-1">
      {pages.map((page) => (
        <li key={page.id}>
          <button
            type="button"
            onClick={() => onOpen(page.id)}
            className="flex w-full items-center gap-3 rounded-md border border-border bg-card px-4 py-3 text-left shadow-1 hover:bg-accent"
          >
            <FileText className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <span className="flex-1 truncate text-body text-foreground">{page.title}</span>
            <span className="shrink-0 text-small text-muted-foreground">
              {t(`pages.kind.${page.kind}`)}
            </span>
            <span className="shrink-0 text-small text-muted-foreground">
              {formatDate(new Date(page.updatedAt), locale)}
            </span>
          </button>
        </li>
      ))}
    </ul>
  )
}

function PageDetail({ id, onBack }: { id: string; onBack: () => void }) {
  const t = useT()
  const pageQuery = usePageQuery(id)
  const patchPage = usePatchPageMutation(id)
  const deletePage = useDeletePageMutation()
  const mentionCandidates = useMentionCandidates()
  const [conflict, setConflict] = React.useState(false)
  const [localTitle, setLocalTitle] = React.useState('')

  React.useEffect(() => {
    if (pageQuery.data) setLocalTitle(pageQuery.data.title)
  }, [pageQuery.data?.id]) // eslint-disable-line react-hooks/exhaustive-deps -- reset only when the page identity changes, not on every refetch

  const debouncedPatch = useDebouncedCallback((patch: { title?: string; blocks?: TiptapNode }) => {
    if (!pageQuery.data) return
    patchPage.mutate(
      { ...patch, version: pageQuery.data.version },
      {
        onError: (err) => {
          if (err instanceof ApiError && err.code === 'conflict') setConflict(true)
        },
      },
    )
  }, 800)

  if (pageQuery.isPending) return <StateView kind="loading" titleKey="state.loading" />
  if (pageQuery.isError) {
    return (
      <StateView
        kind="error"
        titleKey="state.error.title"
        bodyKey="state.error.body"
        action={{ labelKey: 'state.error.action', onAction: () => pageQuery.refetch() }}
      />
    )
  }
  const page = pageQuery.data

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <button
          type="button"
          onClick={onBack}
          className="text-small text-muted-foreground hover:text-foreground hover:underline"
        >
          ← {t('pages.backToList')}
        </button>
        <div className="flex items-center gap-2">
          {patchPage.isPending ? (
            <span className="text-small text-muted-foreground">{t('pages.editor.autosaving')}</span>
          ) : (
            <span className="text-small text-muted-foreground">{t('pages.editor.saved')}</span>
          )}
          <Button
            variant="destructive"
            size="sm"
            onClick={() =>
              deletePage.mutate(page.id, {
                onSuccess: () => {
                  toast(t('pages.deleted'))
                  onBack()
                },
              })
            }
          >
            {t('pages.delete')}
          </Button>
        </div>
      </div>

      {conflict ? (
        <StateView
          kind="error"
          titleKey="pages.conflict.title"
          bodyKey="pages.conflict.body"
          action={{ labelKey: 'state.error.action', onAction: () => window.location.reload() }}
        />
      ) : (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_280px]">
          <div className="rounded-md border border-border bg-card p-6 shadow-1">
            <PageEditor
              title={localTitle}
              content={page.blocks}
              editable
              mentionCandidates={mentionCandidates}
              onTitleChange={(title) => {
                setLocalTitle(title)
                debouncedPatch({ title })
              }}
              onChange={(blocks) => debouncedPatch({ blocks })}
            />
          </div>
          <VersionHistory page={page} onRestored={() => pageQuery.refetch()} />
        </div>
      )}
    </div>
  )
}

export default function PagesScreen() {
  const t = useT()
  const meQuery = useMeQuery()
  const search = useSearchParams()
  const pageId = search.get('page')
  const tab = search.get('tab')

  if (meQuery.isPending) return <StateView kind="loading" titleKey="state.loading" />
  if (!meQuery.data) {
    return <StateView kind="forbidden" titleKey="state.denied.title" bodyKey="state.denied.body" />
  }

  if (pageId) {
    return (
      <PageDetail
        id={pageId}
        onBack={() => {
          const url = new URL(window.location.href)
          url.searchParams.delete('page')
          navigate(`${url.pathname}${url.search}`)
        }}
      />
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-h2 text-foreground">{t('pages.title')}</h1>
        <div className="flex items-center gap-2">
          <Button
            variant={tab === 'onboarding' ? 'primary' : 'secondary'}
            size="sm"
            onClick={() => {
              const url = new URL(window.location.href)
              if (tab === 'onboarding') url.searchParams.delete('tab')
              else url.searchParams.set('tab', 'onboarding')
              navigate(`${url.pathname}${url.search}`)
            }}
          >
            {t('pages.onboarding.title')}
          </Button>
          {tab !== 'onboarding' ? (
            <CreatePageForm
              onCreated={(id) => {
                const url = new URL(window.location.href)
                url.searchParams.set('page', id)
                navigate(`${url.pathname}${url.search}`)
              }}
            />
          ) : null}
        </div>
      </div>

      {tab === 'onboarding' ? (
        <OnboardingTemplatesPanel />
      ) : (
        <PageList
          onOpen={(id) => {
            const url = new URL(window.location.href)
            url.searchParams.set('page', id)
            navigate(`${url.pathname}${url.search}`)
          }}
        />
      )}
    </div>
  )
}
