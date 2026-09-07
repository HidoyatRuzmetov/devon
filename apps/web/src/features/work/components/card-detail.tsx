// The card detail content (TECH-SPEC §5, DESIGN.md §9.4 "two columns: left title/description/
// checklist/comments, right properties, each inline-editable; activity a collapsible timeline at the
// bottom"). Shared, unstyled-of-container content component -- `card-peek-dialog.tsx` wraps it in a
// `Dialog` for the side-peek, `card-page-screen.tsx` renders it directly as the full page (TECH-SPEC
// "card peek panel and full card page"). AI actions (subtasks, summarise thread, translate the
// description) are the preview-then-accept pattern UI-OVERHAUL.md's AI helpers row requires: a
// `SparkleButton` next to the field it enhances, an `AiPreviewPanel` with Accept/Edit/Discard, and no
// path that writes a generated result into the card without that Accept.
import * as React from 'react'
import { ChevronDown, Link2, Plus, Trash2, X } from 'lucide-react'
import { useT, useLocale, formatDate, type Locale } from '@devon/i18n'
import {
  AiPreviewPanel,
  Avatar,
  AvatarStack,
  Badge,
  Button,
  Checkbox,
  Chip,
  Collapsible,
  DatePicker,
  IconButton,
  Input,
  SparkleButton,
  Skeleton,
  StateView,
  initialsFromName,
  labelChipColors,
  toast,
  toastWithUndo,
} from '@devon/ui'
import { useSession } from '../../../lib/session.js'
import { useIsDarkTheme } from '../../../lib/theme.js'
import { useRunAiFeatureMutation, useAiSettingsQuery } from '../../ai/use-ai.js'
import type { AiFeatureId } from '../../ai/types.js'
import { useProjectsQuery } from '../../projects/hooks.js'
import {
  nextDoneStatus,
  useAddChecklistItemMutation,
  useAddCommentMutation,
  useCardQuery,
  useCreateLabelMutation,
  useDeleteChecklistItemMutation,
  useLabelsQuery,
  useMembers,
  usePatchCardMutation,
  usePatchChecklistItemMutation,
  useRestoreCardMutation,
  useToggleWatcherMutation,
  useUnfurlMutation,
} from '../hooks.js'
import { resolveQuickAddAssignee } from '../lib/quick-add.js'
import {
  PRIORITY_BADGE_TONE,
  PRIORITY_LABEL_KEY,
  RISK_BADGE_TONE,
  RISK_LABEL_KEY,
  fullName,
} from '../lib/format.js'
import { MemberPicker } from './member-picker.js'
import type { CardPriority, MemberSummary } from '../api.js'

const PRIORITIES: readonly CardPriority[] = ['none', 'low', 'medium', 'high', 'urgent']

/** Whether an AI affordance should even render: the department must have the feature's flag on and
 * not be past its hard budget stop (TECH-SPEC §8) -- checked once per feature, shared by every
 * `SparkleButton` in this file rather than re-reading `useAiSettingsQuery()` per call site. */
function useAiFeatureEnabled(feature: AiFeatureId): boolean {
  const settings = useAiSettingsQuery().data
  return (
    settings !== undefined &&
    settings.flags[feature] === true &&
    settings.budgetStatus !== 'hard_stop'
  )
}

function toDateInputValue(iso: string | null): Date | undefined {
  return iso ? new Date(iso) : undefined
}

function dateToIso(date: Date | undefined): string | null {
  if (!date) return null
  return new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate())).toISOString()
}

