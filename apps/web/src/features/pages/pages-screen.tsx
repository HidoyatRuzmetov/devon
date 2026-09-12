// `/pages` (TECH-SPEC §3.5, EPIC-011): a list of the department's pages plus, via `?page=<id>`
// (URL-as-state, MODULE-GUIDE.md's "no path params yet" tradeoff), one page's editor + version
// history. `?tab=onboarding` switches the list view to the onboarding checklist template editor.
import * as React from 'react'
import { motion } from 'motion/react'
import { useT, formatDate, useLocale } from '@devon/i18n'
import {
  AnimatedCheck,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  HoverLift,
  IconButton,
  Input,
  PageHeader,
  Stagger,
  StaggerItem,
  StateView,
  toastWithUndo,
  tweenPage,
  useReducedMotion,
} from '@devon/ui'
import { ApiError } from '../../lib/api-client.js'
import { useMeQuery } from '../../lib/session.js'
import { useSearchParams, navigate } from '../../lib/router.js'
import { fetchMembers } from '../structure/api.js'
import { useDepartment } from '../../lib/session.js'
import {
  BookOpen,
  ClipboardList,
  FileText,
  MoreHorizontal,
  Notebook,
  Plus,
  StickyNote,
} from 'lucide-react'
import {
  useCreatePageMutation,
  useDeletePageMutation,
  useRestorePageMutation,
  usePageQuery,
  usePagesQuery,
  usePatchPageMutation,
} from './use-pages.js'
import { PageEditor } from './page-editor.js'
import { VersionHistory } from './version-history.js'
import { OnboardingTemplatesPanel } from './onboarding-templates.js'
import { Can, useCan } from '../../lib/can.js'
import type { PageKind, TiptapNode } from './types.js'
import type { MentionCandidate } from './mention-suggestion.js'

const PAGE_KINDS: PageKind[] = ['how_we_work', 'brief', 'note', 'onboarding']

/** Shared between a row in `PageList` and `PageDetail`'s own outer panel -- UI-OVERHAUL.md §3
 * "pages open with a shared-layout transition": the row's own box morphs into the detail panel
 * instead of the list simply being replaced by it. `PagesScreen` swaps one for the other in the
 * same commit (a `?page=` search-param change, not a route change), which is exactly the case
 * `layoutId` is for -- matched by id even though the two elements are otherwise unrelated. */
function pageLayoutId(id: string): string {
  return `page-panel-${id}`
}

const KIND_ICON: Record<PageKind, React.ComponentType<React.SVGProps<SVGSVGElement>>> = {
  how_we_work: BookOpen,
  brief: ClipboardList,
  note: StickyNote,
  onboarding: Notebook,
}

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

function PageList({
  onOpen,
  onCreateEmpty,
}: {
  onOpen: (id: string) => void
  /** Fired by the empty state's one action (DESIGN.md §9.6: exactly one action) -- creates a
   *  ready-to-rename page directly rather than duplicating the header's kind-picker form here. */
  onCreateEmpty: () => void
}) {
  const t = useT()
  const pagesQuery = usePagesQuery()
  const locale = useLocale()
  const reduced = useReducedMotion()

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
    return (
      // Centred in the content area, not left sitting near the top with the rest of the column
      // empty below it.
      <div className="flex min-h-[50vh] flex-col items-center justify-center">
        <StateView
          kind="empty"
          titleKey="pages.empty.title"
          bodyKey="pages.empty.body"
          action={{ labelKey: 'pages.create', onAction: onCreateEmpty }}
        />
      </div>
    )
  }

  // A page tree grouped by kind (UI-OVERHAUL.md §2 "Pages ... page tree sidebar"): the department's
  // pages have no free-form folder hierarchy of their own (TECH-SPEC §3.5's four fixed `PageKind`s
  // are the only grouping this data model has), so the tree's branches are those four kinds -- each
  // with its own icon, holding whichever pages exist under it, empty groups omitted entirely.
  const groups = PAGE_KINDS.map((kind) => ({
    kind,
    pages: pages.filter((p) => p.kind === kind),
  })).filter((g) => g.pages.length > 0)

  return (
    <div className="flex flex-col gap-6">
      {groups.map(({ kind, pages: kindPages }) => {
        const Icon = KIND_ICON[kind]
        return (
          <section key={kind} className="flex flex-col gap-2">
            <h2 className="flex items-center gap-2 text-small font-medium text-muted-foreground">
              <Icon className="size-4 shrink-0" aria-hidden="true" />
              {t(`pages.kind.${kind}`)}
              <span className="text-caption tabular-nums">({kindPages.length})</span>
            </h2>
            <Stagger as="ul" className="flex flex-col gap-1">
              {kindPages.map((page) => (
                <StaggerItem as="li" key={page.id}>
                  <HoverLift>
                    <motion.button
                      type="button"
                      {...(reduced ? {} : { layoutId: pageLayoutId(page.id) })}
                      onClick={() => onOpen(page.id)}
                      className="flex w-full items-center gap-3 rounded-md border border-border bg-card px-4 py-3 text-left shadow-1 hover:bg-accent"
                    >
                      <FileText
                        className="size-4 shrink-0 text-muted-foreground"
                        aria-hidden="true"
                      />
                      <span className="flex-1 truncate text-body text-foreground">
                        {page.title}
                      </span>
                      <span className="shrink-0 text-small text-muted-foreground">
                        {formatDate(new Date(page.updatedAt), locale)}
                      </span>
                    </motion.button>
                  </HoverLift>
                </StaggerItem>
              ))}
            </Stagger>
          </section>
        )
      })}
    </div>
  )
}

