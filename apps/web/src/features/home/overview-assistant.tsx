import * as React from 'react'
import { AnimatePresence, motion } from 'motion/react'
import {
  AI_CHAT_MESSAGE_MAX,
  type AiChatAttachment,
  type AiChatMessage,
  type AiChatProposal,
} from '@devon/contracts'
import { useT, useLocale, formatDate } from '@devon/i18n'
import {
  Button,
  Dialog,
  DialogContent,
  DialogTrigger,
  IconButton,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Textarea,
  cn,
  useReducedMotion,
  tweenPage,
  tweenMicro,
} from '@devon/ui'
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  CheckCheck,
  Clock3,
  History,
  Link2,
  LoaderCircle,
  MessageSquare,
  Plus,
  Paperclip,
  File,
  RefreshCw,
  Sparkles,
  Square,
  TriangleAlert,
} from 'lucide-react'
import { RouterLink, replaceSearchParam, useSearchParams } from '../../lib/router.js'
import { useOnline } from '../../lib/use-online.js'
import { useMediaQuery } from '../../lib/use-media-query.js'
import {
  useCancelConversationMessageMutation,
  useConversationQuery,
  useConversationsQuery,
  useCreateConversationMutation,
  useSendConversationMessageMutation,
} from '../ai/conversations.js'
import { AnswerMarkdown } from '../ai/components/answer-markdown.js'
import { chatSourceHref } from '../ai/chat-source-href.js'
import { chatFailure } from '../ai/chat-failure.js'
import { CatchUpPreview } from '../ai/components/previews.js'
import { parseFeatureOutput, type CatchUpOutput } from '../ai/outputs.js'
import { useBriefingQuery, useRefreshBriefingMutation } from '../ai/use-ai.js'
import { ChatProposal } from '../ai/components/chat-proposal.js'
import { ChatFileQueue, useChatFiles } from '../ai/components/chat-files.js'

const drill = (path: string) => `${path}${path.includes('?') ? '&' : '?'}from=overview`
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
      {message.proposals?.map((proposal) => (
        <ChatProposal
          key={proposal.id}
          proposal={proposal}
          conversationId={conversationId}
          sources={message.sources}
          attachments={attachments}
          onEdit={onEditProposal}
          disabled={busy}
        />
      ))}
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

