import * as React from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { z } from 'zod'
import { can } from '@devon/contracts'
import { useLocale, useT } from '@devon/i18n'
import { Avatar, Button, IconButton, initialsFromName, StateView, Textarea, toast } from '@devon/ui'
import { ArrowUp, MessageSquare, Pencil, Trash2 } from 'lucide-react'
import { apiClient } from '../../../lib/api-client.js'
import { avatarUrl } from '../../../lib/avatar.js'
import { useActor } from '../../../lib/can.js'
import { useViewportBoundedHeight } from '../../../lib/use-viewport-bounded-height.js'
import { useDepartment, useMeQuery, useSession } from '../../../lib/session.js'
import { useMembers } from '../../work/hooks.js'
import { fullName } from '../../work/lib/format.js'

const commentSchema = z.object({
  id: z.string().uuid(),
  authorUserId: z.string().uuid(),
  body: z.object({ text: z.string() }),
  mentions: z.array(z.string()),
  createdAt: z.string(),
  editedAt: z.string().nullable(),
})
type Comment = z.infer<typeof commentSchema>

function Composer({
  initial = '',
  initialMentions = [],
  label,
  busy,
  onSend,
  onCancel,
}: {
  initial?: string
  initialMentions?: string[]
  label: string
  busy: boolean
  onSend: (text: string, mentions: string[]) => Promise<void>
  onCancel?: () => void
}) {
  const t = useT(),
    members = useMembers()
  const [text, setText] = React.useState(initial)
  const [selectedMentions, setSelectedMentions] = React.useState(initialMentions)
  const [suggest, setSuggest] = React.useState(false)
  const ref = React.useRef<HTMLTextAreaElement>(null)
  const fragment = text.match(/@([^@\n]*)$/)?.[1] ?? ''
  const options = suggest
    ? members
        .filter((m) => fullName(m).toLocaleLowerCase().includes(fragment.toLocaleLowerCase()))
        .slice(0, 6)
    : []
  async function submit() {
    if (busy || !text.trim()) return
    const mentions = members
      .filter((m) => selectedMentions.includes(m.userId) && text.includes(`@${fullName(m)}`))
      .map((m) => m.userId)
    try {
      await onSend(text.trim(), mentions)
      setText('')
      setSelectedMentions([])
      setSuggest(false)
    } catch {
      toast.error(t('work.comments.saveError'))
    }
  }
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        void submit()
      }}
      className="relative flex flex-col gap-2"
    >
      <Textarea
        ref={ref}
        aria-label={label}
        placeholder={t('projectCollaboration.placeholder')}
        rows={2}
        className="min-h-16 resize-none"
        maxLength={10000}
        value={text}
        disabled={busy}
        onChange={(e) => {
          setText(e.target.value)
          setSuggest(/@[^@\n]*$/.test(e.target.value))
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') setSuggest(false)
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault()
            void submit()
          }
        }}
      />
      {options.length ? (
        <div
          className="absolute bottom-full z-20 mb-2 max-h-60 w-full overflow-y-auto rounded-md border border-border bg-card p-1 shadow-lg"
          role="group"
          aria-label={t('projectCollaboration.mention')}
        >
          {options.map((m) => (
            <button
              key={m.userId}
              type="button"
              className="flex min-h-10 w-full items-center gap-2 rounded-sm px-2 text-left text-small hover:bg-accent"
              onClick={() => {
                setText(text.replace(/@[^@\n]*$/, `@${fullName(m)} `))
                setSelectedMentions((ids) => [...new Set([...ids, m.userId])])
                setSuggest(false)
                ref.current?.focus()
              }}
            >
              <Avatar
                size="sm"
                decorative
                alt={fullName(m)}
                src={avatarUrl(m.avatarKey)}
                initials={initialsFromName(m.givenName, m.familyName)}
              />
              {fullName(m)}
            </button>
          ))}
        </div>
      ) : null}
      <div className="flex items-center justify-between gap-2">
        <span className="text-caption text-muted-foreground">
          {t('projectCollaboration.composeHint')}
        </span>
        <div className="flex gap-2">
          {onCancel ? (
            <Button size="sm" variant="ghost" disabled={busy} onClick={onCancel}>
              {t('common.cancel')}
            </Button>
          ) : null}
          <IconButton
            type="submit"
            className="bg-primary text-primary-foreground hover:bg-primary/90"
            aria-label={label}
            tooltip={label}
            disabled={busy || !text.trim()}
          >
            <ArrowUp className="size-4" />
          </IconButton>
        </div>
      </div>
    </form>
  )
}

