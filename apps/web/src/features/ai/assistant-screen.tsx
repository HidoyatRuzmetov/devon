import {
  AI_CHAT_MESSAGE_MAX,
  type AiChatAttachment,
  type AiChatMessage,
  type AiChatProposal,
} from '@devon/contracts'
import { formatDate, useLocale, useT } from '@devon/i18n'
import {
  Button,
  Dialog,
  DialogContent,
  DialogTrigger,
  IconButton,
  Input,
  StateView,
  Textarea,
  cn,
  tweenPage,
  useReducedMotion,
} from '@devon/ui'
import {
  ArrowDown,
  ArrowUp,
  ArrowUpRight,
  File,
  History,
  Link2,
  LoaderCircle,
  Paperclip,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  Sparkles,
  Square,
  TriangleAlert,
} from 'lucide-react'
import { motion } from 'motion/react'
import * as React from 'react'
import { useIsHead } from '../../lib/can.js'
import { RouterLink, replaceSearchParam, useSearchParams } from '../../lib/router.js'
import { useDepartment, useMeQuery } from '../../lib/session.js'
import { useMediaQuery } from '../../lib/use-media-query.js'
import { useOnline } from '../../lib/use-online.js'
import { useViewportBoundedHeight } from '../../lib/use-viewport-bounded-height.js'
import { chatFailure } from './chat-failure.js'
import { chatSourceHref } from './chat-source-href.js'
import { AnswerMarkdown } from './components/answer-markdown.js'
import { ChatFileQueue, useChatFiles } from './components/chat-files.js'
import { ChatProposalBatch } from './components/chat-proposal.js'
import { CatchUpPreview } from './components/previews.js'
import {
  useCancelConversationMessageMutation,
  useConversationQuery,
  useConversationsQuery,
  useCreateConversationMutation,
  useSendConversationMessageMutation,
} from './conversations.js'
import { parseFeatureOutput, type CatchUpOutput } from './outputs.js'
import { useBriefingQuery, useRefreshBriefingMutation } from './use-ai.js'

const drill = (path: string) => `${path}${path.includes('?') ? '&' : '?'}from=assistant`
const conversationId = (value: string | null) =>
  value && /^[0-9a-f-]{36}$/i.test(value) ? value : null
const scrollPosition = (node: HTMLElement) => ({
  top: node.scrollTop,
  height: node.clientHeight,
  width: node.clientWidth,
  contentHeight: node.scrollHeight,
})

