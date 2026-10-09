// Per-user secret ICS feeds (v1.1 SPEC §10, EPIC-019): create, copy, renew, delete.
//
// The one idea a person has to understand here is that the URL *is* the credential -- there is no
// second factor on a calendar subscription, and there cannot be, because a calendar app carries no
// cookie. So the warning is not tucked into a tooltip: it is a standing line above the list, in
// plain words, and "renew" is offered next to every feed as the thing you do when a link has been
// somewhere it should not have been.
import * as React from 'react'
import { useT, useLocale, formatDate } from '@devon/i18n'
import {
  Button,
  Dialog,
  DialogContent,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Field,
  IconButton,
  Input,
  RadioGroup,
  RadioOption,
  Reveal,
  SectionCard,
  Stagger,
  StaggerItem,
  StateView,
  toast,
} from '@devon/ui'
import { Check, Copy, MoreVertical, Plus, RefreshCw, ShieldAlert, Trash2 } from 'lucide-react'
import { ApiError } from '../../../lib/api-client.js'
import { useOnline } from '../../../lib/use-online.js'
import { useCreateFeed, useFeedsQuery, useRevokeFeed, useRotateFeed } from '../hooks.js'
import type { FeedDto, FeedKind } from '../schemas.js'

const KINDS: readonly FeedKind[] = ['all', 'events', 'tasks']

/** One copyable URL row. The copy state is local and short-lived: it is feedback on a press, not a
 * fact about the feed. */
function CopyRow({
  label,
  help,
  value,
}: {
  label: string
  help: string
  value: string
}): React.JSX.Element {
  const t = useT()
  const [copied, setCopied] = React.useState(false)
  const timer = React.useRef<number | null>(null)
  const inputRef = React.useRef<HTMLInputElement>(null)
  const mounted = React.useRef(true)
  const copySequence = React.useRef(0)

  React.useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      if (timer.current !== null) window.clearTimeout(timer.current)
    }
  }, [])

  async function copy(): Promise<void> {
    const sequence = ++copySequence.current
    try {
      await navigator.clipboard.writeText(value)
      if (!mounted.current || sequence !== copySequence.current) return
      setCopied(true)
      toast.success(t('calendar.feeds.copyToast'))
      if (timer.current !== null) window.clearTimeout(timer.current)
      timer.current = window.setTimeout(() => setCopied(false), 2000)
    } catch {
      if (!mounted.current || sequence !== copySequence.current) return
      setCopied(false)
      inputRef.current?.focus()
      inputRef.current?.select()
      toast.error(t('calendar.feeds.copyFailed'))
    }
  }

  const inputId = React.useId()
  const helpId = `${inputId}-help`

  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={inputId} className="text-caption font-medium text-foreground">
        {label}
      </label>
      <div className="flex items-center gap-2">
        <input
          ref={inputRef}
          id={inputId}
          readOnly
          value={value}
          aria-describedby={helpId}
          onFocus={(e) => e.currentTarget.select()}
          className="min-w-0 flex-1 truncate rounded-sm border border-border bg-surface-1 px-2 py-1.5 font-mono text-caption text-muted-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        />
        <IconButton
          aria-label={copied ? t('calendar.actions.copied') : t('calendar.actions.copy')}
          onClick={() => void copy()}
        >
          {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
        </IconButton>
      </div>
      <p id={helpId} className="text-caption text-muted-foreground">
        {help}
      </p>
    </div>
  )
}