export function CardDetailContent({ cardId, onClose }: { cardId: string; onClose?: () => void }) {
  const t = useT()
  const locale = useLocale()
  const query = useCardQuery(cardId)
  const members = useMembers()
  const labels = useLabelsQuery().data ?? []
  const projects = useProjectsQuery().data ?? []
  const { user } = useSession()
  const isDark = useIsDarkTheme()
  const patchCard = usePatchCardMutation()
  const restoreCard = useRestoreCardMutation()
  const toggleWatcher = useToggleWatcherMutation()
  const createLabel = useCreateLabelMutation()
  const unfurl = useUnfurlMutation()

  const [titleDraft, setTitleDraft] = React.useState('')
  const [descDraft, setDescDraft] = React.useState('')
  const [linkInput, setLinkInput] = React.useState('')
  const [newLabelName, setNewLabelName] = React.useState('')
  const [activityOpen, setActivityOpen] = React.useState(false)

  const card = query.data
  React.useEffect(() => {
    if (card) {
      setTitleDraft(card.title)
      setDescDraft(card.description?.text ?? '')
    }
  }, [card?.id, card?.title, card?.description?.text]) // eslint-disable-line react-hooks/exhaustive-deps

  const translateEnabled = useAiFeatureEnabled('translate')
  const translateAi = useRunAiFeatureMutation('translate')
  const [translatePreview, setTranslatePreview] = React.useState<{
    text: string
    tokens: number
    ms: number
  } | null>(null)

  if (query.isPending) {
    return (
      <div className="flex flex-col gap-4 p-2">
        <Skeleton className="h-8 w-3/4" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    )
  }
  if (query.isError || !card) {
    return (
      <StateView
        kind="error"
        titleKey="state.error.title"
        bodyKey="state.error.body"
        action={{ labelKey: 'state.error.action', onAction: () => void query.refetch() }}
      />
    )
  }

  const isWatching = user ? card.watchers.includes(user.id) : false
  const watcherPeople = card.watchers
    .map((id) => members.find((m) => m.userId === id))
    .filter((m): m is MemberSummary => Boolean(m))
    .map((m) => ({
      id: m.userId,
      name: fullName(m),
      initials: initialsFromName(m.givenName, m.familyName),
    }))

  async function saveTitle() {
    if (titleDraft.trim().length === 0 || titleDraft === card!.title) return
    await patchCard.mutateAsync({ id: card!.id, patch: { title: titleDraft.trim() } })
  }
  async function saveDescription(nextText?: string) {
    const next = nextText ?? descDraft
    if (next === (card!.description?.text ?? '')) return
    await patchCard.mutateAsync({ id: card!.id, patch: { description: next || null } })
  }

  async function markDone() {
    const status = nextDoneStatus(card!)
    await patchCard.mutateAsync({ id: card!.id, patch: { status } })
    if (status === 'archived') {
      toastWithUndo({
        message: t('work.card.archived'),
        undoLabel: t('action.undo'),
        onUndo: () => void restoreCard.mutateAsync(card!.id),
      })
      onClose?.()
    }
  }

  async function archiveNow() {
    await patchCard.mutateAsync({ id: card!.id, patch: { status: 'archived' } })
    toastWithUndo({
      message: t('work.card.archived'),
      undoLabel: t('action.undo'),
      onUndo: () => void restoreCard.mutateAsync(card!.id),
    })
    onClose?.()
  }

  async function addLink() {
    const url = linkInput.trim()
    if (!url) return
    try {
      const result = await unfurl.mutateAsync(url)
      await patchCard.mutateAsync({
        id: card!.id,
        patch: {
          links: [
            ...card!.links,
            { url: result.url, title: result.title, favicon: result.favicon },
          ],
        },
      })
      setLinkInput('')
    } catch {
      toast(t('work.card.unfurlError'))
    }
  }

  async function removeLink(url: string) {
    await patchCard.mutateAsync({
      id: card!.id,
      patch: { links: card!.links.filter((l) => l.url !== url) },
    })
  }

  function toggleLabel(labelId: string) {
    const next = card!.labels.includes(labelId)
      ? card!.labels.filter((l) => l !== labelId)
      : [...card!.labels, labelId]
    void patchCard.mutateAsync({ id: card!.id, patch: { labels: next } })
  }

  function runTranslate() {
    const source = descDraft.trim()
    if (!source) return
    setTranslatePreview(null)
    translateAi.mutate(
      { text: source, locale },
      {
        onSuccess: (res) => {
          const data = res.data as { translatedText?: unknown }
          if (typeof data.translatedText === 'string') {
            setTranslatePreview({
              text: data.translatedText,
              tokens: res.meta.totalTokens,
              ms: res.meta.latencyMs,
            })
          }
        },
      },
    )
  }

  async function acceptTranslate() {
    if (!translatePreview) return
    setDescDraft(translatePreview.text)
    await saveDescription(translatePreview.text)
    setTranslatePreview(null)
    translateAi.reset()
  }

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <div className="flex items-start justify-between gap-2">
          <textarea
            value={titleDraft}
            onChange={(e) => setTitleDraft(e.target.value)}
            onBlur={() => void saveTitle()}
            rows={1}
            aria-label={t('work.field.title')}
            className="w-full resize-none rounded-sm border border-transparent bg-transparent p-1 font-display text-h3 text-foreground outline-none hover:border-border focus-visible:border-border focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="neutral">{t(`work.status.${card.status}`)}</Badge>
          {card.priority !== 'none' ? (
            <Badge tone={PRIORITY_BADGE_TONE[card.priority]}>
              {t(PRIORITY_LABEL_KEY[card.priority])}
            </Badge>
          ) : null}
          {card.risk !== 'none' ? (
            <Badge tone={RISK_BADGE_TONE[card.risk]}>{t(RISK_LABEL_KEY[card.risk])}</Badge>
          ) : null}
          <div className="ml-auto flex flex-wrap gap-2">
            {card.status === 'active' ? (
              <Button size="sm" onClick={() => void markDone()} loading={patchCard.isPending}>
                {t('work.card.markDone')}
              </Button>
            ) : null}
            {card.status !== 'archived' ? (
              <Button size="sm" variant="secondary" onClick={() => void archiveNow()}>
                {t('work.card.archive')}
              </Button>
            ) : (
              <Button
                size="sm"
                variant="secondary"
                onClick={() => void restoreCard.mutateAsync(card.id)}
              >
                {t('work.card.restore')}
              </Button>
            )}
          </div>
        </div>
      </header>

      <div className="grid grid-cols-1 gap-6 sm:grid-cols-[minmax(0,1fr)_240px]">
        {/* Left: description, links, checklist, comments (DESIGN.md §9.4). */}
        <div className="flex min-w-0 flex-col gap-6">
          <Field
            label={t('work.field.description')}
            action={
              translateEnabled && descDraft.trim() ? (
                <SparkleButton
                  aria-label={t('work.ai.translate')}
                  size="sm"
                  loading={translateAi.isPending}
                  onClick={runTranslate}
                />
              ) : undefined
            }
          >
            <textarea
              value={descDraft}
              onChange={(e) => setDescDraft(e.target.value)}
              onBlur={() => void saveDescription()}
              rows={5}
              placeholder={t('work.card.descriptionPlaceholder')}
              className="w-full resize-y rounded-sm border border-border bg-card p-3 text-body text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            {translateAi.isPending || translatePreview || translateAi.isError ? (
              <AiPreviewPanel
                className="mt-2"
                title={t('work.ai.translatePreviewTitle')}
                status={translateAi.isPending ? 'pending' : translateAi.isError ? 'error' : 'ready'}
                pendingLabel={t('work.ai.translate')}
                errorMessage={t('work.quickAdd.aiError')}
                acceptLabel={t('work.ai.accept')}
                editLabel={t('work.ai.edit')}
                discardLabel={t('work.ai.discard')}
                retryLabel={t('work.ai.retry')}
                onAccept={() => void acceptTranslate()}
                onEdit={() => setTranslatePreview(null)}
                onDiscard={() => {
                  setTranslatePreview(null)
                  translateAi.reset()
                }}
                onRetry={runTranslate}
                {...(translatePreview
                  ? {
                      costLine: t('work.quickAdd.aiMeta', {
                        tokens: translatePreview.tokens,
                        ms: translatePreview.ms,
                      }),
                    }
                  : {})}
              >
                {translatePreview ? (
                  <p className="whitespace-pre-wrap">{translatePreview.text}</p>
                ) : null}
              </AiPreviewPanel>
            ) : null}
          </Field>

          <Field label={t('work.field.links')}>
            <div className="flex flex-col gap-2">
              {card.links.map((link) => (
                <div
                  key={link.url}
                  className="flex items-center gap-2 rounded-sm border border-border p-2"
                >
                  <Link2 className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                  <a
                    href={link.url}
                    target="_blank"
                    rel="noreferrer"
                    className="flex-1 truncate text-small text-primary underline"
                  >
                    {link.title}
                  </a>
                  <IconButton
                    aria-label={t('work.action.delete')}
                    onClick={() => void removeLink(link.url)}
                  >
                    <X className="size-3.5" />
                  </IconButton>
                </div>
              ))}
              <div className="flex gap-2">
                <Input
                  value={linkInput}
                  onChange={(e) => setLinkInput(e.target.value)}
                  placeholder={t('work.card.addLinkPlaceholder')}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void addLink()
                  }}
                />
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => void addLink()}
                  loading={unfurl.isPending}
                >
                  <Plus className="size-4" />
                </Button>
              </div>
            </div>
          </Field>

          <Checklist card={card} />

          <Comments
            cardId={card.id}
            cardTitle={card.title}
            comments={card.comments}
            members={members}
          />
        </div>

        {/* Right: properties, each inline-editable (DESIGN.md §9.4). */}
        <div className="flex flex-col gap-4">
          {card.projectId ? (
            <Field label={t('work.field.project')}>
              {(() => {
                const project = projects.find((p) => p.id === card.projectId)
                return project ? (
                  <Chip tone="outline">
                    <span
                      className="size-2 shrink-0 rounded-full"
                      style={{ backgroundColor: project.colour }}
                      aria-hidden="true"
                    />
                    {project.title}
                  </Chip>
                ) : null
              })()}
            </Field>
          ) : null}
          <Field label={t('work.field.assignee')}>
            <MemberPicker
              members={members}
              value={card.assigneeUserId}
              onChange={(userId) =>
                void patchCard.mutateAsync({ id: card.id, patch: { assigneeUserId: userId } })
              }
              placeholderKey="work.field.unassigned"
            />
          </Field>
          <Field label={t('work.field.giver')}>
            <MemberPicker
              members={members}
              value={card.giverUserId}
              onChange={(userId) =>
                void patchCard.mutateAsync({ id: card.id, patch: { giverUserId: userId } })
              }
              placeholderKey="work.field.noGiver"
            />
          </Field>
          <Field label={t('work.field.priority')}>
            <select
              value={card.priority}
              onChange={(e) =>
                void patchCard.mutateAsync({
                  id: card.id,
                  patch: { priority: e.target.value as CardPriority },
                })
              }
              className="h-11 w-full rounded-sm border border-border bg-card px-3 text-body text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {t(PRIORITY_LABEL_KEY[p])}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t('work.field.due')}>
            <DatePicker
              locale={locale}
              label={t('work.field.due')}
              placeholder={t('work.field.due')}
              selected={toDateInputValue(card.dueAt)}
              onSelect={(date) =>
                void patchCard.mutateAsync({ id: card.id, patch: { dueAt: dateToIso(date) } })
              }
              triggerClassName="w-full justify-start"
            />
          </Field>
          <Field label={t('work.field.start')}>
            <DatePicker
              locale={locale}
              label={t('work.field.start')}
              placeholder={t('work.field.start')}
              selected={toDateInputValue(card.startAt)}
              onSelect={(date) =>
                void patchCard.mutateAsync({ id: card.id, patch: { startAt: dateToIso(date) } })
              }
              triggerClassName="w-full justify-start"
            />
          </Field>
          <Field label={t('work.field.watchers')}>
            <div className="flex flex-col gap-2">
              {watcherPeople.length > 0 ? (
                <AvatarStack people={watcherPeople} label={t('work.field.watchers')} max={6} />
              ) : null}
              <Button
                size="sm"
                variant={isWatching ? 'secondary' : 'ghost'}
                onClick={() => void toggleWatcher.mutateAsync(card.id)}
              >
                {isWatching ? t('work.card.watching') : t('work.card.watch')}
              </Button>
            </div>
          </Field>
          <Field label={t('work.field.labels')}>
            <div className="flex flex-wrap gap-1.5">
              {labels.map((label) => {
                const active = card.labels.includes(label.id)
                // A pastel label colour with hardcoded white text was illegible the moment someone
                // picked a light hue ("Hisobot"/"Tashqi" in the item handoff) -- labelChipColors
                // derives a background/foreground pair from that one colour, guaranteed >= 4.5:1
                // contrast, so any colour a member picks stays readable in both themes.
                const { background, foreground } = labelChipColors(label.colour, isDark)
                return (
                  <button
                    key={label.id}
                    type="button"
                    onClick={() => toggleLabel(label.id)}
                    className="rounded-sm px-2 py-0.5 text-caption font-medium transition-opacity"
                    style={{
                      backgroundColor: background,
                      color: foreground,
                      opacity: active ? 1 : 0.35,
                    }}
                    aria-pressed={active}
                  >
                    {label.name}
                  </button>
                )
              })}
              <Input
                value={newLabelName}
                onChange={(e) => setNewLabelName(e.target.value)}
                placeholder={t('work.card.newLabel')}
                className="h-7 w-full px-2 text-caption"
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && newLabelName.trim()) {
                    createLabel.mutate({ name: newLabelName.trim() })
                    setNewLabelName('')
                  }
                }}
              />
            </div>
          </Field>
        </div>
      </div>

      {card.activity.length > 0 ? (
        <div className="border-t border-border pt-3">
          <button
            type="button"
            onClick={() => setActivityOpen((v) => !v)}
            aria-expanded={activityOpen}
            aria-controls="card-activity-panel"
            className="flex items-center gap-1.5 text-caption font-medium uppercase tracking-(--text-eyebrow--letter-spacing) text-muted-foreground hover:text-foreground"
          >
            <ChevronDown
              className={
                activityOpen
                  ? 'size-3.5 rotate-180 transition-transform'
                  : 'size-3.5 transition-transform'
              }
              aria-hidden="true"
            />
            {t('work.field.activity')} ({card.activity.length})
          </button>
          <Collapsible open={activityOpen} id="card-activity-panel">
            <div className="pt-3">
              <ActivityTimeline activity={card.activity} members={members} locale={locale} />
            </div>
          </Collapsible>
        </div>
      ) : null}
    </div>
  )
}