function AutosaveIndicator({ saving }: { saving: boolean }) {
  const t = useT()
  // The check *draws in* the moment a save lands (DESIGN.md's motion catalogue: "task done" never
  // just appears) -- keyed so each successful save remounts a fresh `AnimatedCheck` and its
  // `checked` flips false -> true one frame after mount, not already-true on arrival.
  const [saveEpoch, setSaveEpoch] = React.useState(0)
  const wasSaving = React.useRef(saving)
  React.useEffect(() => {
    if (wasSaving.current && !saving) setSaveEpoch((e) => e + 1)
    wasSaving.current = saving
  }, [saving])

  return (
    <span
      role="status"
      aria-live="polite"
      className="flex items-center gap-1.5 text-small text-muted-foreground"
    >
      {saving ? (
        <span
          aria-hidden="true"
          className="size-1.5 shrink-0 animate-pulse rounded-full bg-warning"
        />
      ) : (
        <DrawnCheck key={saveEpoch} />
      )}
      {saving ? t('pages.editor.autosaving') : t('pages.editor.saved')}
    </span>
  )
}

function DrawnCheck() {
  const [checked, setChecked] = React.useState(false)
  React.useEffect(() => {
    const id = requestAnimationFrame(() => setChecked(true))
    return () => cancelAnimationFrame(id)
  }, [])
  return <AnimatedCheck checked={checked} className="shrink-0 text-success" />
}

function PageDetail({ id, onBack }: { id: string; onBack: () => void }) {
  const t = useT()
  const reduced = useReducedMotion()
  const pageQuery = usePageQuery(id)
  const patchPage = usePatchPageMutation(id)
  const deletePage = useDeletePageMutation()
  const restorePage = useRestorePageMutation()
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
    <motion.div
      {...(reduced ? {} : { layoutId: pageLayoutId(id) })}
      transition={tweenPage}
      className="flex flex-col gap-6 rounded-md"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <button
          type="button"
          onClick={onBack}
          className="text-small text-muted-foreground hover:text-foreground hover:underline"
        >
          ← {t('pages.backToList')}
        </button>
        <div className="flex items-center gap-2">
          <AutosaveIndicator saving={patchPage.isPending} />
          {/* WALKTHROUGH-FINDINGS 6: "Sahifani oʻchirish" was the largest, reddest control on the
              knowledge-base editor -- louder than the page's own title. Deleting a page is a rare,
              deliberate act, so it moves where rare deliberate acts live: an overflow menu. And it
              is undoable now (soft delete + a 10-minute restore window), so it takes an undo toast
              rather than a confirm dialog, exactly as DESIGN.md prescribes. */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <IconButton aria-label={t('pages.moreActions')}>
                <MoreHorizontal className="size-4" aria-hidden="true" />
              </IconButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                onSelect={() =>
                  deletePage.mutate(page.id, {
                    onSuccess: () => {
                      toastWithUndo({
                        message: t('pages.deleted'),
                        undoLabel: t('pages.undo'),
                        onUndo: () => restorePage.mutate(page.id),
                      })
                      onBack()
                    },
                  })
                }
              >
                {t('pages.delete')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
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
          <VersionHistory
            page={page}
            onRestored={() => pageQuery.refetch()}
            authorName={(userId) => mentionCandidates.find((c) => c.id === userId)?.label}
          />
        </div>
      )}
    </motion.div>
  )
}

export default function PagesScreen() {
  const t = useT()
  const meQuery = useMeQuery()
  const search = useSearchParams()
  const pageId = search.get('page')
  const tab = search.get('tab')
  const createPage = useCreatePageMutation()
  const canManageOnboarding = useCan('pages.onboarding.template.manage').allowed

  function openPage(id: string) {
    const url = new URL(window.location.href)
    url.searchParams.set('page', id)
    navigate(`${url.pathname}${url.search}`)
  }

  /** The empty state's one action (DESIGN.md §9.6): creates a ready-to-rename page straight away
   *  instead of asking someone to first pick a kind and type a title in the header's tiny form. */
  function createBlankPage() {
    createPage.mutate(
      { kind: 'note', title: t('pages.untitled') },
      { onSuccess: (page) => openPage(page.id) },
    )
  }

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
      <PageHeader
        eyebrow={t('pages.eyebrow')}
        title={t('pages.title')}
        actions={
          <>
            {/* v1.1 SPEC §2.2 (D4c): the onboarding checklist is how the head introduces a
                newcomer to the department, not a shared wiki page -- every member could create, edit
                and delete the templates, and this button offered it to them. The four routes behind
                it are `{kind:'department_managed'}` now. */}
            <Can action="pages.onboarding.template.manage">
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
            </Can>
            {tab !== 'onboarding' ? <CreatePageForm onCreated={openPage} /> : null}
          </>
        }
      />

      {tab === 'onboarding' && canManageOnboarding ? (
        <OnboardingTemplatesPanel />
      ) : (
        <PageList onOpen={openPage} onCreateEmpty={createBlankPage} />
      )}
    </div>
  )
}
