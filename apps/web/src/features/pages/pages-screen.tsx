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
  toast,
  toastWithUndo,
  tweenPage,
  useReducedMotion,
} from '@devon/ui'
import { useQueuedSave } from '../../lib/use-queued-save.js'
import { useMeQuery } from '../../lib/session.js'
import { useSearchParams, navigate, RouterLink } from '../../lib/router.js'
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
import type { Page, PageKind, PatchPageInput, TiptapNode } from './types.js'
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

function useMentionCandidates(): MentionCandidate[] {
  const { departmentId } = useDepartment()
  const [candidates, setCandidates] = React.useState<MentionCandidate[]>([])
  React.useEffect(() => {
    if (!departmentId) return
    let cancelled = false
    fetchMembers(departmentId)
      .then((members) => {
        if (cancelled) return
        setCandidates(
          members.map((m) => ({ id: m.userId, label: `${m.givenName} ${m.familyName}` })),
        )
      })
      .catch(() => {
        if (!cancelled) setCandidates([])
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
  const [invalid, setInvalid] = React.useState(false)
  const trigger = React.useRef<HTMLButtonElement>(null)
  const titleInput = React.useRef<HTMLInputElement>(null)
  const createPage = useCreatePageMutation()
  React.useEffect(() => {
    if (open) titleInput.current?.focus()
  }, [open])
  function cancel() {
    if (createPage.isPending) return
    setOpen(false)
    createPage.reset()
    setInvalid(false)
    requestAnimationFrame(() => trigger.current?.focus())
  }

  if (!open) {
    return (
      <Button ref={trigger} size="sm" onClick={() => setOpen(true)}>
        <Plus className="mr-1.5 size-4" aria-hidden="true" />
        {t('pages.create')}
      </Button>
    )
  }

  return (
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- Escape bubbles from native form controls to cancel this edit and restore its opener; the form remains a form.
    <form
      className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-card p-3"
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault()
          cancel()
        }
      }}
      onSubmit={(e) => {
        e.preventDefault()
        if (createPage.isPending) return
        if (!title.trim()) {
          setInvalid(true)
          titleInput.current?.focus()
          return
        }
        createPage.mutate(
          { kind, title: title.trim() },
          { onSuccess: (page) => onCreated(page.id) },
        )
      }}
    >
      <select
        value={kind}
        disabled={createPage.isPending}
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
        ref={titleInput}
        value={title}
        onChange={(e) => {
          setTitle(e.target.value)
          setInvalid(false)
          createPage.reset()
        }}
        maxLength={300}
        invalid={invalid}
        aria-describedby={invalid ? 'page-create-required' : undefined}
        disabled={createPage.isPending}
        placeholder={t('pages.newTitlePlaceholder')}
        aria-label={t('pages.newTitlePlaceholder')}
        className="max-w-64"
      />
      <Button type="submit" size="sm" loading={createPage.isPending}>
        {t('pages.create')}
      </Button>
      <Button variant="ghost" size="sm" disabled={createPage.isPending} onClick={cancel}>
        {t('common.cancel')}
      </Button>
      {invalid ? (
        <p
          id="page-create-required"
          role="alert"
          className="basis-full text-small text-destructive"
        >
          {t('personal.save.titleRequired')}
        </p>
      ) : null}
      {createPage.isError ? (
        <p role="alert" className="basis-full text-small text-destructive">
          {t('personal.save.error')}
        </p>
      ) : null}
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
  const [localTitle, setLocalTitle] = React.useState('')
  const [localBlocks, setLocalBlocks] = React.useState<TiptapNode | null>(null)
  const draft = React.useRef<Omit<PatchPageInput, 'version'>>({})
  const draftVersion = React.useRef<number | null>(null)
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const mounted = React.useRef(true)
  const [hasDraft, setHasDraft] = React.useState(false)
  const [titleError, setTitleError] = React.useState(false)
  const queuedSave = useQueuedSave<Page, PatchPageInput>(
    pageQuery.data ?? null,
    (input) => patchPage.mutateAsync(input),
    (_updated, saved) => {
      for (const key of ['title', 'blocks'] as const) {
        const desired = key === 'title' ? draft.current.title?.trim() : draft.current.blocks
        if (saved[key] !== undefined && JSON.stringify(desired) === JSON.stringify(saved[key]))
          delete draft.current[key]
      }
      const remains = Object.keys(draft.current).length > 0
      if (!remains) draftVersion.current = null
      if (mounted.current) setHasDraft(remains)
    },
  )
  const canDelete = useCan('pages.delete', {
    ownerUserIds: pageQuery.data ? [pageQuery.data.createdByUserId] : [],
  }).allowed
  const canRestoreVersion = useCan('pages.version.restore', {
    ownerUserIds: pageQuery.data ? [pageQuery.data.createdByUserId] : [],
  }).allowed

  React.useEffect(() => {
    if (!pageQuery.data) return
    if (draft.current.title === undefined) setLocalTitle(pageQuery.data.title)
    if (draft.current.blocks === undefined) setLocalBlocks(pageQuery.data.blocks)
  }, [pageQuery.data, hasDraft])

  function flush(retry = false) {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
    if (!pageQuery.data) return Promise.resolve(false)
    const fields = { ...draft.current }
    if (fields.title !== undefined) {
      if (!fields.title.trim()) {
        if (mounted.current) setTitleError(true)
        return Promise.resolve(false)
      }
      fields.title = fields.title.trim()
    }
    if (retry) draftVersion.current = pageQuery.data.version
    return retry
      ? queuedSave.retry(fields)
      : queuedSave.enqueue(fields, draftVersion.current ?? pageQuery.data.version)
  }
  const flushRef = React.useRef(flush)
  React.useLayoutEffect(() => {
    flushRef.current = flush
  })
  React.useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      if (timer.current) clearTimeout(timer.current)
      if (Object.keys(draft.current).length) void flushRef.current()
    }
  }, [])

  function edit(patch: Omit<PatchPageInput, 'version'>) {
    if (draftVersion.current === null) draftVersion.current = pageQuery.data?.version ?? null
    draft.current = { ...draft.current, ...patch }
    setHasDraft(true)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => void flushRef.current(), 800)
  }

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
          className="min-h-9 text-small text-muted-foreground hover:text-foreground hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
        >
          ← {t('pages.backToList')}
        </button>
        <div className="flex flex-wrap items-center gap-2">
          {!titleError && queuedSave.state !== 'error' && queuedSave.state !== 'conflict' ? (
            <AutosaveIndicator saving={queuedSave.isPending || hasDraft} />
          ) : null}
          {/* WALKTHROUGH-FINDINGS 6: "Sahifani oʻchirish" was the largest, reddest control on the
              knowledge-base editor -- louder than the page's own title. Deleting a page is a rare,
              deliberate act, so it moves where rare deliberate acts live: an overflow menu. And it
              is undoable now (soft delete + a 10-minute restore window), so it takes an undo toast
              rather than a confirm dialog, exactly as DESIGN.md prescribes. */}
          {canDelete ? (
            <DropdownMenu modal={false}>
              <DropdownMenuTrigger asChild>
                <IconButton aria-label={t('pages.moreActions')}>
                  <MoreHorizontal className="size-4" aria-hidden="true" />
                </IconButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  disabled={deletePage.isPending || queuedSave.isPending || hasDraft}
                  onSelect={() =>
                    deletePage.mutate(page.id, {
                      onSuccess: () => {
                        toastWithUndo({
                          message: t('pages.deleted'),
                          undoLabel: t('pages.undo'),
                          onUndo: () =>
                            restorePage.mutate(page.id, {
                              onError: () => toast.error(t('toast.saveError')),
                            }),
                        })
                        onBack()
                      },
                      onError: () => toast.error(t('toast.saveError')),
                    })
                  }
                >
                  {t('pages.delete')}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
        </div>
      </div>

      {titleError ? (
        <p id={`page-title-error-${id}`} role="alert" className="text-small text-destructive">
          {t('personal.save.titleRequired')}
        </p>
      ) : null}
      {queuedSave.state === 'error' || queuedSave.state === 'conflict' ? (
        <div className="flex flex-wrap items-center gap-2">
          <p role="alert" className="text-small text-destructive">
            {t(queuedSave.state === 'conflict' ? 'personal.save.conflict' : 'personal.save.error')}
          </p>
          <Button variant="secondary" size="sm" onClick={() => void flush(true)}>
            {t('personal.save.retry')}
          </Button>
        </div>
      ) : null}
      <div className="grid min-w-0 grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_280px]">
        <div className="min-w-0 rounded-md border border-border bg-card p-4 shadow-1 sm:p-6">
          <PageEditor
            title={localTitle}
            content={localBlocks ?? page.blocks}
            editable
            titleErrorId={titleError ? `page-title-error-${id}` : undefined}
            onBlur={() => void flush()}
            mentionCandidates={mentionCandidates}
            onTitleChange={(title) => {
              setLocalTitle(title)
              if (title.trim()) setTitleError(false)
              edit({ title })
            }}
            onChange={(blocks) => {
              setLocalBlocks(blocks)
              edit({ blocks })
            }}
          />
        </div>
        <VersionHistory
          page={page}
          canRestore={canRestoreVersion}
          restoreDisabled={hasDraft || queuedSave.isPending}
          onRestored={() => pageQuery.refetch()}
          authorName={(userId) => mentionCandidates.find((c) => c.id === userId)?.label}
        />
      </div>
    </motion.div>
  )
}