function Field({
  label,
  action,
  children,
}: {
  label: string
  action?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <label className="flex flex-col gap-1.5 text-small">
      <span className="flex items-center gap-2">
        <span className="text-caption font-medium uppercase tracking-(--text-eyebrow--letter-spacing) text-muted-foreground">
          {label}
        </span>
        {action ? <span className="ml-auto">{action}</span> : null}
      </span>
      {children}
    </label>
  )
}

function Checklist({
  card,
}: {
  card: {
    id: string
    title: string
    description: { text: string } | null
    checklist: Array<{
      id: string
      parentItemId: string | null
      text: string
      doneAt: string | null
    }>
  }
}) {
  const t = useT()
  const locale = useLocale()
  const [text, setText] = React.useState('')
  const addItem = useAddChecklistItemMutation(card.id)
  const patchItem = usePatchChecklistItemMutation(card.id)
  const deleteItem = useDeleteChecklistItemMutation(card.id)
  const topLevel = card.checklist.filter((i) => i.parentItemId === null)
  const childrenOf = (id: string) => card.checklist.filter((i) => i.parentItemId === id)
  const done = card.checklist.filter((i) => i.doneAt !== null).length

  const subtasksEnabled = useAiFeatureEnabled('subtask_breakdown')
  const subtaskAi = useRunAiFeatureMutation('subtask_breakdown')
  const [suggested, setSuggested] = React.useState<{
    items: string[]
    tokens: number
    ms: number
  } | null>(null)

  function runSubtaskAi() {
    setSuggested(null)
    subtaskAi.mutate(
      {
        locale,
        cardTitle: card.title,
        cardDescription: card.description?.text ?? null,
        existingSubtasks: card.checklist.map((i) => i.text),
        targetCount: 6,
      },
      {
        onSuccess: (res) => {
          const data = res.data as { subtasks?: unknown }
          if (Array.isArray(data.subtasks)) {
            setSuggested({
              items: data.subtasks.filter((s): s is string => typeof s === 'string'),
              tokens: res.meta.totalTokens,
              ms: res.meta.latencyMs,
            })
          }
        },
      },
    )
  }

  async function acceptSubtasks() {
    if (!suggested) return
    const existing = new Set(card.checklist.map((i) => i.text.trim().toLowerCase()))
    const toAdd = suggested.items
      .map((line) => line.trim())
      .filter((clean) => clean && !existing.has(clean.toLowerCase()))
    // TECH-SPEC §16 "no query in a loop": every new item is independent (each omits `orderKey`, the
    // same as the plain "Add an item" input already does), so one `Promise.all` is both correct and
    // faster than awaiting each append in turn.
    await Promise.all(toAdd.map((clean) => addItem.mutateAsync({ text: clean })))
    setSuggested(null)
    subtaskAi.reset()
    toast(t('work.ai.subtasksAdded', { count: toAdd.length }))
  }

  return (
    <Field
      label={`${t('work.field.checklist')} (${done}/${card.checklist.length})`}
      action={
        subtasksEnabled ? (
          <SparkleButton
            aria-label={t('work.ai.subtasks')}
            size="sm"
            loading={subtaskAi.isPending}
            onClick={runSubtaskAi}
          />
        ) : undefined
      }
    >
      <div className="flex flex-col gap-1">
        {topLevel.map((item) => (
          <div key={item.id} className="flex flex-col gap-1">
            <ChecklistRow
              item={item}
              onToggle={(done_) => patchItem.mutate({ itemId: item.id, patch: { done: done_ } })}
              onDelete={() => deleteItem.mutate(item.id)}
            />
            {childrenOf(item.id).map((child) => (
              <div key={child.id} className="pl-6">
                <ChecklistRow
                  item={child}
                  onToggle={(done_) =>
                    patchItem.mutate({ itemId: child.id, patch: { done: done_ } })
                  }
                  onDelete={() => deleteItem.mutate(child.id)}
                />
              </div>
            ))}
          </div>
        ))}
        <div className="flex gap-2 pt-1">
          <Input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={t('work.card.addChecklistItem')}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && text.trim()) {
                addItem.mutate({ text: text.trim() })
                setText('')
              }
            }}
          />
        </div>

        {subtaskAi.isPending || suggested || subtaskAi.isError ? (
          <AiPreviewPanel
            title={t('work.ai.subtasksPreviewTitle')}
            status={subtaskAi.isPending ? 'pending' : subtaskAi.isError ? 'error' : 'ready'}
            pendingLabel={t('work.ai.subtasks')}
            errorMessage={t('work.quickAdd.aiError')}
            acceptLabel={t('work.ai.accept')}
            editLabel={t('work.ai.edit')}
            discardLabel={t('work.ai.discard')}
            retryLabel={t('work.ai.retry')}
            onAccept={() => void acceptSubtasks()}
            onEdit={() => setSuggested(null)}
            onDiscard={() => {
              setSuggested(null)
              subtaskAi.reset()
            }}
            onRetry={runSubtaskAi}
            {...(suggested
              ? {
                  costLine: t('work.quickAdd.aiMeta', {
                    tokens: suggested.tokens,
                    ms: suggested.ms,
                  }),
                }
              : {})}
          >
            {suggested ? (
              <ul className="flex flex-col gap-1">
                {suggested.items.map((line, i) => (
                  <li key={i} className="flex items-center gap-2">
                    <span
                      className="size-1.5 shrink-0 rounded-full bg-primary"
                      aria-hidden="true"
                    />
                    {line}
                  </li>
                ))}
              </ul>
            ) : null}
          </AiPreviewPanel>
        ) : null}
      </div>
    </Field>
  )
}

