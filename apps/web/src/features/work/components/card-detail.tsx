// The card detail content (TECH-SPEC §5, DESIGN.md §9.4). round2 SEV2: the original two-column
// layout ran its left column at ~170px inside the 480px sheet -- title/status/description, then a
// full-width label-above-value property list (assignee, priority, due, ...), then links/checklist/
// comments, all in one column at the now-wider `--width-detail-panel`; activity stays a collapsible
// timeline at the bottom. Shared, unstyled-of-container content component -- `card-peek-dialog.tsx`
// wraps it in a `Dialog` for the side-peek, `card-page-screen.tsx` renders it directly as the full
// page (TECH-SPEC
// "card peek panel and full card page"). AI actions (subtasks, summarise thread, translate the
// description) are the preview-then-accept pattern UI-OVERHAUL.md's AI helpers row requires: a
// `SparkleButton` next to the field it enhances, an `AiPreviewPanel` with Accept/Edit/Discard, and no
// path that writes a generated result into the card without that Accept.
import * as React from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { ChevronDown, Link2, Plus, Trash2, X } from 'lucide-react'
import { useT, useLocale, formatDate, latinToCyrillic, type Locale } from '@devon/i18n'
import {
  Avatar,
  AvatarStack,
  Badge,
  Button,
  Celebrate,
  Checkbox,
  Chip,
  Collapsible,
  DatePicker,
  IconButton,
  Input,
  Select,
  SparkleButton,
  Skeleton,
  StateView,
  initialsFromName,
  labelChipColors,
  toast,
  toastWithUndo,
  useCelebrate,
  useReducedMotion,
  RISE_PX,
} from '@devon/ui'
import { useDepartment, useSession } from '../../../lib/session.js'
import { useIsDarkTheme } from '../../../lib/theme.js'
import { useRunAiFeatureMutation, useAiSettingsQuery } from '../../ai/use-ai.js'
import { AiResultPanel } from '../../ai/components/ai-result-panel.js'
import {
  DraftReplyPreview,
  SubtasksPreview,
  ThreadDigestPreview,
  TranslatePreview,
} from '../../ai/components/previews.js'
import {
  TranslateTargetPicker,
  defaultTranslateTarget,
  isLocalTransliterationPair,
} from '../../ai/components/translate-target.js'
import {
  parseFeatureOutput,
  type DraftReplyOutput,
  type SubtaskBreakdownOutput,
  type SummarizeThreadOutput,
  type TranslateOutput,
} from '../../ai/outputs.js'
import type { AiFeatureId, RunMeta } from '../../ai/types.js'
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

/** "Nodira Karimova" for a user id, or `null` for "nobody" -- used by the reassign/giver undo
 * toasts so the message names the person rather than echoing a uuid. */