export function OverviewAssistant({
  expanded,
  onExpandedChange,
  cardTitle,
  allowConversationRoute,
  audience = 'head',
}: {
  expanded: boolean
  onExpandedChange: (value: boolean) => void
  cardTitle: (id: string) => string | null
  allowConversationRoute: boolean
  audience?: 'head' | 'member'
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
  const previousRoute = React.useRef(routeId)
  const selectedRef = React.useRef(selectedId)
  selectedRef.current = selectedId
  const briefingQuery = useBriefingQuery(audience === 'head'),
    refresh = useRefreshBriefingMutation()
  const history = useConversationsQuery(historyOpen)
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
    if (routeId) {
      setSelectedId(routeId)
      onExpandedChange(true)
    } else if (previousRoute.current && selectedRef.current) {
      onExpandedChange(false)
    }
    previousRoute.current = routeId
  }, [routeId, onExpandedChange])

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
    node.style.height = `${Math.max(40, Math.min(node.scrollHeight, expanded || desktop ? 96 : 40))}px`
  }, [draft, expanded, desktop])

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
    if (!expanded) return
    if (nearBottom.current) scrollToLatest()
    else setUnread(true)
  }, [current?.id, current?.messages.length, current?.status, expanded, scrollToLatest])

  function choose(id: string) {
    selectionGeneration.current++
    setSelectedId(id)
    setHistoryOpen(false)
    setRetryAttempt(null)
    nearBottom.current = true
    replaceSearchParam('conversation', id)
    onExpandedChange(true)
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
    onExpandedChange(true)
    composer.current?.focus({ preventScroll: true })
  }
  function back() {
    selectionGeneration.current++
    replaceSearchParam('conversation', null)
    onExpandedChange(false)
    requestAnimationFrame(() =>
      document
        .querySelector<HTMLElement>('[data-testid="overview-dashboard"] h1')
        ?.focus({ preventScroll: true }),
    )
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
    onExpandedChange(true)
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
  return (
    <section
      data-testid="overview-briefing"
      aria-label={t(audience === 'member' ? 'homeMember.assistant' : 'home.head.catchUp.title')}
      className="relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-primary/20 bg-card shadow-1"
    >
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-24 bg-linear-to-b from-primary/5 to-transparent"
        aria-hidden="true"
      />
      <header className="relative flex shrink-0 items-center justify-between gap-2 px-3 py-1 lg:px-5 lg:py-3">
        <div className="flex min-w-0 items-center gap-2">
          {expanded ? (
            <IconButton
              aria-label={t('overviewChat.back')}
              tooltip={t('overviewChat.back')}
              onClick={back}
            >
              <ArrowLeft className="size-4" />
            </IconButton>
          ) : null}
          <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Sparkles className="size-4" aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <h2
              role={expanded ? 'heading' : undefined}
              aria-level={expanded ? 1 : 2}
              className="truncate font-display text-base lg:text-h3"
            >
              {expanded
                ? current?.title ||
                  t(audience === 'member' ? 'homeMember.assistant' : 'overviewChat.title')
                : t(audience === 'member' ? 'homeMember.assistant' : 'home.head.catchUp.title')}
            </h2>
            {!expanded && brief?.generatedAt ? (
              <p className="hidden text-caption text-muted-foreground sm:block">
                {t('overviewChat.updated', {
                  date: formatDate(new Date(brief.generatedAt), locale),
                })}
              </p>
            ) : null}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          {!expanded && selectedId ? (
            <IconButton
              aria-label={t('overviewChat.continue')}
              tooltip={t('overviewChat.continue')}
              onClick={() => choose(selectedId)}
            >
              <MessageSquare className="size-4" />
            </IconButton>
          ) : null}
          <Popover open={historyOpen} onOpenChange={setHistoryOpen}>
            <PopoverTrigger asChild>
              <IconButton
                aria-label={t('overviewChat.history')}
                tooltip={t('overviewChat.history')}
              >
                <History className="size-4" />
              </IconButton>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-80 max-w-[calc(100vw-2rem)] p-2">
              <div className="flex items-center justify-between gap-2 p-2">
                <h3 className="text-small font-semibold">{t('overviewChat.history')}</h3>
                <IconButton
                  aria-label={t('overviewChat.new')}
                  tooltip={t('overviewChat.new')}
                  onClick={startNew}
                >
                  <Plus className="size-4" />
                </IconButton>
              </div>
              <div className="max-h-80 overflow-y-auto overscroll-contain">
                {history.isPending ? (
                  <p role="status" className="p-3 text-small text-muted-foreground">
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
                      className={cn(
                        'flex min-h-11 w-full items-start gap-2 rounded-md p-2 text-left hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                        item.id === selectedId && 'bg-accent',
                      )}
                    >
                      <MessageSquare
                        className="mt-0.5 size-4 shrink-0 text-primary"
                        aria-hidden="true"
                      />
                      <span className="min-w-0">
                        <span className="line-clamp-2 text-small font-medium">{item.title}</span>
                        <span className="mt-0.5 block text-caption text-muted-foreground">
                          {formatDate(new Date(item.updatedAt), locale)}
                        </span>
                      </span>
                    </button>
                  ))
                ) : (
                  <p className="p-3 text-small text-muted-foreground">
                    {t('overviewChat.noHistory')}
                  </p>
                )}
                {history.hasNextPage ? (
                  <Button
                    variant="ghost"
                    className="w-full"
                    disabled={history.isFetchingNextPage}
                    onClick={() => void history.fetchNextPage()}
                  >
                    {t('overviewChat.loadMore')}
                  </Button>
                ) : null}
              </div>
            </PopoverContent>
          </Popover>
          {expanded ? (
            <IconButton
              aria-label={t('overviewChat.new')}
              tooltip={t('overviewChat.new')}
              onClick={startNew}
              disabled={create.isPending}
            >
              <Plus className="size-4" />
            </IconButton>
          ) : (
            <>
              {output ? (
                <Dialog>
                  <DialogTrigger asChild>
                    <IconButton
                      aria-label={t('portal.overview.readBriefing')}
                      tooltip={t('portal.overview.readBriefing')}
                    >
                      <ArrowRight className="size-4" />
                    </IconButton>
                  </DialogTrigger>
                  <DialogContent title={t('home.head.catchUp.title')} className="max-w-180">
                    <CatchUpPreview
                      output={output}
                      cardTitle={cardTitle}
                      cardHref={(id) => drill(`/work/card?id=${id}`)}
                    />
                  </DialogContent>
                </Dialog>
              ) : null}
              {audience === 'head' && briefingQuery.data?.canRefresh ? (
                <IconButton
                  aria-label={t('home.head.catchUp.refresh')}
                  tooltip={t('home.head.catchUp.refresh')}
                  disabled={refresh.isPending || briefingPending || !online}
                  onClick={() => refresh.mutate(locale)}
                >
                  <RefreshCw
                    className={cn('size-4', briefingPending && 'motion-safe:animate-spin')}
                  />
                </IconButton>
              ) : null}
            </>
          )}
        </div>
      </header>
      <div className="relative min-h-0 flex-1">
        <AnimatePresence initial={false} mode="wait">
          {expanded ? (
            <motion.div
              key="conversation"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={reduced ? { duration: 0 } : tweenMicro}
              className="absolute inset-0 flex min-h-0 flex-col"
            >
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
                <div className="mx-auto flex max-w-180 flex-col gap-5 pb-3">
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
                    <div className="flex flex-col gap-3 py-5">
                      <h3 className="font-display text-h2">{t('overviewChat.welcome')}</h3>
                      <p className="max-w-120 text-small text-muted-foreground">
                        {t(
                          audience === 'member'
                            ? 'homeMember.assistantHint'
                            : 'overviewChat.welcomeHint',
                        )}
                      </p>
                      {output ? <p className="text-small">{output.headline}</p> : null}
                    </div>
                  )}
                  {busy ? (
                    <div
                      role="status"
                      className="flex items-center gap-2 text-small text-muted-foreground"
                    >
                      <LoaderCircle
                        className="size-4 motion-safe:animate-spin"
                        aria-hidden="true"
                      />
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
            </motion.div>
          ) : (
            <motion.div
              key={`briefing-${brief?.generatedAt ?? 'empty'}`}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={reduced ? { duration: 0 } : tweenMicro}
              className="absolute inset-0 overflow-hidden px-3 lg:px-5"
            >
              {audience === 'member' ? (
                <div className="flex h-full min-h-0 flex-col justify-center gap-2">
                  <p className="hidden text-small text-muted-foreground lg:block">
                    {t('homeMember.assistantHint')}
                  </p>
                  <div className="flex gap-1.5 overflow-x-auto py-0.5 lg:flex-wrap lg:overflow-visible">
                    {['priorities', 'projectUpdate', 'draftPage'].map((key) => (
                      <button
                        type="button"
                        key={key}
                        onClick={() => {
                          setDraft(t(`homeMember.prompts.${key}`))
                          onExpandedChange(true)
                          composer.current?.focus({ preventScroll: true })
                        }}
                        className="min-h-8 shrink-0 rounded-full border border-primary/15 bg-primary/5 px-3 text-caption text-primary hover:bg-accent"
                      >
                        {t(`homeMember.starters.${key}`)}
                      </button>
                    ))}
                  </div>
                </div>
              ) : output ? (
                <div className="grid h-full min-h-0 content-start gap-1 lg:grid-cols-[1.1fr_1fr_1fr] lg:gap-5">
                  <div className="min-h-0 overflow-hidden">
                    <p className="line-clamp-2 text-small font-medium leading-snug lg:line-clamp-4 lg:leading-relaxed">
                      {output.headline}
                    </p>
                  </div>
                  <div className="flex min-w-0 items-baseline gap-2 text-caption lg:hidden">
                    <span className="flex shrink-0 items-center gap-1 font-medium text-muted-foreground">
                      <CheckCheck className="size-3" aria-hidden="true" />
                      {t('ai.preview.catchUp.wins')}
                    </span>
                    <span className="truncate" title={output.wins.text}>
                      {output.wins.text || t('overviewChat.noUpdates')}
                    </span>
                  </div>
                  <div className="flex min-w-0 items-baseline gap-2 text-caption lg:hidden">
                    <span className="flex shrink-0 items-center gap-1 font-medium text-muted-foreground">
                      <TriangleAlert className="size-3" aria-hidden="true" />
                      {t('ai.preview.catchUp.risks')}
                    </span>
                    {output.risks[0] ? (
                      <RouterLink
                        href={drill(`/work/card?id=${output.risks[0].cardId}`)}
                        className="truncate text-primary"
                        title={output.risks[0].text}
                      >
                        {output.risks[0].text}
                      </RouterLink>
                    ) : (
                      <span className="truncate text-muted-foreground">
                        {t('overviewChat.noRisks')}
                      </span>
                    )}
                  </div>
                  <div className="hidden min-w-0 border-l border-border pl-4 lg:block">
                    <h3 className="mb-1 flex items-center gap-1.5 text-caption font-medium text-muted-foreground">
                      <CheckCheck className="size-3.5" aria-hidden="true" />
                      {t('ai.preview.catchUp.wins')}
                    </h3>
                    <p className="line-clamp-4 text-small leading-relaxed">
                      {output.wins.text || t('overviewChat.noUpdates')}
                    </p>
                  </div>
                  <div className="hidden min-w-0 border-l border-border pl-4 lg:block">
                    <h3 className="mb-1 flex items-center gap-1.5 text-caption font-medium text-muted-foreground">
                      <TriangleAlert className="size-3.5" aria-hidden="true" />
                      {t('ai.preview.catchUp.risks')}
                      {output.risks.length ? (
                        <span className="tabular-nums">· {output.risks.length}</span>
                      ) : null}
                    </h3>
                    {output.risks[0] ? (
                      <RouterLink
                        href={drill(`/work/card?id=${output.risks[0].cardId}`)}
                        className="line-clamp-4 text-small leading-relaxed text-primary hover:underline"
                      >
                        {output.risks[0].text}
                      </RouterLink>
                    ) : (
                      <p className="text-small text-muted-foreground">
                        {t('overviewChat.noRisks')}
                      </p>
                    )}
                  </div>
                </div>
              ) : (
                <div className="flex items-start gap-2 text-small text-muted-foreground">
                  {briefingPending ? (
                    <Clock3 className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                  ) : null}
                  <p>
                    {t(
                      briefingPending
                        ? 'home.head.catchUp.pendingHint'
                        : brief?.status === 'failed'
                          ? 'home.head.catchUp.failed'
                          : 'home.head.catchUp.empty',
                    )}
                  </p>
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
      <form
        onSubmit={(event) => {
          void submit(event)
        }}
        data-testid="ai-composer"
        className="relative shrink-0 px-3 pb-3 pt-2 lg:px-5 lg:pb-4"
      >
        <ChatFileQueue
          files={files.files}
          remove={files.remove}
          retry={files.retry}
          limitError={files.limitError}
        />
        {create.isError || retryAttempt || cancel.isError || briefingError ? (
          <div role="alert" className="mb-2 flex items-center gap-2 text-caption text-destructive">
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
                onExpandedChange(true)
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
            onFocus={() => {
              if (!desktop) onExpandedChange(true)
            }}
            maxLength={AI_CHAT_MESSAGE_MAX}
            rows={1}
            wrap={!expanded && !desktop ? 'off' : 'soft'}
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
              'min-h-10 max-h-24 resize-none border-0 bg-transparent py-2.5 text-small shadow-none focus-visible:ring-0 focus-visible:ring-offset-0',
              !expanded && !desktop ? 'overflow-hidden whitespace-nowrap' : 'overflow-y-auto',
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
  )
}