export default function PagesScreen() {
  const t = useT()
  const meQuery = useMeQuery()
  const { departmentId } = useDepartment()
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
      { onSuccess: (page) => openPage(page.id), onError: () => toast.error(t('toast.saveError')) },
    )
  }

  if (meQuery.isPending) return <StateView kind="loading" titleKey="state.loading" />
  if (!meQuery.data) {
    return <StateView kind="forbidden" titleKey="state.denied.title" bodyKey="state.denied.body" />
  }
  if (!departmentId) {
    return (
      <StateView
        kind="empty"
        titleKey="departments.detail.noDepartment.title"
        bodyKey="departments.detail.noDepartment.body"
        action={{
          labelKey: 'departments.detail.noDepartment.action',
          onAction: () => navigate('/departments'),
        }}
      />
    )
  }

  if (pageId) {
    return (
      <PageDetail
        key={pageId}
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

      <RouterLink
        href="/help"
        className="flex flex-col gap-1 rounded-md border border-primary/20 bg-primary/5 p-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
      >
        <span className="font-medium text-primary">{t('help.title')}</span>
        <span className="text-small text-muted-foreground">{t('help.description')}</span>
      </RouterLink>
      {tab === 'onboarding' && canManageOnboarding ? (
        <OnboardingTemplatesPanel />
      ) : (
        <PageList onOpen={openPage} onCreateEmpty={createBlankPage} />
      )}
    </div>
  )
}