function ChecklistRow({
  item,
  onToggle,
  onDelete,
}: {
  item: { id: string; text: string; doneAt: string | null }
  onToggle: (done: boolean) => void
  onDelete: () => void
}) {
  const t = useT()
  return (
    <div className="flex items-center gap-2 rounded-sm px-1 py-1 hover:bg-accent">
      <Checkbox
        checked={item.doneAt !== null}
        onCheckedChange={(v) => onToggle(v === true)}
        celebrate
        size="sm"
        aria-label={item.text}
      />
      <span
        className={
          item.doneAt !== null
            ? 'flex-1 text-small text-muted-foreground line-through'
            : 'flex-1 text-small text-foreground'
        }
      >
        {item.text}
      </span>
      <IconButton aria-label={t('work.action.delete')} onClick={onDelete}>
        <Trash2 className="size-3.5" />
      </IconButton>
    </div>
  )
}

function Comments({
  cardId,
  cardTitle,
  comments,
  members,
}: {
  cardId: string
  cardTitle: string
  comments: Array<{ id: string; authorUserId: string; body: { text: string }; createdAt: string }>
  members: readonly MemberSummary[]
}) {
  const t = useT()
  const locale = useLocale()
  const [text, setText] = React.useState('')
  const addComment = useAddCommentMutation(cardId)

  const summarizeEnabled = useAiFeatureEnabled('summarize_thread')
  const summarizeAi = useRunAiFeatureMutation('summarize_thread')
  const [summary, setSummary] = React.useState<{
    text: string
    citedCount: number
    tokens: number
    ms: number
  } | null>(null)

  function runSummarize() {
    if (comments.length === 0) return
    setSummary(null)
    summarizeAi.mutate(
      {
        locale,
        cardTitle,
        comments: comments.map((c) => {
          const author = members.find((m) => m.userId === c.authorUserId)
          return {
            id: c.id,
            author: author ? fullName(author) : t('work.activity.system'),
            text: c.body.text,
          }
        }),
      },
      {
        onSuccess: (res) => {
          const data = res.data as { summary?: unknown; citedCommentIds?: unknown }
          if (typeof data.summary === 'string') {
            setSummary({
              text: data.summary,
              citedCount: Array.isArray(data.citedCommentIds) ? data.citedCommentIds.length : 0,
              tokens: res.meta.totalTokens,
              ms: res.meta.latencyMs,
            })
          }
        },
      },
    )
  }

  async function acceptSummary() {
    if (!summary) return
    await addComment.mutateAsync({ text: summary.text })
    setSummary(null)
    summarizeAi.reset()
  }

  async function submit() {
    if (!text.trim()) return
    const mentionMatches = [...text.matchAll(/@([\p{L}]+)/gu)].map((m) => m[1]!)
    const mentions = mentionMatches
      .map((token) => resolveQuickAddAssignee(token, members)?.userId)
      .filter((id): id is string => Boolean(id))
    await addComment.mutateAsync({ text: text.trim(), mentions })
    setText('')
  }

  return (
    <Field
      label={`${t('work.field.comments')} (${comments.length})`}
      action={
        summarizeEnabled && comments.length > 0 ? (
          <SparkleButton
            aria-label={t('work.ai.summarize')}
            size="sm"
            loading={summarizeAi.isPending}
            onClick={runSummarize}
          />
        ) : undefined
      }
    >
      <div className="flex flex-col gap-3">
        {comments.map((c) => {
          const author = members.find((m) => m.userId === c.authorUserId)
          return (
            <div key={c.id} className="flex gap-2">
              <Avatar
                size="sm"
                src={null}
                alt={author ? fullName(author) : ''}
                initials={author ? initialsFromName(author.givenName, author.familyName) : '?'}
                hueSeed={c.authorUserId}
              />
              <div className="flex-1 rounded-sm bg-muted p-2">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-small font-medium text-foreground">
                    {author ? fullName(author) : ''}
                  </span>
                  <span className="text-caption text-muted-foreground">
                    {formatDate(new Date(c.createdAt), locale)}
                  </span>
                </div>
                <p className="whitespace-pre-wrap text-small text-foreground">{c.body.text}</p>
              </div>
            </div>
          )
        })}

        {summarizeAi.isPending || summary || summarizeAi.isError ? (
          <AiPreviewPanel
            title={t('work.ai.summarizePreviewTitle')}
            status={summarizeAi.isPending ? 'pending' : summarizeAi.isError ? 'error' : 'ready'}
            pendingLabel={t('work.ai.summarize')}
            errorMessage={t('work.quickAdd.aiError')}
            acceptLabel={t('work.ai.postSummary')}
            editLabel={t('work.ai.edit')}
            discardLabel={t('work.ai.discard')}
            retryLabel={t('work.ai.retry')}
            onAccept={() => void acceptSummary()}
            onEdit={() => setSummary(null)}
            onDiscard={() => {
              setSummary(null)
              summarizeAi.reset()
            }}
            onRetry={runSummarize}
            {...(summary
              ? {
                  costLine:
                    t('work.ai.summarizeCitations', { count: summary.citedCount }) +
                    ' · ' +
                    t('work.quickAdd.aiMeta', { tokens: summary.tokens, ms: summary.ms }),
                }
              : {})}
          >
            {summary ? <p className="whitespace-pre-wrap">{summary.text}</p> : null}
          </AiPreviewPanel>
        ) : null}

        <div className="flex gap-2">
          <Input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={t('work.card.addCommentPlaceholder')}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void submit()
            }}
          />
          <Button
            size="sm"
            variant="secondary"
            onClick={() => void submit()}
            loading={addComment.isPending}
          >
            {t('work.action.send')}
          </Button>
        </div>
      </div>
    </Field>
  )
}

function ActivityTimeline({
  activity,
  members,
  locale,
}: {
  activity: Array<{
    id: string
    actorUserId: string | null
    kind: string
    data: Record<string, unknown>
    at: string
  }>
  members: readonly MemberSummary[]
  locale: Locale
}) {
  const t = useT()
  return (
    <ol className="flex flex-col gap-2 border-l border-border pl-3">
      {activity.map((event) => {
        const actor = members.find((m) => m.userId === event.actorUserId)
        return (
          <li key={event.id} className="text-caption text-muted-foreground">
            <span className="text-foreground">
              {actor ? fullName(actor) : t('work.activity.system')}
            </span>{' '}
            {t(`work.activity.${event.kind}`)} · {formatDate(new Date(event.at), locale)}
          </li>
        )
      })}
    </ol>
  )
}