function Message({
  message,
  retry,
  busy,
  onNew,
  conversationId,
  audience,
  onEditProposal,
  attachments,
}: {
  message: AiChatMessage
  retry: () => void
  busy: boolean
  onNew: () => void
  conversationId: string
  audience: 'head' | 'member'
  onEditProposal: (proposal: AiChatProposal) => void
  attachments: AiChatAttachment[]
}) {
  const t = useT()
  const locale = useLocale()
  const reduced = useReducedMotion()
  const failed = message.status === 'failed' || message.status === 'cancelled'
  const failure = chatFailure(message.error)
  return (
    <motion.article
      initial={{ opacity: 0, y: reduced ? 0 : 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={reduced ? { duration: 0 } : tweenPage}
      aria-label={t(
        message.role === 'user'
          ? 'overviewChat.you'
          : audience === 'member'
            ? 'homeMember.assistant'
            : 'overviewChat.assistant',
      )}
      className={cn(
        'min-w-0',
        message.role === 'user'
          ? 'ml-auto max-w-[88%] rounded-lg bg-accent px-4 py-3'
          : 'w-full py-2',
      )}
    >
      {message.role === 'assistant' ? (
        <div className="mb-2 flex items-center gap-2 text-caption font-medium text-primary">
          <Sparkles className="size-3.5" aria-hidden="true" />
          {t(audience === 'member' ? 'homeMember.assistant' : 'overviewChat.assistant')}
        </div>
      ) : null}
      {message.role === 'assistant' ? (
        <AnswerMarkdown
          content={message.content}
          sources={message.sources.map((source) => source.href)}
          conversationId={conversationId}
        />
      ) : (
        <p className="whitespace-pre-wrap text-small [overflow-wrap:anywhere]">{message.content}</p>
      )}
      {message.attachments?.length ? (
        <div className="mt-2 flex flex-wrap gap-2" aria-label={t('attachments.title')}>
          {message.attachments.map((file) => (
            <a
              key={file.id}
              href={
                (file.downloadPath?.startsWith('/api/v1/') ? file.downloadPath : undefined) ??
                `/api/v1/ai/conversations/${encodeURIComponent(conversationId)}/attachments/${encodeURIComponent(file.id)}/download`
              }
              download={file.name}
              className="inline-flex max-w-full items-center gap-1.5 rounded-md border border-border bg-card px-2 py-1.5 text-caption text-primary"
            >
              <File className="size-3.5 shrink-0" aria-hidden="true" />
              <span className="truncate">{file.name}</span>
            </a>
          ))}
        </div>
      ) : null}
      {message.proposals?.length ? (
        <ChatProposalBatch
          proposals={message.proposals}
          messageId={message.id}
          conversationId={conversationId}
          sources={message.sources}
          attachments={attachments}
          onEdit={onEditProposal}
          disabled={busy}
        />
      ) : null}
      {message.sources.length ? (
        <div
          className="mt-3 flex flex-wrap items-center gap-1.5"
          aria-label={t('overviewChat.sources')}
        >
          {message.sources
            .filter((source) => chatSourceHref(source.href))
            .map((source) => (
              <RouterLink
                key={source.ref}
                href={chatSourceHref(source.href, conversationId)!}
                className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-border px-2 py-1 text-caption text-primary hover:bg-accent"
              >
                <Link2 className="size-3 shrink-0" aria-hidden="true" />
                <span className="truncate">{source.title}</span>
              </RouterLink>
            ))}
        </div>
      ) : null}
      {message.context ? (
        <p className="mt-2 text-caption text-muted-foreground">
          {message.context.recordsIncluded === 0 && message.context.recordsTotal === 0
            ? t('overviewChat.updated', {
                date: formatDate(new Date(message.context.generatedAt), locale),
              })
            : t(
                message.context.limited
                  ? message.context.recordsTotal === 1
                    ? 'overviewChat.contextLimitedOne'
                    : 'overviewChat.contextLimited'
                  : message.context.recordsIncluded === 1
                    ? 'overviewChat.contextOne'
                    : 'overviewChat.context',
                {
                  count: message.context.recordsIncluded,
                  total: message.context.recordsTotal,
                  date: formatDate(new Date(message.context.generatedAt), locale),
                },
              )}
        </p>
      ) : null}
      {failed ? (
        <div
          className="mt-2 flex flex-wrap items-center gap-2 text-caption text-destructive"
          role="status"
        >
          <TriangleAlert className="size-3.5" aria-hidden="true" />
          <span>{t(message.status === 'cancelled' ? 'overviewChat.cancelled' : failure.key)}</span>
          {failure.retryable ? (
            <Button size="sm" variant="ghost" onClick={retry} disabled={busy}>
              {t('overviewChat.retry')}
            </Button>
          ) : null}
          {failure.newConversation ? (
            <Button size="sm" variant="ghost" onClick={onNew}>
              {t('overviewChat.new')}
            </Button>
          ) : null}
        </div>
      ) : null}
    </motion.article>
  )
}

export function AssistantWorkspace({
  audience = 'head',
  allowConversationRoute = true,
}: {
  audience?: 'head' | 'member'
  allowConversationRoute?: boolean
}) {
  const t = useT(),
    locale = useLocale(),
    reduced = useReducedMotion(),
    online = useOnline()
  const desktop = useMediaQuery('(min-width: 1024px)')
  const search = useSearchParams()
  const routeId = allowConversationRoute ? conversationId(search.get('conversation')) : null
  const [selectedId, setSelectedId] = React.useState<string | null>(routeId)
  const [draft, setDraft] = React.useState('')
  const [historyOpen, setHistoryOpen] = React.useState(false)
  const [historySearch, setHistorySearch] = React.useState('')
  const [debouncedSearch, setDebouncedSearch] = React.useState('')
  const [viewportRef, height] = useViewportBoundedHeight<HTMLDivElement>(0, true)
  React.useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(historySearch.trim()), 200)
    return () => window.clearTimeout(timer)
  }, [historySearch])
  const [unread, setUnread] = React.useState(false)
  const [retryAttempt, setRetryAttempt] = React.useState<{
    conversationId: string
    id: string
    content: string
    attachmentIds?: string[]
    attachments?: AiChatAttachment[]
  } | null>(null)
  const createId = React.useRef(crypto.randomUUID())
  const selectionGeneration = React.useRef(0)
  const composer = React.useRef<HTMLTextAreaElement>(null)
  const fileInput = React.useRef<HTMLInputElement>(null)
  const scroller = React.useRef<HTMLDivElement>(null)
  const touchY = React.useRef<number | null>(null)
  const pointerScrollTop = React.useRef<number | null>(null)
  const scrollSnapshot = React.useRef<ReturnType<typeof scrollPosition> | null>(null)
  // Following is reader intent, not a distance recalculated during browser scroll anchoring.
  // A narrower viewport can move the bottom hundreds of pixels without the reader scrolling.
  const nearBottom = React.useRef(true)
  const attachScroller = React.useCallback((node: HTMLDivElement | null) => {
    scroller.current = node
    if (!node) return
    // AnimatePresence mounts the log only after the briefing exits. Restore the bottom when
    // the actual scroll node exists, including cached history with unchanged message counts.
    const pinToBottom = () => {
      if (nearBottom.current) node.scrollTop = node.scrollHeight
      scrollSnapshot.current = scrollPosition(node)
    }
    pinToBottom()
    const observer = new ResizeObserver(pinToBottom)
    observer.observe(node)
    if (node.firstElementChild) observer.observe(node.firstElementChild)
    const releasePointer = () => {
      pointerScrollTop.current = null
      scrollSnapshot.current = null
    }
    window.addEventListener('pointerup', releasePointer)
    window.addEventListener('pointercancel', releasePointer)
    return () => {
      observer.disconnect()
      window.removeEventListener('pointerup', releasePointer)
      window.removeEventListener('pointercancel', releasePointer)
      if (scroller.current === node) scroller.current = null
      pointerScrollTop.current = null
    }
  }, [])
  const selectedRef = React.useRef(selectedId)
  selectedRef.current = selectedId
  const briefingQuery = useBriefingQuery(audience === 'head'),
    refresh = useRefreshBriefingMutation()
  const history = useConversationsQuery(true, debouncedSearch)
  const conversation = useConversationQuery(selectedId)
  const create = useCreateConversationMutation(),
    send = useSendConversationMessageMutation(),
    cancel = useCancelConversationMessageMutation()
  const brief = audience === 'head' ? briefingQuery.data?.briefing : undefined
  const output = brief?.data ? parseFeatureOutput<CatchUpOutput>('catch_up', brief.data) : null
  const current = conversation.data
  const pending = current?.messages.find((message) => message.status === 'pending')
  const savedChats = history.data?.pages.flatMap((page) => page.conversations) ?? []
  const busy = create.isPending || send.isPending || current?.status === 'running'
  const briefingPending = brief?.status === 'queued' || brief?.status === 'running'
  const briefingError = audience === 'head' && (briefingQuery.isError || refresh.isError)
  const files = useChatFiles(selectedId, ensureConversation)

  React.useEffect(() => {
    if (selectedRef.current === routeId) return
    selectionGeneration.current++
    setSelectedId(routeId)
    setRetryAttempt(null)
    nearBottom.current = true
  }, [routeId])

  React.useEffect(
    () => () => {
      selectionGeneration.current++
    },
    [],
  )

  React.useLayoutEffect(() => {
    const node = composer.current
    if (!node) return
    // Starter prompts and restored drafts change without an input event. Re-measure them too,
    // and return to a single-line preview when the mobile conversation closes.
    node.style.height = 'auto'
    node.style.height = `${Math.max(40, Math.min(node.scrollHeight, 160))}px`
  }, [draft, desktop])

  const scrollToLatest = React.useCallback(() => {
    if (scroller.current)
      scroller.current.scrollTo({
        top: scroller.current.scrollHeight,
        behavior: reduced ? 'instant' : 'smooth',
      })
    nearBottom.current = true
    setUnread(false)
  }, [reduced])
  const pauseFollowing = React.useCallback(() => {
    nearBottom.current = false
    // Stop an in-flight smooth reveal before native wheel/touch/keyboard scrolling takes over.
    const node = scroller.current
    node?.scrollTo({ top: node.scrollTop, behavior: 'instant' })
  }, [])
  React.useEffect(() => {
    if (nearBottom.current) scrollToLatest()
    else setUnread(true)
  }, [current?.id, current?.messages.length, current?.status, scrollToLatest])

  function choose(id: string) {
    selectionGeneration.current++
    setSelectedId(id)
    setHistoryOpen(false)
    setRetryAttempt(null)
    nearBottom.current = true
    replaceSearchParam('conversation', id)
  }
  function startNew() {
    selectionGeneration.current++
    setSelectedId(null)
    selectedRef.current = null
    createId.current = crypto.randomUUID()
    setDraft('')
    setRetryAttempt(null)
    setHistoryOpen(false)
    create.reset()
    send.reset()
    cancel.reset()
    replaceSearchParam('conversation', null)
    composer.current?.focus({ preventScroll: true })
  }
  async function request(input: {
    conversationId: string
    id: string
    content: string
    attachmentIds?: string[]
    attachments?: AiChatAttachment[]
  }) {
    setRetryAttempt(null)
    nearBottom.current = true
    try {
      await send.mutateAsync(input)
    } catch {
      if (selectedRef.current === input.conversationId) setRetryAttempt(input)
    }
  }
  async function ensureConversation(): Promise<string | null> {
    const generation = selectionGeneration.current
    let id = selectedId
    if (!id) {
      try {
        const result = await create.mutateAsync({
          id: createId.current,
          locale,
          seedBriefing: audience === 'head',
        })
        if (generation !== selectionGeneration.current) return null
        id = result.id
        choose(id)
      } catch {
        return null
      }
    }
    return id
  }
  async function submit(event: React.FormEvent) {
    event.preventDefault()
    const content = draft.trim()
    if (!content || content.length > AI_CHAT_MESSAGE_MAX || busy || !online || files.blocked) return
    const attached = files.ready
    const id = await ensureConversation()
    if (!id) return
    choose(id)
    setDraft('')
    files.consumed(attached.map((file) => file.id))
    composer.current?.focus({ preventScroll: true })
    await request({
      conversationId: id,
      id: crypto.randomUUID(),
      content,
      ...(attached.length
        ? { attachmentIds: attached.map((file) => file.id), attachments: attached }
        : {}),
    })
  }
  function editProposal(proposal: AiChatProposal) {
    setDraft(t('assistantActions.revisePrompt', { title: proposal.title }))
    composer.current?.focus({ preventScroll: true })
  }
  const historyPanel = (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <Button
        size="sm"
        onClick={startNew}
        disabled={create.isPending}
        className="w-full justify-start gap-2"
      >
        <Plus className="size-4" aria-hidden="true" />
        {t('overviewChat.new')}
      </Button>
      <div className="relative">
        <Search
          className="pointer-events-none absolute left-3 top-3 size-4 text-muted-foreground"
          aria-hidden="true"
        />
        <Input
          value={historySearch}
          maxLength={160}
          onChange={(event) => setHistorySearch(event.target.value)}
          placeholder={t('assistantWorkspace.search')}
          aria-label={t('assistantWorkspace.search')}
          className="pl-9"
        />
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto overscroll-contain">
        <h2 className="px-2 pb-1 text-caption font-semibold text-muted-foreground">
          {t('overviewChat.history')}
        </h2>
        {history.isPending ? (
          <p role="status" className="p-2 text-small text-muted-foreground">
            {t('state.loading')}
          </p>
        ) : history.isError ? (
          <Button variant="ghost" onClick={() => void history.refetch()}>
            {t('state.error.action')}
          </Button>
        ) : savedChats.length ? (
          savedChats.map((item) => (
            <button
              type="button"
              key={item.id}
              onClick={() => choose(item.id)}
              title={item.title}
              aria-current={item.id === selectedId ? 'page' : undefined}
              className={cn(
                'flex h-9 w-full shrink-0 cursor-pointer items-center rounded-md px-2.5 text-left text-small transition-colors hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring [@media(pointer:coarse)]:h-11',
                item.id === selectedId && 'bg-primary/10 text-primary',
              )}
            >
              <span className="block truncate">{item.title}</span>
            </button>
          ))
        ) : (
          <p className="p-2 text-small text-muted-foreground">
            {t(debouncedSearch ? 'assistantWorkspace.noMatches' : 'overviewChat.noHistory')}
          </p>
        )}
        {history.hasNextPage ? (
          <Button
            variant="ghost"
            className="w-full shrink-0"
            disabled={history.isFetchingNextPage}
            onClick={() => void history.fetchNextPage()}
          >
            {t('overviewChat.loadMore')}
          </Button>
        ) : null}
      </div>
      <RouterLink
        href={
          selectedId ? `/account/ai?conversation=${encodeURIComponent(selectedId)}` : '/account/ai'
        }
        className="flex min-h-11 shrink-0 items-center gap-2 rounded-md px-2 text-small text-muted-foreground transition-colors hover:bg-primary/5 hover:text-foreground"
      >
        <Settings2 className="size-4" aria-hidden="true" />
        {t('assistantWorkspace.settings')}
      </RouterLink>
    </div>
  )
  return (
    <div
      ref={viewportRef}
      data-testid="assistant-workspace"
      style={{ height: height ?? 'calc(100dvh - 144px)' }}
      className="grid min-h-0 overflow-hidden rounded-xl border border-border bg-card shadow-1 lg:grid-cols-[248px_minmax(0,1fr)]"
    >
      <aside
        aria-label={t('overviewChat.history')}
        className="hidden min-h-0 border-r border-border bg-muted/25 p-4 lg:block"
      >
        {historyPanel}
      </aside>
      <section aria-label={t('assistantWorkspace.title')} className="flex min-h-0 min-w-0 flex-col">
        <header className="flex min-h-16 shrink-0 items-center justify-between gap-3 border-b border-border/60 px-3 sm:px-6">
          <div className="flex min-w-0 items-center gap-2">
            {!desktop ? (
              <Dialog open={historyOpen} onOpenChange={setHistoryOpen}>
                <DialogTrigger asChild>
                  <IconButton
                    aria-label={t('overviewChat.history')}
                    tooltip={t('overviewChat.history')}
                  >
                    <History className="size-4" />
                  </IconButton>
                </DialogTrigger>
                <DialogContent
                  title={t('overviewChat.history')}
                  className="flex h-[min(80dvh,640px)] max-w-sm flex-col"
                >
                  <div className="min-h-0 flex-1">{historyPanel}</div>
                </DialogContent>
              </Dialog>
            ) : null}
            <h1 className="truncate text-body font-semibold" title={current?.title}>
              {current?.title || t('assistantWorkspace.title')}
            </h1>
          </div>
          {!desktop ? (
            <IconButton
              aria-label={t('overviewChat.new')}
              tooltip={t('overviewChat.new')}
              onClick={startNew}
              disabled={create.isPending}
            >
              <Plus className="size-4" />
            </IconButton>
          ) : (
            <span className="shrink-0 text-caption text-muted-foreground">
              {t('assistantWorkspace.private')}
            </span>
          )}
        </header>
        <div className="relative flex min-h-0 flex-1 flex-col">
          {/* eslint-disable jsx-a11y/no-noninteractive-tabindex, jsx-a11y/no-noninteractive-element-interactions -- This bounded log is keyboard-scrollable and tracks reader scroll intent. */}
          <div
            ref={attachScroller}
            data-testid="ai-messages"
            role="log"
            tabIndex={0}
            aria-label={t('overviewChat.messages')}
            aria-live="polite"
            aria-relevant="additions"
            className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring lg:px-6"
            onWheel={(event) => {
              if (event.deltaY < 0) pauseFollowing()
            }}
            onTouchStart={(event) => {
              touchY.current = event.touches[0]?.clientY ?? null
            }}
            onTouchMove={(event) => {
              const nextY = event.touches[0]?.clientY
              if (nextY !== undefined && touchY.current !== null && nextY > touchY.current)
                pauseFollowing()
              touchY.current = nextY ?? null
            }}
            onTouchEnd={() => {
              touchY.current = null
            }}
            onKeyDown={(event) => {
              if (
                ['ArrowUp', 'PageUp', 'Home'].includes(event.key) ||
                (event.key === ' ' && event.shiftKey)
              )
                pauseFollowing()
            }}
            onPointerDown={(event) => {
              // Native scrollbar drags target the scroll container itself, not its content.
              if (event.pointerType === 'mouse' && event.target === event.currentTarget)
                pointerScrollTop.current = event.currentTarget.scrollTop
            }}
            onScroll={() => {
              const node = scroller.current
              if (!node) return
              const previous = scrollSnapshot.current
              const next = scrollPosition(node)
              // Some native scrollbars never dispatch pointer events. A reverse scroll with
              // unchanged geometry is reader input; viewport/content reflow is not.
              if (
                previous &&
                next.top < previous.top - 2 &&
                next.height === previous.height &&
                next.width === previous.width &&
                next.contentHeight === previous.contentHeight
              )
                nearBottom.current = false
              if (
                pointerScrollTop.current !== null &&
                node.scrollTop < pointerScrollTop.current - 1
              )
                nearBottom.current = false
              if (node.scrollHeight - node.scrollTop - node.clientHeight <= 2)
                nearBottom.current = true
              if (nearBottom.current) setUnread(false)
              scrollSnapshot.current = next
            }}
          >
            <div className="mx-auto flex max-w-192 flex-col gap-6 pb-5">
              {selectedId && conversation.isPending ? (
                <p role="status" className="text-small text-muted-foreground">
                  {t('state.loading')}
                </p>
              ) : conversation.isError ? (
                <div role="alert" className="text-small text-destructive">
                  <p>{t('overviewChat.loadFailed')}</p>
                  <Button variant="ghost" onClick={() => void conversation.refetch()}>
                    {t('state.error.action')}
                  </Button>
                </div>
              ) : current?.messages.length ? (
                current.messages.map((message) => (
                  <Message
                    key={message.id}
                    message={message}
                    busy={Boolean(busy) || !online}
                    onNew={startNew}
                    conversationId={current.id}
                    audience={audience}
                    onEditProposal={editProposal}
                    attachments={current.messages.flatMap((item) => item.attachments ?? [])}
                    retry={() => {
                      if (selectedId)
                        void request({
                          conversationId: selectedId,
                          id: message.id,
                          content: message.content,
                          ...(message.attachments?.length
                            ? {
                                attachmentIds: message.attachments.map((file) => file.id),
                                attachments: message.attachments,
                              }
                            : {}),
                        })
                    }}
                  />
                ))
              ) : (
                <div className="flex flex-col gap-6 py-8 sm:py-12">
                  <div className="flex size-12 items-center justify-center rounded-2xl border border-primary/10 bg-primary/5 text-primary">
                    <Sparkles className="size-6" aria-hidden="true" />
                  </div>
                  <div className="space-y-2">
                    <h2 className="font-display text-h2 sm:text-h1">
                      {t('assistantWorkspace.welcome')}
                    </h2>
                    <p className="max-w-140 text-body leading-relaxed text-muted-foreground">
                      {t(
                        audience === 'member'
                          ? 'homeMember.assistantHint'
                          : 'overviewChat.welcomeHint',
                      )}
                    </p>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-3">
                    {['priorities', 'projectUpdate', 'draftPage'].map((key) => (
                      <button
                        type="button"
                        key={key}
                        onClick={() => {
                          setDraft(t(`homeMember.prompts.${key}`))
                          composer.current?.focus({ preventScroll: true })
                        }}
                        className="group flex min-h-16 cursor-pointer items-center justify-between gap-3 rounded-lg border border-border bg-card px-4 py-3 text-left text-small font-medium transition-colors hover:border-primary/30 hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        {t(`homeMember.starters.${key}`)}
                        <ArrowUpRight
                          className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5 motion-reduce:transform-none"
                          aria-hidden="true"
                        />
                      </button>
                    ))}
                  </div>
                  {audience === 'head' ? (
                    <details className="rounded-lg border border-border bg-background/60 p-4">
                      <summary className="cursor-pointer text-small font-semibold">
                        {t('home.head.catchUp.title')}
                        {brief?.generatedAt ? (
                          <span className="ml-2 font-normal text-muted-foreground">
                            {formatDate(new Date(brief.generatedAt), locale)}
                          </span>
                        ) : null}
                      </summary>
                      <div className="mt-4 space-y-3">
                        {output ? (
                          <CatchUpPreview
                            output={output}
                            cardTitle={() => null}
                            cardHref={(id) => drill(`/work/card?id=${id}`)}
                          />
                        ) : (
                          <p className="text-small text-muted-foreground">
                            {t(
                              briefingPending
                                ? 'home.head.catchUp.pendingHint'
                                : brief?.status === 'failed'
                                  ? 'home.head.catchUp.failed'
                                  : 'home.head.catchUp.empty',
                            )}
                          </p>
                        )}
                        {briefingQuery.data?.canRefresh ? (
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={refresh.isPending || briefingPending || !online}
                            onClick={() => refresh.mutate(locale)}
                          >
                            <RefreshCw
                              className={cn(
                                'mr-2 size-4',
                                briefingPending && 'motion-safe:animate-spin',
                              )}
                              aria-hidden="true"
                            />
                            {t('home.head.catchUp.refresh')}
                          </Button>
                        ) : null}
                      </div>
                    </details>
                  ) : null}
                </div>
              )}
              {busy ? (
                <div
                  role="status"
                  className="flex items-center gap-2 text-small text-muted-foreground"
                >
                  <LoaderCircle className="size-4 motion-safe:animate-spin" aria-hidden="true" />
                  {t(audience === 'member' ? 'homeMember.thinking' : 'overviewChat.thinking')}
                </div>
              ) : null}
            </div>
          </div>
          {/* eslint-enable jsx-a11y/no-noninteractive-tabindex, jsx-a11y/no-noninteractive-element-interactions */}
          {unread ? (
            <Button
              size="sm"
              variant="secondary"
              className="absolute bottom-2 left-1/2 -translate-x-1/2 shadow-2"
              onClick={scrollToLatest}
            >
              <ArrowDown className="mr-1 size-3.5" aria-hidden="true" />
              {t('overviewChat.latest')}
            </Button>
          ) : null}
        </div>
        <form
          onSubmit={(event) => {
            void submit(event)
          }}
          data-testid="ai-composer"
          className="relative mx-auto w-full max-w-204 shrink-0 px-3 pb-3 pt-2 sm:px-6 sm:pb-5"
        >
          <ChatFileQueue
            files={files.files}
            remove={files.remove}
            retry={files.retry}
            limitError={files.limitError}
          />
          {create.isError || retryAttempt || cancel.isError || briefingError ? (
            <div
              role="alert"
              className="mb-2 flex items-center gap-2 text-caption text-destructive"
            >
              <span>
                {t(
                  create.isError
                    ? 'overviewChat.createFailed'
                    : briefingError
                      ? 'home.head.catchUp.failed'
                      : 'overviewChat.requestFailed',
                )}
              </span>
              {retryAttempt && !busy ? (
                <Button size="sm" variant="ghost" onClick={() => void request(retryAttempt)}>
                  {t('overviewChat.retry')}
                </Button>
              ) : null}
            </div>
          ) : null}
          <div className="flex items-end gap-2 rounded-lg border border-primary/20 bg-background p-1.5 transition-colors focus-within:border-primary/60 focus-within:ring-2 focus-within:ring-primary/10">
            <input
              ref={fileInput}
              type="file"
              multiple
              className="hidden"
              aria-label={t('assistantActions.addFiles')}
              onChange={(event) => {
                const selected = Array.from(event.currentTarget.files ?? [])
                event.currentTarget.value = ''
                if (selected.length) {
                  void files.add(selected)
                }
              }}
            />
            <IconButton
              aria-label={t('assistantActions.addFiles')}
              tooltip={t('assistantActions.addFiles')}
              disabled={!online || create.isPending || files.uploading || files.files.length >= 10}
              onClick={() => fileInput.current?.click()}
            >
              <Paperclip className="size-4" />
            </IconButton>
            <Textarea
              ref={composer}
              aria-label={t(
                audience === 'member' ? 'homeMember.assistantInput' : 'overviewChat.input',
              )}
              placeholder={t(
                !desktop
                  ? 'overviewChat.placeholderShort'
                  : selectedId
                    ? 'overviewChat.followUp'
                    : audience === 'member'
                      ? 'homeMember.assistantPlaceholder'
                      : 'overviewChat.placeholder',
              )}
              value={draft}
              maxLength={AI_CHAT_MESSAGE_MAX}
              rows={1}
              wrap="soft"
              disabled={create.isPending}
              onChange={(event) => {
                setDraft(event.target.value)
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                  event.preventDefault()
                  event.currentTarget.form?.requestSubmit()
                }
              }}
              className={cn(
                'min-h-11 max-h-40 resize-none overflow-y-auto border-0 bg-transparent py-3 text-body shadow-none focus-visible:ring-0 focus-visible:ring-offset-0',
              )}
            />
            {pending && selectedId ? (
              <IconButton
                aria-label={t('overviewChat.stop')}
                tooltip={t('overviewChat.stop')}
                disabled={cancel.isPending}
                onClick={() => cancel.mutate({ conversationId: selectedId, messageId: pending.id })}
              >
                <Square className="size-3.5" />
              </IconButton>
            ) : (
              <IconButton
                className="bg-primary text-primary-foreground hover:bg-primary/90"
                type="submit"
                aria-label={t('overviewChat.send')}
                tooltip={t('overviewChat.send')}
                disabled={!draft.trim() || Boolean(busy) || !online || files.blocked}
              >
                <ArrowUp className="size-4" />
              </IconButton>
            )}
          </div>
          {!online || draft.length > AI_CHAT_MESSAGE_MAX * 0.9 ? (
            <div className="mt-1.5 flex items-center justify-between gap-2 text-caption text-muted-foreground">
              {!online ? <span className="truncate">{t('overviewChat.offline')}</span> : null}
              {draft.length > AI_CHAT_MESSAGE_MAX * 0.9 ? (
                <span className="shrink-0 tabular-nums">
                  {draft.length} / {AI_CHAT_MESSAGE_MAX}
                </span>
              ) : null}
            </div>
          ) : null}
        </form>
      </section>
    </div>
  )
}

export default function AssistantScreen() {
  const me = useMeQuery()
  const { departmentId } = useDepartment()
  const isHead = useIsHead()
  const scope =
    me.data && departmentId
      ? `${departmentId}:${me.data.user.id}:${me.data.actingForUserId ?? ''}`
      : null
  const previousScope = React.useRef<string | null>(null)
  const scopeChanged = Boolean(previousScope.current && scope && previousScope.current !== scope)
  React.useEffect(() => {
    if (!scope) return
    if (previousScope.current && previousScope.current !== scope)
      replaceSearchParam('conversation', null)
    previousScope.current = scope
  }, [scope])
  if (me.isPending) return <StateView kind="loading" titleKey="state.loading" />
  if (me.isError)
    return (
      <StateView
        kind="error"
        titleKey="state.error.title"
        action={{ labelKey: 'state.error.action', onAction: () => void me.refetch() }}
      />
    )
  if (!scope) return <StateView kind="empty" titleKey="homeMember.noUnit" />
  return (
    <AssistantWorkspace
      key={scope}
      audience={isHead ? 'head' : 'member'}
      allowConversationRoute={!scopeChanged}
    />
  )
}