export function ProjectDiscussion({ projectId }: { projectId: string }) {
  const actor = useActor()
  const [panelRef, panelHeight] = useViewportBoundedHeight<HTMLElement>(320)
  const t = useT(),
    locale = useLocale(),
    members = useMembers(),
    { user } = useSession(),
    { department } = useDepartment()
  const csrf = useMeQuery().data?.csrfToken ?? '',
    qc = useQueryClient()
  const canPost = can(actor, 'create', {
    kind: 'department_child',
    departmentId: actor?.departmentId ?? '',
  }).allowed
  const key = ['projects', 'comments', projectId],
    base = `/api/v1/projects/${projectId}/comments`
  const query = useQuery({
    queryKey: key,
    queryFn: () => apiClient.get(base, z.array(commentSchema)),
  })
  const [editing, setEditing] = React.useState<Comment | null>(null),
    [deleting, setDeleting] = React.useState<string | null>(null)
  const scroll = React.useRef<HTMLDivElement>(null),
    follow = React.useRef(true)
  const refresh = () => qc.invalidateQueries({ queryKey: key })
  const add = useMutation({
    mutationFn: (input: { text: string; mentions: string[] }) =>
      apiClient.post(base, input, z.object({ id: z.string() }), csrf),
    onSuccess: () => {
      follow.current = true
      return refresh()
    },
  })
  const edit = useMutation({
    mutationFn: (input: {
      id: string
      text: string
      mentions: string[]
      editedAt: string | null
    }) =>
      apiClient.patch(
        `${base}/${input.id}`,
        { text: input.text, mentions: input.mentions, editedAt: input.editedAt },
        z.unknown(),
        csrf,
      ),
    onSuccess: () => {
      setEditing(null)
      return refresh()
    },
  })
  const remove = useMutation({
    mutationFn: (id: string) => apiClient.delete(`${base}/${id}`, csrf),
    onSuccess: () => {
      setDeleting(null)
      return refresh()
    },
    onError: () => toast.error(t('work.comments.saveError')),
  })
  React.useEffect(() => {
    if (!query.data || !scroll.current) return
    const hash = window.location.hash.slice(1)
    const target = hash.startsWith('comment-') ? document.getElementById(hash) : null
    if (target) {
      target.scrollIntoView({ block: 'nearest' })
      follow.current = false
    } else if (follow.current) scroll.current.scrollTop = scroll.current.scrollHeight
  }, [query.data])
  return (
    <section
      ref={panelRef}
      style={{ height: panelHeight }}
      className="flex min-h-80 flex-col overflow-hidden rounded-lg border border-border bg-card"
      aria-label={t('projectCollaboration.discussion')}
    >
      <div
        ref={scroll}
        onScroll={(e) => {
          const el = e.currentTarget
          follow.current = el.scrollHeight - el.scrollTop - el.clientHeight < 72
        }}
        className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4 sm:p-5"
        role="log"
        aria-live="polite"
        aria-relevant="additions"
        aria-label={t('projectCollaboration.messages')}
      >
        {query.isError ? (
          <StateView
            kind="error"
            titleKey="state.error.title"
            action={{ labelKey: 'state.error.action', onAction: () => void query.refetch() }}
          />
        ) : query.isPending ? (
          <StateView kind="loading" titleKey="state.loading" />
        ) : !query.data.length ? (
          <div className="m-auto flex max-w-80 flex-col items-center gap-3 text-center">
            <MessageSquare className="size-7 text-primary" />
            <p className="font-medium">{t('projectCollaboration.empty')}</p>
            <p className="text-small text-muted-foreground">
              {t('projectCollaboration.emptyHint')}
            </p>
          </div>
        ) : (
          query.data.map((c) => {
            const author = members.find((m) => m.userId === c.authorUserId),
              name = author ? fullName(author) : t('projectCollaboration.formerMember')
            const own = canPost && (c.authorUserId === user?.id || department?.role === 'head')
            return (
              <article key={c.id} id={`comment-${c.id}`} className="flex gap-3">
                <Avatar
                  decorative
                  size="sm"
                  alt={name}
                  src={avatarUrl(author?.avatarKey)}
                  initials={author ? initialsFromName(author.givenName, author.familyName) : '?'}
                />
                <div className="min-w-0 flex-1">
                  <div className="mb-1 flex flex-wrap items-center gap-x-2">
                    <span className="text-small font-semibold">{name}</span>
                    <time dateTime={c.createdAt} className="text-caption text-muted-foreground">
                      {new Intl.DateTimeFormat(locale, {
                        dateStyle: 'medium',
                        timeStyle: 'short',
                      }).format(new Date(c.createdAt))}
                    </time>
                    {c.editedAt ? (
                      <span className="text-caption text-muted-foreground">
                        {t('work.comments.edited')}
                      </span>
                    ) : null}
                    {own && !editing ? (
                      <div className="ml-auto flex gap-1">
                        <IconButton
                          className="size-8"
                          tooltip={t('work.comments.edit')}
                          aria-label={t('work.comments.edit')}
                          onClick={() => setEditing(c)}
                        >
                          <Pencil className="size-3.5" />
                        </IconButton>
                        <IconButton
                          className="size-8 text-muted-foreground hover:text-destructive"
                          tooltip={t('work.action.delete')}
                          aria-label={t('work.action.delete')}
                          onClick={() => setDeleting(c.id)}
                        >
                          <Trash2 className="size-3.5" />
                        </IconButton>
                      </div>
                    ) : null}
                  </div>
                  {editing?.id === c.id ? (
                    <Composer
                      initial={editing.body.text}
                      initialMentions={editing.mentions}
                      label={t('common.save')}
                      busy={edit.isPending}
                      onCancel={() => setEditing(null)}
                      onSend={async (text, mentions) => {
                        await edit.mutateAsync({
                          id: c.id,
                          text,
                          mentions,
                          editedAt: editing.editedAt,
                        })
                      }}
                    />
                  ) : (
                    <p className="whitespace-pre-wrap wrap-anywhere text-small leading-relaxed">
                      {c.body.text}
                    </p>
                  )}
                  {deleting === c.id ? (
                    <div className="mt-3 flex flex-wrap items-center gap-2 rounded-md bg-destructive/5 p-2 text-small">
                      <span>{t('work.comments.deleteConfirm')}</span>
                      <Button
                        size="sm"
                        variant="destructive"
                        disabled={remove.isPending}
                        onClick={() => remove.mutate(c.id)}
                      >
                        {t('work.action.delete')}
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setDeleting(null)}>
                        {t('common.cancel')}
                      </Button>
                    </div>
                  ) : null}
                </div>
              </article>
            )
          })
        )}
      </div>
      {canPost ? (
        <div className="shrink-0 border-t border-border bg-muted/20 p-3 sm:p-4">
          <Composer
            label={t('projectCollaboration.send')}
            busy={add.isPending}
            onSend={async (text, mentions) => {
              await add.mutateAsync({ text, mentions })
            }}
          />
        </div>
      ) : null}
    </section>
  )
}