function FeedCard({ feed }: { feed: FeedDto }): React.JSX.Element {
  const t = useT()
  const locale = useLocale()
  const rotate = useRotateFeed()
  const revoke = useRevokeFeed()
  const [confirmRotate, setConfirmRotate] = React.useState(false)

  const meta = [
    feed.rotatedAt
      ? t('calendar.feeds.meta.rotated', { date: formatDate(new Date(feed.rotatedAt), locale) })
      : t('calendar.feeds.meta.created', { date: formatDate(new Date(feed.createdAt), locale) }),
    feed.lastAccessedAt
      ? t('calendar.feeds.meta.lastAccessed', {
          date: formatDate(new Date(feed.lastAccessedAt), locale),
        })
      : t('calendar.feeds.meta.neverAccessed'),
    t('calendar.feeds.meta.accessCount', { count: feed.accessCount }),
  ]

  return (
    <SectionCard
      title={feed.label || t(`calendar.feeds.kind.${feed.kind}`)}
      description={t(`calendar.feeds.kind.${feed.kind}`)}
      headerAside={
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <IconButton aria-label={t('calendar.actions.open')}>
              <MoreVertical className="size-4" />
            </IconButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => setConfirmRotate(true)}>
              <RefreshCw className="size-4" aria-hidden="true" />
              {t('calendar.feeds.rotate.action')}
            </DropdownMenuItem>
            <DropdownMenuItem
              className="text-danger"
              disabled={revoke.isPending || rotate.isPending}
              onSelect={() =>
                revoke.mutate(feed.id, {
                  onSuccess: () => toast.success(t('calendar.feeds.revoke.toast')),
                  onError: () => toast.error(t('toast.saveError')),
                })
              }
            >
              <Trash2 className="size-4" aria-hidden="true" />
              {t('calendar.feeds.revoke.action')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      }
    >
      <div className="flex flex-col gap-3 pt-2">
        <CopyRow
          key={feed.url}
          label={t('calendar.feeds.url.https')}
          help={t('calendar.feeds.url.httpsHelp')}
          value={feed.url}
        />
        <CopyRow
          key={feed.webcalUrl}
          label={t('calendar.feeds.url.webcal')}
          help={t('calendar.feeds.url.webcalHelp')}
          value={feed.webcalUrl}
        />
        <CopyRow
          key={feed.caldavUrl}
          label={t('calendar.feeds.url.caldav')}
          help={t('calendar.feeds.url.caldavHelp')}
          value={feed.caldavUrl}
        />
      </div>

      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-caption text-muted-foreground">
        {meta.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>

      {/* Renewing revokes a credential. `undo` is impossible here by construction -- the old secret
          is gone the instant the new one exists -- so this is one of the few places in the product
          that asks before acting rather than offering an undo afterwards (DESIGN.md §6). */}
      <Dialog open={confirmRotate} onOpenChange={setConfirmRotate}>
        <DialogContent
          title={t('calendar.feeds.rotate.confirmTitle')}
          className="flex max-w-md flex-col gap-4"
        >
          <p className="text-body text-muted-foreground">
            {t('calendar.feeds.rotate.confirmBody')}
          </p>
          {rotate.isError ? (
            <p role="alert" className="text-small text-destructive">
              {t('toast.saveError')}
            </p>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setConfirmRotate(false)}>
              {t('calendar.feeds.rotate.cancel')}
            </Button>
            <Button
              variant="primary"
              loading={rotate.isPending}
              onClick={() =>
                rotate.mutate(feed.id, {
                  onSuccess: () => {
                    setConfirmRotate(false)
                    toast.success(t('calendar.feeds.rotate.toast'))
                  },
                })
              }
            >
              {t('calendar.feeds.rotate.confirm')}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </SectionCard>
  )
}

function CreateFeedDialog({
  open,
  onOpenChange,
  restoreFocus,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  restoreFocus: () => void
}): React.JSX.Element {
  const t = useT()
  const create = useCreateFeed()
  const [kind, setKind] = React.useState<FeedKind>('all')
  const [label, setLabel] = React.useState('')
  const labelInputId = React.useId()
  const kindGroupId = React.useId()
  const dialogSession = React.useRef(0)
  const resetCreate = create.reset
  React.useEffect(() => {
    dialogSession.current += 1
    resetCreate()
  }, [open, resetCreate])
  const capReached =
    create.error instanceof ApiError &&
    create.error.code === 'validation_failed' &&
    create.error.errors.some((error) => error.path === 'feeds' && error.code === 'too_many_feeds')

  function submit(e: React.FormEvent): void {
    e.preventDefault()
    if (create.isPending) return
    const submittedSession = dialogSession.current
    create.mutate(
      { kind, label: label.trim() },
      {
        onSuccess: () => {
          if (submittedSession !== dialogSession.current) return
          onOpenChange(false)
          setLabel('')
          setKind('all')
        },
      },
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={t('calendar.feeds.create.title')}
        className="max-w-md"
        onCloseAutoFocus={(event) => {
          event.preventDefault()
          if (!open) restoreFocus()
        }}
      >
        <form onSubmit={submit} className="flex flex-col gap-5">
          <Field label={t('calendar.feeds.create.label')} htmlFor={labelInputId}>
            <Input
              id={labelInputId}
              value={label}
              maxLength={60}
              placeholder={t('calendar.feeds.create.labelPlaceholder')}
              onChange={(e) => setLabel(e.currentTarget.value)}
            />
          </Field>

          <fieldset className="flex flex-col gap-2">
            <legend id={kindGroupId} className="pb-2 text-caption font-medium text-foreground">
              {t('calendar.feeds.create.kind')}
            </legend>
            <RadioGroup
              aria-labelledby={kindGroupId}
              value={kind}
              onValueChange={(next) => setKind(next as FeedKind)}
            >
              {KINDS.map((k) => (
                <RadioOption
                  key={k}
                  value={k}
                  label={t(`calendar.feeds.kind.${k}`)}
                  description={t(`calendar.feeds.kind.${k}Help`)}
                />
              ))}
            </RadioGroup>
          </fieldset>

          {create.isError ? (
            <p role="alert" className="text-small text-destructive">
              {t(capReached ? 'calendar.feeds.create.capReached' : 'toast.saveError')}
            </p>
          ) : null}

          <div className="flex justify-end">
            <Button type="submit" variant="primary" loading={create.isPending}>
              {create.isPending
                ? t('calendar.feeds.create.creating')
                : t('calendar.feeds.create.submit')}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export function FeedsPanel(): React.JSX.Element {
  const t = useT()
  const online = useOnline()
  const query = useFeedsQuery()
  const [creating, setCreating] = React.useState(false)
  const createTrigger = React.useRef<HTMLButtonElement | null>(null)
  const headerTrigger = React.useRef<HTMLButtonElement | null>(null)

  function rememberTrigger(event: React.MouseEvent<HTMLDivElement>): void {
    if (creating || !(event.target instanceof Element)) return
    const button = event.target.closest('button')
    // Dialog content uses a React portal: its clicks must not replace the invoking page action.
    if (button && event.currentTarget.contains(button)) createTrigger.current = button
  }

  function restoreCreateFocus(): void {
    const trigger = createTrigger.current
    if (trigger?.isConnected && !trigger.disabled) trigger.focus({ preventScroll: true })
    else headerTrigger.current?.focus({ preventScroll: true })
  }

  function body(): React.JSX.Element {
    if (!online && query.data === undefined) {
      return (
        <StateView
          kind="offline"
          titleKey="calendar.offline.title"
          bodyKey="calendar.offline.body"
          action={{ labelKey: 'calendar.actions.retry', onAction: () => void query.refetch() }}
        />
      )
    }
    if (query.isPending) return <StateView kind="loading" titleKey="calendar.feeds.loading.title" />
    if (query.isError) {
      const err = query.error
      const code = err instanceof ApiError ? err.code : null
      if (code === 'forbidden') {
        return (
          <StateView
            kind="forbidden"
            titleKey="calendar.forbidden.title"
            bodyKey="calendar.forbidden.body"
          />
        )
      }
      const requestId = err instanceof ApiError && err.requestId ? err.requestId : null
      return (
        <StateView
          kind="error"
          titleKey="calendar.feeds.error.title"
          bodyKey="calendar.feeds.error.body"
          action={{ labelKey: 'calendar.actions.retry', onAction: () => void query.refetch() }}
          {...(requestId ? { requestId } : {})}
        />
      )
    }

    const feeds = query.data.items
    if (feeds.length === 0) {
      return (
        <StateView
          kind="empty"
          titleKey="calendar.feeds.empty.title"
          bodyKey="calendar.feeds.empty.body"
          action={{ labelKey: 'calendar.feeds.empty.action', onAction: () => setCreating(true) }}
        />
      )
    }

    return (
      <Stagger as="div" animateKey={feeds.length} className="flex flex-col gap-4">
        {feeds.map((feed) => (
          <StaggerItem key={feed.id}>
            <FeedCard feed={feed} />
          </StaggerItem>
        ))}
      </Stagger>
    )
  }

  return (
    <div className="flex flex-col gap-5" onClickCapture={rememberTrigger}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex flex-col gap-1">
          <h2 className="text-h3 text-foreground">{t('calendar.feeds.title')}</h2>
          <p className="text-body text-muted-foreground">{t('calendar.feeds.description')}</p>
        </div>
        <Button ref={headerTrigger} variant="primary" onClick={() => setCreating(true)}>
          <Plus className="size-4" aria-hidden="true" />
          {t('calendar.feeds.create.submit')}
        </Button>
      </div>

      <Reveal onView>
        <p className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 p-3 text-caption text-foreground">
          <ShieldAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-warning" />
          {t('calendar.feeds.secretWarning')}
        </p>
      </Reveal>

      {body()}

      <CreateFeedDialog
        open={creating}
        onOpenChange={setCreating}
        restoreFocus={restoreCreateFocus}
      />
    </div>
  )
}

export default FeedsPanel