function nameOf(members: readonly MemberSummary[], userId: string | null): string | null {
  if (!userId) return null
  const member = members.find((m) => m.userId === userId)
  return member ? fullName(member) : null
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

  const assigneeFlash = useFieldFlash()
  const giverFlash = useFieldFlash()
  const priorityFlash = useFieldFlash()
  const dueFlash = useFieldFlash()
  const startFlash = useFieldFlash()

  const [titleDraft, setTitleDraft] = React.useState('')
  const [descDraft, setDescDraft] = React.useState('')
  const [linkInput, setLinkInput] = React.useState('')
  const [newLabelName, setNewLabelName] = React.useState('')
  const [activityOpen, setActivityOpen] = React.useState(false)
  const doneCelebrate = useCelebrate()

  const card = query.data
  /** The server's own answer (`canEdit` on the card DTO), never a client-side guess. Absent means an
   * older server: treat as editable, exactly as before v1.1. */
  const canEdit = card?.canEdit !== false
  React.useEffect(() => {
    if (card) {
      setTitleDraft(card.title)
      setDescDraft(card.description?.text ?? '')
    }
  }, [card?.id, card?.title, card?.description?.text]) // eslint-disable-line react-hooks/exhaustive-deps

  const translateEnabled = useAiFeatureEnabled('translate')
  const translateAi = useRunAiFeatureMutation('translate')
  const [translatePreview, setTranslatePreview] = React.useState<{
    output: TranslateOutput
    meta: RunMeta | null
  } | null>(null)
  // AI-AUDIT 0.1, the single biggest cause of "the AI just translates everything to Uzbek": v1.0
  // called this feature with `locale` -- the reader's own UI language -- as the TARGET. A uz-Latn
  // user pressing sparkle beside an Uzbek description asked GLM to translate Uzbek into Uzbek, and
  // the prompt duly returned it lightly polished. Nothing ever asked which language they wanted.
  const [translateTarget, setTranslateTarget] = React.useState<Locale>(() =>
    defaultTranslateTarget(locale),
  )

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
    } else {
      // UI-OVERHAUL.md §3 "RSVP yes, card done, sprint complete": a celebration moment, not a
      // plain status change -- a project-scoped card stays `done` (not archived, see
      // `nextDoneStatus`), so this is the one path that actually deserves the burst.
      doneCelebrate.fire()
      toast(t('work.card.done'))
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
    // D-2: uz-Latn to uz-Cyrl is a lookup table in `packages/i18n`, not a language model. Instant,
    // free, and with no chance of a model quietly rewriting a card description while converting the
    // script it is written in.
    if (isLocalTransliterationPair(locale, translateTarget)) {
      setTranslatePreview({
        meta: null,
        output: {
          translatedText: latinToCyrillic(source),
          detectedSourceLocale: locale,
          alreadyInTarget: false,
          uncertainTerms: [],
        },
      })
      return
    }
    translateAi.mutate(
      {
        // `locale` is the reader's language and only shapes how uncertainty is phrased;
        // `targetLocale` is what the text is translated into.
        locale,
        targetLocale: translateTarget,
        sourceLocale: null,
        text: source,
        glossary: [],
        preserve: [],
      },
      {
        onSuccess: (res) => {
          const output = parseFeatureOutput<TranslateOutput>('translate', res.data)
          if (output) setTranslatePreview({ output, meta: res.meta })
        },
      },
    )
  }

  async function acceptTranslate() {
    if (!translatePreview) return
    const text = translatePreview.output.translatedText
    setDescDraft(text)
    await saveDescription(text)
    setTranslatePreview(null)
    translateAi.reset()
  }

  return (
    <div className="flex flex-col gap-6">
      {/* v1.1 SPEC §2.2 (D6a): the whole department's board is readable -- that transparency is the
          product -- but a card belongs to the person who gave it, the person doing it and the person
          who created it, plus the boshqarma boshlig'i. For everyone else this sheet is a reading
          view, and it says so once, at the top, instead of letting a dozen controls fail one by one.
          `canEdit` is computed on the server and carried on the DTO. */}
      {!canEdit ? (
        <p
          className="rounded-md border border-border bg-muted/40 px-3 py-2 text-small text-muted-foreground"
          role="status"
        >
          {t('work.card.readOnly')}
        </p>
      ) : null}
      <header className="flex flex-col gap-2">
        <div className="flex items-start justify-between gap-2">
          <textarea
            value={titleDraft}
            onChange={(e) => setTitleDraft(e.target.value)}
            onBlur={() => void saveTitle()}
            rows={1}
            readOnly={!canEdit}
            aria-label={t('work.field.title')}
            className="w-full resize-none rounded-sm border border-transparent bg-transparent p-1 font-display text-h3 text-foreground outline-none hover:border-border focus-visible:border-border focus-visible:ring-2 focus-visible:ring-ring read-only:hover:border-transparent"
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
              <span className="relative inline-flex">
                <Button size="sm" onClick={() => void markDone()} loading={patchCard.isPending}>
                  {t('work.card.markDone')}
                </Button>
                <Celebrate play={doneCelebrate.play} onDone={doneCelebrate.onDone} />
              </span>
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

      {/* round2 SEV2: the two-column split ran the left column at ~170px inside the 480px sheet --
          a description textarea broke after four words, a three-word comment took four lines, and
          two field labels ("Havola manzilini kiriting"/"Izoh yozing" placeholders, in practice) were
          clipped by their own inputs. One column, full sheet width (now 560-600px, see
          --width-detail-panel), reads as a document instead of a cramped two-up form. */}
      <div className="flex min-w-0 flex-col gap-6">
        <Field
          label={t('work.field.description')}
          action={
            translateEnabled && descDraft.trim() ? (
              <span className="flex flex-wrap items-center gap-2">
                <TranslateTargetPicker
                  id={`card-translate-target-${card.id}`}
                  value={translateTarget}
                  onChange={setTranslateTarget}
                  disabled={translateAi.isPending}
                />
                <SparkleButton
                  aria-label={t('work.ai.translate')}
                  size="sm"
                  loading={translateAi.isPending}
                  onClick={runTranslate}
                />
              </span>
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
            <AiResultPanel
              className="mt-2"
              title={t('work.ai.translatePreviewTitle')}
              status={translateAi.isPending ? 'pending' : translateAi.isError ? 'error' : 'ready'}
              errorMessage={t('work.quickAdd.aiError')}
              acceptLabel={t('work.ai.accept')}
              editLabel={t('work.ai.edit')}
              {...(translatePreview?.meta ? { meta: translatePreview.meta } : {})}
              onAccept={() => void acceptTranslate()}
              // Edit puts the translation in the textarea without saving it, so the person can adjust
              // a term before it becomes the card's description. v1.0's Edit discarded the answer.
              onEdit={() => {
                if (translatePreview) setDescDraft(translatePreview.output.translatedText)
                setTranslatePreview(null)
                translateAi.reset()
              }}
              onDiscard={() => {
                setTranslatePreview(null)
                translateAi.reset()
              }}
              onRetry={runTranslate}
            >
              {translatePreview ? <TranslatePreview output={translatePreview.output} /> : null}
            </AiResultPanel>
          ) : null}
        </Field>

        {/* Properties: a label-above-value row per field, full sheet width -- DESIGN.md §9.4,
              round2 SEV2's "definition list" fix for the old cramped 240px right column. */}
        <div className="flex flex-col gap-4 border-y border-border py-4">
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
          {/* WALKTHROUGH-FINDINGS 1.2 / SPEC 12: reassigning somebody's work used to happen in
              silence -- the card simply vanished from the board with no toast, no confirm and no way
              back. Both of these now say what happened and offer the one click that undoes it
              (DESIGN.md: undo over confirm). The previous value is captured before the mutation, so
              the undo restores exactly what was there, including "nobody". */}
          <Field label={t('work.field.assignee')} flashedAt={assigneeFlash.flashedAt}>
            <MemberPicker
              members={members}
              value={card.assigneeUserId}
              onChange={(userId) => {
                const previous = card.assigneeUserId
                void patchCard
                  .mutateAsync({ id: card.id, patch: { assigneeUserId: userId } })
                  .then(() => {
                    assigneeFlash.flash()
                    toastWithUndo({
                      message: t('work.card.reassigned', {
                        name: nameOf(members, userId) ?? t('work.field.unassigned'),
                      }),
                      undoLabel: t('work.card.undo'),
                      onUndo: () =>
                        void patchCard.mutateAsync({
                          id: card.id,
                          patch: { assigneeUserId: previous },
                        }),
                    })
                  })
              }}
              placeholderKey="work.field.unassigned"
            />
          </Field>
          <Field label={t('work.field.giver')} flashedAt={giverFlash.flashedAt}>
            <MemberPicker
              members={members}
              value={card.giverUserId}
              onChange={(userId) => {
                const previous = card.giverUserId
                void patchCard
                  .mutateAsync({ id: card.id, patch: { giverUserId: userId } })
                  .then(() => {
                    giverFlash.flash()
                    toastWithUndo({
                      message: t('work.card.giverChanged', {
                        name: nameOf(members, userId) ?? t('work.field.noGiver'),
                      }),
                      undoLabel: t('work.card.undo'),
                      onUndo: () =>
                        void patchCard.mutateAsync({
                          id: card.id,
                          patch: { giverUserId: previous },
                        }),
                    })
                  })
              }}
              placeholderKey="work.field.noGiver"
            />
          </Field>
          <Field label={t('work.field.priority')} flashedAt={priorityFlash.flashedAt}>
            <Select
              aria-label={t('work.field.priority')}
              value={card.priority}
              onChange={(e) =>
                void patchCard
                  .mutateAsync({
                    id: card.id,
                    patch: { priority: e.target.value as CardPriority },
                  })
                  .then(priorityFlash.flash)
              }
              options={PRIORITIES.map((p) => ({ value: p, label: t(PRIORITY_LABEL_KEY[p]) }))}
            />
          </Field>
          <Field label={t('work.field.due')} flashedAt={dueFlash.flashedAt}>
            <DatePicker
              locale={locale}
              label={t('work.field.due')}
              placeholder={t('work.field.due')}
              selected={toDateInputValue(card.dueAt)}
              onSelect={(date) =>
                void patchCard
                  .mutateAsync({ id: card.id, patch: { dueAt: dateToIso(date) } })
                  .then(dueFlash.flash)
              }
              triggerClassName="w-full justify-start"
            />
          </Field>
          <Field label={t('work.field.start')} flashedAt={startFlash.flashedAt}>
            <DatePicker
              locale={locale}
              label={t('work.field.start')}
              placeholder={t('work.field.start')}
              selected={toDateInputValue(card.startAt)}
              onSelect={(date) =>
                void patchCard
                  .mutateAsync({ id: card.id, patch: { startAt: dateToIso(date) } })
                  .then(startFlash.flash)
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
                // A pastel label colour with hardcoded white text was illegible the moment
                // someone picked a light hue ("Hisobot"/"Tashqi" in the item handoff) --
                // labelChipColors derives a background/foreground pair from that one colour,
                // guaranteed >= 4.5:1 contrast, so any colour a member picks stays readable in
                // both themes.
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

/** Bumps to a fresh (truthy) value every time the field it's attached to should flash -- `Field`
 * below only cares that the value *changed*, not what it is, so `Date.now()` is a fine "this just
 * happened again" token even for two flashes in the same millisecond-resolution tick being merged
 * (a flash replaying because a second edit landed within the animation's own 700ms is still exactly
 * the "this saved" acknowledgement UI-OVERHAUL.md asks for). */
function useFieldFlash(): { flashedAt: number; flash: () => void } {
  const [flashedAt, setFlashedAt] = React.useState(0)
  return { flashedAt, flash: React.useCallback(() => setFlashedAt(Date.now()), []) }
}

function Field({
  label,
  action,
  children,
  flashedAt,
}: {
  label: string
  action?: React.ReactNode
  children: React.ReactNode
  /** round2 SEV2 "property edits commit with no feedback": a token from `useFieldFlash` -- each new
   * value plays one soft success-tinted sweep behind the field, transform/opacity only, then removes
   * itself. Reduced motion still gets the sweep (it is a colour fade, not a translate/scale), just at
   * `--dur-micro` instead of the fuller `--dur-standard`. */
  flashedAt?: number
}) {
  const reduced = useReducedMotion()
  return (
    <label className="relative flex flex-col gap-1.5 text-small">
      <span className="flex items-center gap-2">
        <span className="text-caption font-medium uppercase tracking-(--text-eyebrow--letter-spacing) text-muted-foreground">
          {label}
        </span>
        {action ? <span className="ml-auto">{action}</span> : null}
      </span>
      <AnimatePresence>
        {flashedAt ? (
          <motion.span
            key={flashedAt}
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 -mx-2 -my-1 rounded-sm bg-success/20"
            initial={{ opacity: 0.9 }}
            animate={{ opacity: 0 }}
            transition={{ duration: reduced ? 0.15 : 0.7, ease: 'easeOut' }}
          />
        ) : null}
      </AnimatePresence>
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
    /** So the step sizes can be judged against the time actually left (AI-AUDIT F2). */
    dueAt: string | null
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

  // UI-OVERHAUL.md §3 "RSVP yes, card done, sprint complete": the checklist itself gets a
  // celebration too, the moment its *last* item lands -- not on every render of an already-full
  // checklist (a card reopened later, or a sibling item added after completion resets `done` below
  // `card.checklist.length` and un-arms this until it fills again).
  const checklistCelebrate = useCelebrate()
  const wasChecklistComplete = React.useRef(false)
  const checklistComplete = card.checklist.length > 0 && done === card.checklist.length
  React.useEffect(() => {
    if (checklistComplete && !wasChecklistComplete.current) {
      checklistCelebrate.fire()
      toast(t('work.card.checklistComplete'))
    }
    wasChecklistComplete.current = checklistComplete
  }, [checklistComplete]) // eslint-disable-line react-hooks/exhaustive-deps -- fire on transition only

  const subtasksEnabled = useAiFeatureEnabled('subtask_breakdown')
  const subtaskAi = useRunAiFeatureMutation('subtask_breakdown')
  const [suggested, setSuggested] = React.useState<{
    output: SubtaskBreakdownOutput
    meta: RunMeta
  } | null>(null)

  function runSubtaskAi() {
    setSuggested(null)
    subtaskAi.mutate(
      {
        locale,
        cardTitle: card.title,
        cardDescription: card.description?.text ?? null,
        existingSubtasks: card.checklist.map((i) => i.text),
        // v1.1: the feature is told what the card is about and how long is left, so its steps are
        // sized against the real deadline instead of being six generic lines (AI-AUDIT F2).
        labels: [],
        projectTitle: null,
        dueInDays: card.dueAt
          ? Math.round((new Date(card.dueAt).getTime() - Date.now()) / 86_400_000)
          : null,
        targetCount: 6,
      },
      {
        onSuccess: (res) => {
          const output = parseFeatureOutput<SubtaskBreakdownOutput>('subtask_breakdown', res.data)
          if (output) setSuggested({ output, meta: res.meta })
        },
      },
    )
  }

  async function acceptSubtasks() {
    if (!suggested) return
    const existing = new Set(card.checklist.map((i) => i.text.trim().toLowerCase()))
    const toAdd = suggested.output.subtasks
      .map((item) => item.text.trim())
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
      <div className="relative flex flex-col gap-1">
        <Celebrate play={checklistCelebrate.play} onDone={checklistCelebrate.onDone} radius={30} />
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
          <AiResultPanel
            title={t('work.ai.subtasksPreviewTitle')}
            status={subtaskAi.isPending ? 'pending' : subtaskAi.isError ? 'error' : 'ready'}
            errorMessage={t('work.quickAdd.aiError')}
            acceptLabel={t('work.ai.accept')}
            editLabel={t('work.ai.edit')}
            {...(suggested ? { meta: suggested.meta } : {})}
            onAccept={() => void acceptSubtasks()}
            // Edit drops the first suggested step into the "add an item" input so the person can
            // reword it and add the rest by hand. v1.0's Edit threw the whole answer away.
            onEdit={() => {
              if (suggested?.output.subtasks[0]) setText(suggested.output.subtasks[0].text)
              setSuggested(null)
              subtaskAi.reset()
            }}
            onDiscard={() => {
              setSuggested(null)
              subtaskAi.reset()
            }}
            onRetry={runSubtaskAi}
          >
            {suggested ? <SubtasksPreview output={suggested.output} /> : null}
          </AiResultPanel>
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
  // Both thread features write *for* a named reader and, for the reply, in the register their role
  // carries -- a boshqarma boshligʻi's answer is phrased differently from one between colleagues.
  // Neither is ever invented: both come from the session.
  const { user } = useSession()
  const { department } = useDepartment()
  const viewerName = user ? `${user.givenName} ${user.familyName}`.trim() : t('work.ai.viewerYou')
  const viewerRole: 'head' | 'member' = department?.role === 'head' ? 'head' : 'member'
  const commentsReduced = useReducedMotion()
  const [text, setText] = React.useState('')
  const addComment = useAddCommentMutation(cardId)

  const summarizeEnabled = useAiFeatureEnabled('summarize_thread')
  const summarizeAi = useRunAiFeatureMutation('summarize_thread')
  const [summary, setSummary] = React.useState<{
    output: SummarizeThreadOutput
    meta: RunMeta
  } | null>(null)

  // N-1, the audit's highest-value addition: "draft a reply". The department writes in four
  // languages and a junior xodim drafting a polite administrative answer is genuinely hard work.
  // It composes into the comment box and never posts -- there is no code path here that sends.
  const replyEnabled = useAiFeatureEnabled('draft_reply')
  const replyAi = useRunAiFeatureMutation('draft_reply')
  const [reply, setReply] = React.useState<{ output: DraftReplyOutput; meta: RunMeta } | null>(null)

  function runSummarize() {
    if (comments.length === 0) return
    setSummary(null)
    summarizeAi.mutate(
      {
        locale,
        subject: { kind: 'card', id: cardId, title: cardTitle },
        viewerName,
        comments: threadForAi(),
      },
      {
        onSuccess: (res) => {
          const output = parseFeatureOutput<SummarizeThreadOutput>('summarize_thread', res.data)
          if (output) setSummary({ output, meta: res.meta })
        },
      },
    )
  }

  function threadForAi() {
    return comments.map((c) => {
      const author = members.find((m) => m.userId === c.authorUserId)
      return {
        id: c.id,
        author: author ? fullName(author) : t('work.activity.system'),
        text: c.body.text,
        createdAt: c.createdAt,
      }
    })
  }

  function runDraftReply() {
    if (comments.length === 0) return
    setReply(null)
    replyAi.mutate(
      {
        locale,
        subject: { kind: 'card', id: cardId, title: cardTitle },
        viewerName,
        viewerRole,
        comments: threadForAi(),
        tone: 'neutral',
        intent: text.trim(),
      },
      {
        onSuccess: (res) => {
          const output = parseFeatureOutput<DraftReplyOutput>('draft_reply', res.data)
          if (output) setReply({ output, meta: res.meta })
        },
      },
    )
  }

  /** The digest as a comment a person can post -- decisions, open questions and commitments, each
   * on its own line. Nothing invented, nothing dropped. */
  function summaryAsComment(output: SummarizeThreadOutput): string {
    const lines: string[] = []
    if (output.decisions.length > 0) {
      lines.push(`${t('ai.preview.thread.decisions')}:`)
      for (const decision of output.decisions) lines.push(`- ${decision.text}`)
    }
    if (output.openQuestions.length > 0) {
      lines.push(`${t('ai.preview.thread.openQuestions')}:`)
      for (const question of output.openQuestions) lines.push(`- ${question.text}`)
    }
    if (output.commitments.length > 0) {
      lines.push(`${t('ai.preview.thread.commitments')}:`)
      for (const c of output.commitments) lines.push(`- ${c.who}: ${c.what}`)
    }
    return lines.join('\n')
  }

  /**
   * AI-AUDIT §5 fix 13: v1.0's Accept **posted the summary as a comment**, immediately, with no
   * second look -- the one thing TECH-SPEC §8 and the audit both say an AI feature must never do.
   * Accept now fills the compose box. The person presses Send, or does not.
   */
  function acceptSummary() {
    if (!summary) return
    setText(summaryAsComment(summary.output))
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
        {/* round2 SEV2 "the comment list does not animate a new comment in": each row still only
            plays this once, at its own mount -- an already-loaded comment does not replay it when a
            sibling is added below it. */}
        <AnimatePresence initial={false}>
          {comments.map((c) => {
            const author = members.find((m) => m.userId === c.authorUserId)
            return (
              <motion.div
                key={c.id}
                id={`comment-${c.id}`}
                className="flex gap-2"
                initial={commentsReduced ? { opacity: 0 } : { opacity: 0, y: RISE_PX }}
                animate={{ opacity: 1, y: 0 }}
                transition={
                  commentsReduced ? { duration: 0.12 } : { duration: 0.22, ease: 'easeOut' }
                }
              >
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
              </motion.div>
            )
          })}
        </AnimatePresence>

        {summarizeAi.isPending || summary || summarizeAi.isError ? (
          <AiResultPanel
            title={t('work.ai.summarizePreviewTitle')}
            status={summarizeAi.isPending ? 'pending' : summarizeAi.isError ? 'error' : 'ready'}
            errorMessage={t('work.quickAdd.aiError')}
            acceptLabel={t('work.ai.postSummary')}
            editLabel={t('work.ai.edit')}
            {...(summary ? { meta: summary.meta } : {})}
            onAccept={acceptSummary}
            onEdit={() => {
              if (summary) setText(summaryAsComment(summary.output))
            }}
            onDiscard={() => {
              setSummary(null)
              summarizeAi.reset()
            }}
            onRetry={runSummarize}
          >
            {summary ? (
              <ThreadDigestPreview
                output={summary.output}
                onJumpToComment={(commentId) => {
                  document
                    .getElementById(`comment-${commentId}`)
                    ?.scrollIntoView({ behavior: 'smooth', block: 'center' })
                }}
              />
            ) : null}
          </AiResultPanel>
        ) : null}

        {replyAi.isPending || reply || replyAi.isError ? (
          <AiResultPanel
            title={t('work.ai.draftReplyPreviewTitle')}
            status={replyAi.isPending ? 'pending' : replyAi.isError ? 'error' : 'ready'}
            errorMessage={t('work.quickAdd.aiError')}
            acceptLabel={t('work.ai.useDraft')}
            editLabel={t('work.ai.edit')}
            {...(reply ? { meta: reply.meta } : {})}
            onAccept={() => {
              if (reply) setText(reply.output.draft)
              setReply(null)
              replyAi.reset()
            }}
            onEdit={() => {
              if (reply) setText(reply.output.draft)
            }}
            onDiscard={() => {
              setReply(null)
              replyAi.reset()
            }}
            onRetry={runDraftReply}
          >
            {reply ? <DraftReplyPreview output={reply.output} /> : null}
          </AiResultPanel>
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
          {replyEnabled && comments.length > 0 ? (
            <SparkleButton
              aria-label={t('work.ai.draftReply')}
              size="sm"
              loading={replyAi.isPending}
              onClick={runDraftReply}
            />
          ) : null}
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
