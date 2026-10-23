import { WORK_TITLE_MAX } from '@devon/contracts'
import { avatarUrl } from '../../../lib/avatar.js'
// Shared task document for the routed drawer and full page. Primary status actions stay in the
// header; assignee/priority/deadline precede the actual work. Secondary metadata is disclosed on
// demand, and AI output always remains a preview until accepted.
import * as React from 'react'
import { AnimatePresence, motion } from 'motion/react'
import {
  Archive,
  Check,
  ChevronDown,
  Circle,
  CircleDot,
  Eye,
  EyeOff,
  FolderKanban,
  Link2,
  MoreHorizontal,
  Pencil,
  Pin,
  PinOff,
  Plus,
  SlidersHorizontal,
  Trash2,
  X,
} from 'lucide-react'
import { useT, useLocale, formatDate, type Locale } from '@devon/i18n'
import { useCardSignals, useSignalWhile } from '../../../lib/realtime/index.js'
import {
  Avatar,
  AvatarStack,
  Badge,
  Button,
  Celebrate,
  Chip,
  Collapsible,
  cn,
  Popover,
  PopoverContent,
  PopoverTrigger,
  DatePicker,
  FlashOnChange,
  IconButton,
  initialsFromName,
  Input,
  labelChipColors,
  RISE_PX,
  Select,
  Shake,
  Skeleton,
  SparkleButton,
  StateView,
  toast,
  toastWithUndo,
  useCelebrate,
  useReducedMotion,
} from '@devon/ui'
import { navigate, replaceSearchParam } from '../../../lib/router.js'
import { useDepartment, useSession } from '../../../lib/session.js'
import { useIsDarkTheme } from '../../../lib/theme.js'
import { useRunAiFeatureMutation, useAiSettingsQuery } from '../../ai/use-ai.js'
import { AiResultPanel } from '../../ai/components/ai-result-panel.js'
import {
  AssigneeSuggestionsPreview,
  DraftReplyPreview,
  RiskExplainPreview,
  SubtasksPreview,
  ThreadDigestPreview,
  TranslatePreview,
} from '../../ai/components/previews.js'
import {
  TranslateTargetPicker,
  defaultTranslateTarget,
} from '../../ai/components/translate-target.js'
import { useSummaryQuery } from '../../analytics/use-analytics.js'
import {
  parseFeatureOutput,
  type DeadlineRiskOutput,
  type DraftReplyOutput,
  type SuggestAssigneeOutput,
  type SubtaskBreakdownOutput,
  type SummarizeThreadOutput,
  type TranslateOutput,
} from '../../ai/outputs.js'
import type { AiFeatureId, RunMeta } from '../../ai/types.js'
import { useProjectsQuery } from '../../projects/hooks.js'
import { ConvertProjectDialog } from '../../projects/components/convert-project-dialog.js'
import { CardAttachments } from './card-attachments.js'
import { CardLinkLabel } from './card-link-label.js'
import { ArchivedCardBadge } from './archived-card-badge.js'
import { ChecklistRow } from './checklist-row.js'
// v1.1 SPEC §5: the boshqarma's own columns on a card, rendered in the head's order at the end of the
// property list. The `fields` feature owns the component; this is the one line that puts it here.
import { CardCustomFields } from '../../fields/index.js'
import {
  nextDoneStatus,
  useAddChecklistItemMutation,
  useAddCommentMutation,
  useEditCommentMutation,
  useDeleteCommentMutation,
  useCardQuery,
  useCreateLabelMutation,
  useDeleteChecklistItemMutation,
  useDeleteCardMutation,
  useLabelsQuery,
  useMembers,
  usePatchCardMutation,
  usePatchChecklistItemMutation,
  useRestoreCardMutation,
  useToggleWatcherMutation,
  useUnfurlMutation,
} from '../hooks.js'
import { resolveQuickAddAssignee } from '../lib/quick-add.js'
import { PRIORITY_LABEL_KEY, RISK_BADGE_TONE, RISK_LABEL_KEY, fullName } from '../lib/format.js'
import { useAddFocusMutation, useFocusListQuery, useRemoveFocusMutation } from '../hooks-plus.js'
import { MemberPicker } from './member-picker.js'
import { CardPlusSections } from './card-plus-sections.js'
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

export function CardDetailContent({
  cardId,
  onClose,
  presentation = 'page',
}: {
  cardId: string
  onClose?: () => void
  presentation?: 'drawer' | 'page'
}) {
  const t = useT()
  const locale = useLocale()
  const query = useCardQuery(cardId)
  const members = useMembers()
  const { department } = useDepartment()
  const isHead = department?.role === 'head'
  const labels = useLabelsQuery().data ?? []
  const projects = useProjectsQuery().data ?? []
  const { user } = useSession()
  const isDark = useIsDarkTheme()
  const patchCard = usePatchCardMutation()
  const restoreCard = useRestoreCardMutation()
  const deleteCard = useDeleteCardMutation()
  const undoDelete = useDeleteCardMutation(true)
  const toggleWatcher = useToggleWatcherMutation()
  const createLabel = useCreateLabelMutation()
  const unfurl = useUnfurlMutation()
  // A9 -- the focus list ("Diqqat markazi"). Personal, so it needs no `canEdit`: pinning somebody
  // else's card to *your own* five is exactly the point.
  const focusList = useFocusListQuery()
  const addFocus = useAddFocusMutation()
  const removeFocus = useRemoveFocusMutation()

  const assigneeFlash = useFieldFlash()
  const giverFlash = useFieldFlash()
  const priorityFlash = useFieldFlash()
  const dueFlash = useFieldFlash()
  const startFlash = useFieldFlash()

  const [titleDraft, setTitleDraft] = React.useState('')
  const [titleError, setTitleError] = React.useState(false)
  const [descDraft, setDescDraft] = React.useState('')
  const draftCardId = React.useRef<string | null>(null)
  const titleEditing = React.useRef(false)
  const descriptionEditing = React.useRef(false)
  const currentTitleDraft = React.useRef('')
  const currentDescriptionDraft = React.useRef('')
  const [linkInput, setLinkInput] = React.useState('')
  const [linkPending, setLinkPending] = React.useState(false)
  const linkWritePending = React.useRef(false)
  const [newLabelName, setNewLabelName] = React.useState('')
  const [activityOpen, setActivityOpen] = React.useState(false)
  const doneCelebrate = useCelebrate()

  const card = query.data
  /** The server's own answer (`canEdit` on the card DTO), never a client-side guess. Absent means an
   * older server: treat as editable, exactly as before v1.1. */
  const canEdit = card?.canEdit !== false
  React.useLayoutEffect(() => {
    if (card) {
      if (draftCardId.current !== card.id) {
        draftCardId.current = card.id
        titleEditing.current = false
        descriptionEditing.current = false
        setTitleError(false)
      }
      // Realtime/refetch and a different field's optimistic rollback must not erase unsaved text.
      if (!titleEditing.current) {
        currentTitleDraft.current = card.title
        setTitleDraft(card.title)
      }
      if (!descriptionEditing.current) {
        currentDescriptionDraft.current = card.description?.text ?? ''
        setDescDraft(currentDescriptionDraft.current)
      }
    }
  }, [card?.id, card?.title, card?.description?.text]) // eslint-disable-line react-hooks/exhaustive-deps

  function editTitleDraft(value: string) {
    titleEditing.current = true
    currentTitleDraft.current = value
    setTitleDraft(value)
    if (value.trim()) setTitleError(false)
  }
  function editDescriptionDraft(value: string) {
    descriptionEditing.current = true
    currentDescriptionDraft.current = value
    setDescDraft(value)
  }

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

  // F4, rebuilt as an *explainer* (AI-AUDIT §4, D-4). `computeRisk()` on the server already decided
  // whether this card is at risk; two sources of truth for that would be a defect, not a feature.
  // The model is handed that verdict and asked only to say why, in words, and name one thing to do.
  const riskEnabled = useAiFeatureEnabled('deadline_risk')
  const riskAi = useRunAiFeatureMutation('deadline_risk')
  const [riskExplain, setRiskExplain] = React.useState<{
    output: DeadlineRiskOutput
    meta: RunMeta
  } | null>(null)

  // N-3. Head-only, on the server (`department_managed`) and here: "who should take this" reads
  // every member's workload, which is management information, and the head is the one who chooses.
  const assigneeAiEnabled = useAiFeatureEnabled('suggest_assignee') && isHead
  const assigneeAi = useRunAiFeatureMutation('suggest_assignee')
  const [assigneeSuggestions, setAssigneeSuggestions] = React.useState<{
    output: SuggestAssigneeOutput
    meta: RunMeta
  } | null>(null)
  // The load numbers the suggestion is allowed to reason over -- the department's own aggregates,
  // fetched only when a head actually opens this sheet with the helper enabled.
  const loadSummary = useSummaryQuery({})

  if (query.isPending) {
    return (
      <div className="flex flex-col gap-4 p-4">
        {onClose ? (
          <IconButton
            className="self-end"
            aria-label={t('shell.shortcuts.close')}
            onClick={onClose}
          >
            <X aria-hidden="true" />
          </IconButton>
        ) : null}
        <Skeleton className="h-8 w-3/4" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    )
  }
  if (query.isError || !card) {
    return (
      <div className="flex flex-col gap-4 p-4">
        {onClose ? (
          <IconButton
            className="self-end"
            aria-label={t('shell.shortcuts.close')}
            onClick={onClose}
          >
            <X aria-hidden="true" />
          </IconButton>
        ) : null}
        <StateView
          kind="error"
          titleKey="state.error.title"
          bodyKey="state.error.body"
          action={{ labelKey: 'state.error.action', onAction: () => void query.refetch() }}
        />
      </div>
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
      src: avatarUrl(m.avatarKey, 64),
    }))

  async function saveTitle() {
    if (!canEdit) return
    if (titleDraft.trim().length === 0) {
      setTitleError(true)
      return
    }
    if (titleDraft === card!.title) {
      titleEditing.current = false
      return
    }
    const draft = titleDraft
    const id = card!.id
    try {
      await patchCard.mutateAsync({ id, patch: { title: draft.trim() } })
      if (draftCardId.current === id && currentTitleDraft.current === draft) {
        titleEditing.current = false
        currentTitleDraft.current = draft.trim()
        setTitleDraft(draft.trim())
      }
    } catch {
      // The shared mutation reports the refusal. Keep dirty text for correction/retry.
    }
  }
  async function saveDescription(nextText?: string) {
    if (!canEdit) return false
    const next = nextText ?? descDraft
    if (next === (card!.description?.text ?? '')) {
      descriptionEditing.current = false
      return true
    }
    const id = card!.id
    try {
      await patchCard.mutateAsync({ id, patch: { description: next || null } })
      if (draftCardId.current === id && currentDescriptionDraft.current === next)
        descriptionEditing.current = false
      return true
    } catch {
      return false
    }
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

  async function deleteNow() {
    const id = card!.id
    deleteCard.mutate(id, {
      onSuccess: () => {
        toastWithUndo({
          message: t('work.deletion.done'),
          undoLabel: t('action.undo'),
          // Leave time to read and recover, with a margin inside the server's 30-second window.
          durationMs: 20_000,
          onUndo: () => undoDelete.mutate(id),
        })
        if (onClose) onClose()
        else navigate('/work')
      },
    })
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
    if (!url || !canEdit || linkWritePending.current || patchCard.isPending) return
    if (card!.links.some((link) => link.url === url)) {
      setLinkInput('')
      return
    }
    linkWritePending.current = true
    setLinkPending(true)
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
    } finally {
      linkWritePending.current = false
      setLinkPending(false)
    }
  }

  async function removeLink(url: string) {
    if (!canEdit || linkWritePending.current || patchCard.isPending) return
    linkWritePending.current = true
    setLinkPending(true)
    try {
      await patchCard.mutateAsync({
        id: card!.id,
        patch: { links: card!.links.filter((l) => l.url !== url) },
      })
    } catch {
      toast(t('toast.saveError'))
    } finally {
      linkWritePending.current = false
      setLinkPending(false)
    }
  }

  function toggleLabel(labelId: string) {
    if (!canEdit || patchCard.isPending) return
    const next = card!.labels.includes(labelId)
      ? card!.labels.filter((l) => l !== labelId)
      : [...card!.labels, labelId]
    patchCard.mutate({ id: card!.id, patch: { labels: next } })
  }

  function runTranslate() {
    const source = descDraft.trim()
    if (!source) return
    setTranslatePreview(null)
    // The UI language is not the description's language; let the translator detect the source.
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

  function runRiskExplain() {
    if (!card) return
    setRiskExplain(null)
    const today = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Tashkent',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date())
    const assignee = members.find((m) => m.userId === card.assigneeUserId)
    riskAi.mutate(
      {
        locale,
        card: {
          id: card.id,
          title: card.title,
          // The server's verdict, passed through *unchanged*. `computeRisk()` already decided, the
          // prompt is explicit that it may not re-decide, and re-spelling the three values into a
          // generic severity scale on the way is how this call started failing its own input schema.
          riskLevel: card.risk,
          dueDate: card.dueAt ? card.dueAt.slice(0, 10) : null,
          today,
          checklistTotal: card.checklist.length,
          checklistDone: card.checklist.filter((i) => i.doneAt !== null).length,
          daysSinceUpdate: Math.max(
            0,
            Math.round((Date.now() - new Date(card.updatedAt).getTime()) / 86_400_000),
          ),
          assigneeName: assignee ? fullName(assignee) : null,
          commentCount: card.comments.length,
          blockedByTitles: [],
          similarSlippedCount: 0,
        },
      },
      {
        onSuccess: (res) => {
          const output = parseFeatureOutput<DeadlineRiskOutput>('deadline_risk', res.data)
          if (output) setRiskExplain({ output, meta: res.meta })
        },
      },
    )
  }

  function runSuggestAssignee() {
    if (!card) return
    setAssigneeSuggestions(null)
    const loadByName = new Map(
      (loadSummary.data?.loadPerPerson ?? []).map((person) => [person.userId, person] as const),
    )
    const candidates = members.map((member) => {
      const load = loadByName.get(member.userId)
      return {
        userId: member.userId,
        fullName: fullName(member),
        openCount: load?.openCount ?? 0,
        overdueCount: load?.overdueCount ?? 0,
        recentLabels: [],
        away: false,
      }
    })
    if (candidates.length === 0) return
    assigneeAi.mutate(
      {
        locale,
        card: {
          id: card.id,
          title: card.title,
          labels: [],
          projectTitle: null,
          estimateMin: null,
        },
        candidates,
      },
      {
        onSuccess: (res) => {
          const output = parseFeatureOutput<SuggestAssigneeOutput>('suggest_assignee', res.data)
          if (output) setAssigneeSuggestions({ output, meta: res.meta })
        },
      },
    )
  }

  async function acceptTranslate() {
    if (!canEdit || !translatePreview) return
    const text = translatePreview.output.translatedText
    editDescriptionDraft(text)
    if (!(await saveDescription(text))) return
    setTranslatePreview(null)
    translateAi.reset()
  }

  const focusMax = focusList.data?.max ?? 5
  const pinned = card.focusPinned === true
  function togglePin(): void {
    if (pinned) {
      removeFocus.mutate(card!.id, {
        onSuccess: () => toast.success(t('work.focus.unpinned')),
        onError: () => toast.error(t('work.focus.failed')),
      })
      return
    }
    if ((focusList.data?.items.length ?? 0) >= focusMax) {
      toast.error(t('work.focus.full', { max: focusMax }))
      return
    }
    addFocus.mutate(card!.id, {
      onSuccess: () => toast.success(t('work.focus.pinned')),
      onError: () => toast.error(t('work.focus.failed')),
    })
  }

  const project = projects.find((candidate) => candidate.id === card.projectId)

  return (
    <div
      data-card-detail
      className={cn('flex min-h-0 min-w-0 flex-col', presentation === 'drawer' && 'h-full')}
    >
      <header
        className={cn(
          'flex shrink-0 flex-col gap-3 border-b border-border bg-surface-3 pb-4',
          presentation === 'drawer' && 'px-4 pt-3 sm:px-5',
        )}
      >
        <div className="flex min-w-0 items-center justify-between gap-2">
          <span className="flex min-w-0 items-center gap-2 text-small font-medium text-muted-foreground">
            {project ? (
              <FolderKanban className="size-4 shrink-0 text-primary" aria-hidden="true" />
            ) : null}
            <span className="truncate" title={project?.title}>
              {project?.title ?? t('cardRefinement.cardLabel')}
            </span>
          </span>
          <div className="flex shrink-0 items-center gap-1">
            {card.status === 'active' ? (
              <IconButton
                aria-label={pinned ? t('work.focus.unpin') : t('work.focus.pin')}
                tooltip={pinned ? t('work.focus.unpin') : t('work.focus.pin')}
                aria-pressed={pinned}
                disabled={addFocus.isPending || removeFocus.isPending}
                className={pinned ? 'bg-accent text-primary' : 'text-muted-foreground'}
                onClick={() => togglePin()}
              >
                {pinned ? <PinOff aria-hidden="true" /> : <Pin aria-hidden="true" />}
              </IconButton>
            ) : null}
            <IconButton
              aria-label={isWatching ? t('work.card.watching') : t('work.card.watch')}
              tooltip={isWatching ? t('work.card.watching') : t('work.card.watch')}
              aria-pressed={isWatching}
              disabled={toggleWatcher.isPending}
              className={isWatching ? 'bg-accent text-primary' : 'text-muted-foreground'}
              onClick={() => void toggleWatcher.mutateAsync(card.id)}
            >
              {isWatching ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
            </IconButton>
            {canEdit ? (
              <Popover>
                <PopoverTrigger asChild>
                  <IconButton
                    aria-label={t('cardRefinement.actions')}
                    tooltip={t('cardRefinement.actions')}
                  >
                    <MoreHorizontal aria-hidden="true" />
                  </IconButton>
                </PopoverTrigger>
                <PopoverContent
                  align="end"
                  aria-label={t('cardRefinement.actions')}
                  className="w-64 space-y-1 p-2"
                >
                  <p className="px-2 py-1 text-caption font-medium text-muted-foreground">
                    {t('cardRefinement.actions')}
                  </p>
                  {card.status !== 'archived' ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="w-full justify-start"
                      disabled={patchCard.isPending}
                      onClick={() => void archiveNow()}
                    >
                      <Archive className="size-4" aria-hidden="true" />
                      {t('work.card.archive')}
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="w-full justify-start"
                      disabled={restoreCard.isPending}
                      onClick={() => void restoreCard.mutateAsync(card.id)}
                    >
                      <Archive className="size-4" aria-hidden="true" />
                      {t('work.card.restore')}
                    </Button>
                  )}
                  {!card.projectId ? (
                    <div className="[&>button]:w-full [&>button]:justify-start">
                      <ConvertProjectDialog cardId={card.id} />
                    </div>
                  ) : null}
                  <div className="border-t border-border pt-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      className="w-full justify-start text-destructive"
                      loading={deleteCard.isPending}
                      onClick={() => void deleteNow()}
                      title={t('work.deletion.hint')}
                    >
                      <Trash2 className="size-4" aria-hidden="true" />
                      {t('work.action.delete')}
                    </Button>
                  </div>
                </PopoverContent>
              </Popover>
            ) : null}
            {onClose ? (
              <IconButton
                aria-label={t('shell.shortcuts.close')}
                tooltip={t('shell.shortcuts.close')}
                onClick={onClose}
              >
                <X aria-hidden="true" />
              </IconButton>
            ) : null}
          </div>
        </div>
        <CardTitleField
          value={titleDraft}
          onChange={(e) => editTitleDraft(e.target.value)}
          onBlur={() => void saveTitle()}
          readOnly={!canEdit}
          aria-label={t('work.field.title')}
          aria-invalid={titleError || undefined}
          aria-describedby={titleError ? `card-title-error-${cardId}` : undefined}
          maxLength={WORK_TITLE_MAX}
          className="w-full resize-none overflow-hidden rounded-sm border border-transparent bg-transparent px-1 font-display text-h3 text-foreground outline-none hover:border-border focus-visible:border-border focus-visible:ring-2 focus-visible:ring-ring read-only:hover:border-transparent"
        />
        {titleError ? (
          <p id={`card-title-error-${cardId}`} role="alert" className="text-small text-destructive">
            {t('work.card.titleRequired')}
          </p>
        ) : null}
        <div className="flex flex-wrap items-center gap-2">
          {card.status === 'archived' ? (
            <ArchivedCardBadge card={card} />
          ) : (
            <Badge
              tone={
                card.status === 'done'
                  ? 'success'
                  : card.workStage === 'in_progress'
                    ? 'info'
                    : 'neutral'
              }
            >
              {card.status === 'done' ? (
                <Check className="size-3.5" aria-hidden="true" />
              ) : card.workStage === 'in_progress' ? (
                <CircleDot className="size-3.5" aria-hidden="true" />
              ) : (
                <Circle className="size-3.5" aria-hidden="true" />
              )}
              {t(
                card.status === 'active'
                  ? `portal.stage.${card.workStage ?? 'todo'}`
                  : `work.status.${card.status}`,
              )}
            </Badge>
          )}
          <div className="ml-auto flex flex-wrap items-center gap-2">
            {canEdit && card.status === 'active' ? (
              <>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={patchCard.isPending}
                  onClick={() =>
                    void patchCard.mutateAsync({
                      id: card.id,
                      patch: {
                        workStage: card.workStage === 'in_progress' ? 'todo' : 'in_progress',
                      },
                    })
                  }
                >
                  {t(
                    card.workStage === 'in_progress' ? 'portal.stage.reset' : 'portal.stage.start',
                  )}
                </Button>
                <span className="relative inline-flex">
                  <Button size="sm" onClick={() => void markDone()} loading={patchCard.isPending}>
                    <Check className="size-4" aria-hidden="true" />
                    {t('work.card.markDone')}
                  </Button>
                  <Celebrate play={doneCelebrate.play} onDone={doneCelebrate.onDone} />
                </span>
              </>
            ) : null}
          </div>
        </div>
        {!canEdit ? (
          <p className="text-small text-muted-foreground" role="status">
            {t('work.card.readOnly')}
          </p>
        ) : null}
      </header>
      <div
        data-card-detail-scroll
        className={cn(
          'flex min-h-0 flex-col gap-5 pt-4',
          presentation === 'drawer' &&
            'flex-1 overflow-y-auto overscroll-contain px-4 pb-6 sm:px-5',
        )}
      >
        {card.risk !== 'none' ? (
          <div className="flex items-center gap-2">
            <Badge tone={RISK_BADGE_TONE[card.risk]}>{t(RISK_LABEL_KEY[card.risk])}</Badge>
            {riskEnabled ? (
              <SparkleButton
                aria-label={t('work.ai.explainRisk')}
                size="sm"
                loading={riskAi.isPending}
                onClick={runRiskExplain}
              />
            ) : null}
          </div>
        ) : null}

        {riskAi.isPending || riskExplain || riskAi.isError ? (
          <AiResultPanel
            title={t('work.ai.explainRiskPreviewTitle')}
            status={riskAi.isPending ? 'pending' : riskAi.isError ? 'error' : 'ready'}
            errorMessage={t('work.quickAdd.aiError')}
            {...(riskExplain ? { meta: riskExplain.meta } : {})}
            // Read-only by design: this helper explains a verdict the server already reached. There is
            // nothing to accept, and an Accept button over an explanation would read as a bug.
            readOnly
            onDiscard={() => {
              setRiskExplain(null)
              riskAi.reset()
            }}
            onRetry={runRiskExplain}
          >
            {riskExplain ? <RiskExplainPreview output={riskExplain.output} /> : null}
          </AiResultPanel>
        ) : null}

        <div
          className="grid min-w-0 grid-cols-1 gap-3 rounded-md min-[360px]:grid-cols-2 border border-border bg-muted/20 p-3"
          data-card-primary-properties
        >
          <div className="min-[360px]:col-span-2">
            <Field
              label={t('work.field.assignee')}
              grouped
              action={
                canEdit && assigneeAiEnabled ? (
                  <SparkleButton
                    aria-label={t('work.ai.suggestAssignee')}
                    size="sm"
                    loading={assigneeAi.isPending}
                    onClick={runSuggestAssignee}
                  />
                ) : undefined
              }
              flashedAt={assigneeFlash.flashedAt}
              rejectedAt={assigneeFlash.rejectedAt}
            >
              <MemberPicker
                label={t('work.field.assignee')}
                disabled={!canEdit}
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
                    .catch(assigneeFlash.reject)
                }}
                placeholderKey="work.field.unassigned"
              />
              {assigneeAi.isPending || assigneeSuggestions || assigneeAi.isError ? (
                <AiResultPanel
                  className="mt-2"
                  title={t('work.ai.suggestAssigneePreviewTitle')}
                  status={assigneeAi.isPending ? 'pending' : assigneeAi.isError ? 'error' : 'ready'}
                  errorMessage={t('work.quickAdd.aiError')}
                  {...(assigneeSuggestions ? { meta: assigneeSuggestions.meta } : {})}
                  // No Accept: the head chooses a person from the list, one click per row. A single
                  // "Accept" over a ranked list of three people would mean "take the first", which is
                  // precisely the decision the guard rail says the head must make (AI-AUDIT N-3).
                  readOnly
                  onDiscard={() => {
                    setAssigneeSuggestions(null)
                    assigneeAi.reset()
                  }}
                  onRetry={runSuggestAssignee}
                >
                  {assigneeSuggestions ? (
                    <AssigneeSuggestionsPreview
                      output={assigneeSuggestions.output}
                      memberName={(id) => nameOf(members, id)}
                      onChoose={(userId) => {
                        void patchCard.mutateAsync({
                          id: card.id,
                          patch: { assigneeUserId: userId },
                        })
                        setAssigneeSuggestions(null)
                        assigneeAi.reset()
                      }}
                    />
                  ) : null}
                </AiResultPanel>
              ) : null}
            </Field>
          </div>
          <Field
            label={t('work.field.priority')}
            flashedAt={priorityFlash.flashedAt}
            rejectedAt={priorityFlash.rejectedAt}
          >
            <Select
              disabled={!canEdit}
              aria-label={t('work.field.priority')}
              value={card.priority}
              onChange={(e) =>
                void patchCard
                  .mutateAsync({
                    id: card.id,
                    patch: { priority: e.target.value as CardPriority },
                  })
                  .then(priorityFlash.flash)
                  .catch(priorityFlash.reject)
              }
              options={PRIORITIES.map((p) => ({ value: p, label: t(PRIORITY_LABEL_KEY[p]) }))}
            />
          </Field>
          <Field
            label={t('work.field.due')}
            flashedAt={dueFlash.flashedAt}
            rejectedAt={dueFlash.rejectedAt}
          >
            <DatePicker
              disabledTrigger={!canEdit}
              locale={locale}
              label={t('work.field.due')}
              placeholder={t('work.field.due')}
              selected={toDateInputValue(card.dueAt)}
              onSelect={(date) =>
                void patchCard
                  .mutateAsync({ id: card.id, patch: { dueAt: dateToIso(date) } })
                  .then(dueFlash.flash)
                  .catch(dueFlash.reject)
              }
              triggerClassName="w-full justify-start"
            />
          </Field>
        </div>
        <Field
          label={t('work.field.description')}
          grouped
          action={
            canEdit && translateEnabled && descDraft.trim() ? (
              <span className="flex min-w-0 max-w-full flex-wrap items-center gap-2">
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
            aria-label={t('work.field.description')}
            readOnly={!canEdit}
            value={descDraft}
            onChange={(e) => editDescriptionDraft(e.target.value)}
            onBlur={() => void saveDescription()}
            rows={3}
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
                if (translatePreview) editDescriptionDraft(translatePreview.output.translatedText)
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

        <Checklist card={card} canEdit={canEdit} />
        <Comments
          cardId={card.id}
          cardTitle={card.title}
          comments={card.comments}
          members={members}
        />

        <CardAttachments cardId={card.id} canEdit={canEdit} />
        <DetailDisclosure title={t('cardRefinement.details')} icon={SlidersHorizontal}>
          <div className="flex flex-col gap-4">
            <Field
              label={t('work.field.giver')}
              grouped
              flashedAt={giverFlash.flashedAt}
              rejectedAt={giverFlash.rejectedAt}
            >
              <MemberPicker
                label={t('work.field.giver')}
                disabled={!canEdit}
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
                    .catch(giverFlash.reject)
                }}
                placeholderKey="work.field.noGiver"
              />
            </Field>
            <Field
              label={t('work.field.start')}
              flashedAt={startFlash.flashedAt}
              rejectedAt={startFlash.rejectedAt}
            >
              <DatePicker
                disabledTrigger={!canEdit}
                locale={locale}
                label={t('work.field.start')}
                placeholder={t('work.field.start')}
                selected={toDateInputValue(card.startAt)}
                onSelect={(date) =>
                  void patchCard
                    .mutateAsync({ id: card.id, patch: { startAt: dateToIso(date) } })
                    .then(startFlash.flash)
                    .catch(startFlash.reject)
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
            <Field label={t('work.field.labels')} grouped>
              <div className="flex flex-wrap gap-1.5">
                {labels
                  .filter((label) => canEdit || card.labels.includes(label.id))
                  .map((label) => {
                    const active = card.labels.includes(label.id)
                    // A pastel label colour with hardcoded white text was illegible the moment
                    // someone picked a light hue ("Hisobot"/"Tashqi" in the item handoff) --
                    // labelChipColors derives a background/foreground pair from that one colour,
                    // guaranteed >= 4.5:1 contrast, so any colour a member picks stays readable in
                    // both themes.
                    const { background, foreground } = labelChipColors(label.colour, isDark)
                    if (!canEdit) {
                      return (
                        <Chip
                          key={label.id}
                          style={{ backgroundColor: background, color: foreground }}
                        >
                          {label.name}
                        </Chip>
                      )
                    }
                    return (
                      <button
                        key={label.id}
                        type="button"
                        onClick={() => toggleLabel(label.id)}
                        disabled={patchCard.isPending}
                        className="inline-flex min-h-6 items-center gap-1.5 rounded-sm px-2 py-1 text-caption font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 max-md:min-h-11"
                        style={{
                          backgroundColor: background,
                          color: foreground,
                        }}
                        aria-pressed={active}
                      >
                        {active ? (
                          <Check aria-hidden="true" className="size-3 shrink-0" />
                        ) : (
                          <Plus aria-hidden="true" className="size-3 shrink-0" />
                        )}
                        {label.name}
                      </button>
                    )
                  })}
                {canEdit ? (
                  <form
                    className="flex w-full items-center gap-2"
                    onSubmit={(event) => {
                      event.preventDefault()
                      if (!newLabelName.trim() || createLabel.isPending) return
                      createLabel.mutate(
                        { name: newLabelName.trim() },
                        {
                          onSuccess: () => setNewLabelName(''),
                          onError: () => toast.error(t('toast.saveError')),
                        },
                      )
                    }}
                  >
                    <Input
                      value={newLabelName}
                      onChange={(e) => setNewLabelName(e.target.value)}
                      placeholder={t('work.card.newLabel')}
                      aria-label={t('work.card.newLabel')}
                      maxLength={60}
                      disabled={createLabel.isPending}
                      className="h-11 min-w-0 flex-1 px-2 text-caption md:h-7"
                    />
                    <IconButton
                      type="submit"
                      aria-label={t('work.card.newLabel')}
                      tooltip={t('work.card.newLabel')}
                      aria-busy={createLabel.isPending || undefined}
                      disabled={!newLabelName.trim() || createLabel.isPending}
                    >
                      <Plus aria-hidden="true" className="size-4" />
                    </IconButton>
                  </form>
                ) : null}
              </div>
            </Field>

            <CardCustomFields
              cardId={card.id}
              ownerUserIds={[card.giverUserId, card.assigneeUserId, card.createdByUserId].filter(
                (id): id is string => Boolean(id),
              )}
            />
          </div>
        </DetailDisclosure>
        <DetailDisclosure
          title={`${t('work.field.links')} (${card.links.length})`}
          icon={Link2}
          defaultOpen={card.links.length > 0}
        >
          <Field label={t('work.field.links')}>
            <div className="flex flex-col gap-2">
              {card.links.map((link) => (
                <div
                  key={link.url}
                  className="flex items-center gap-2 rounded-sm border border-border p-2"
                >
                  <Link2 className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                  <CardLinkLabel url={link.url} title={link.title} />
                  {canEdit ? (
                    <IconButton
                      aria-label={t('work.card.removeLink', { title: link.title })}
                      disabled={linkPending || patchCard.isPending}
                      onClick={() => void removeLink(link.url)}
                    >
                      <X className="size-3.5" />
                    </IconButton>
                  ) : null}
                </div>
              ))}
              {canEdit ? (
                <div className="flex gap-2">
                  <Input
                    value={linkInput}
                    aria-label={t('work.card.addLinkPlaceholder')}
                    disabled={linkPending || patchCard.isPending}
                    onChange={(e) => setLinkInput(e.target.value)}
                    placeholder={t('work.card.addLinkPlaceholder')}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void addLink()
                    }}
                  />
                  <Button
                    size="sm"
                    variant="secondary"
                    aria-label={t('work.card.addLink')}
                    disabled={!linkInput.trim() || linkPending || patchCard.isPending}
                    onClick={() => void addLink()}
                    loading={linkPending}
                  >
                    <Plus className="size-4" />
                  </Button>
                </div>
              ) : null}
            </div>
          </Field>
        </DetailDisclosure>
        {/* v1.1 SPEC §7 -- estimate + time log, dependencies, repeat, reminders. */}
        <CardPlusSections
          card={card}
          canEdit={canEdit}
          members={members}
          onOpenCard={(id) => replaceSearchParam('card', id)}
          onEstimateChange={(estimateMin) =>
            void patchCard.mutateAsync({ id: card.id, patch: { estimateMin } })
          }
          onRecurrenceChange={(recurrence) =>
            patchCard
              .mutateAsync({ id: card.id, patch: { recurrence } })
              .then(() => {
                toast.success(
                  recurrence ? t('work.recurrence.saved') : t('work.recurrence.stopped'),
                )
              })
              .catch((error: unknown) => {
                toast.error(t('work.recurrence.saveFailed'))
                throw error
              })
          }
        />

        {card.activity.length > 0 ? (
          <div className="border-t border-border pt-3">
            <button
              type="button"
              onClick={() => setActivityOpen((v) => !v)}
              aria-expanded={activityOpen}
              aria-controls="card-activity-panel"
              className="flex min-h-11 items-center gap-1.5 text-caption font-medium uppercase md:min-h-9 tracking-(--text-eyebrow--letter-spacing) text-muted-foreground hover:text-foreground"
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
    </div>
  )
}

function DetailDisclosure({
  title,
  icon: Icon,
  defaultOpen = false,
  children,
}: {
  title: string
  icon: React.ComponentType<React.SVGProps<SVGSVGElement>>
  defaultOpen?: boolean
  children: React.ReactNode
}) {
  const [open, setOpen] = React.useState(defaultOpen)
  const id = React.useId()
  return (
    <section className="border-t border-border pt-2">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((value) => !value)}
        className="flex min-h-11 w-full items-center gap-2 rounded-sm text-small font-medium text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:min-h-9"
      >
        <Icon className="size-4" aria-hidden="true" />
        <span>{title}</span>
        <ChevronDown
          className={cn(
            'ml-auto size-4 transition-transform duration-(--dur-micro) motion-reduce:transition-none',
            open && 'rotate-180',
          )}
          aria-hidden="true"
        />
      </button>
      <Collapsible open={open} id={id}>
        <div className="pt-2">{children}</div>
      </Collapsible>
    </section>
  )
}

/** Bumps to a fresh (truthy) value every time the field it's attached to should flash -- `Field`
 * below only cares that the value *changed*, not what it is, so `Date.now()` is a fine "this just
 * happened again" token even for two flashes in the same millisecond-resolution tick being merged
 * (a flash replaying because a second edit landed within the animation's own 700ms is still exactly
 * the "this saved" acknowledgement UI-OVERHAUL.md asks for). */
function useFieldFlash(): {
  flashedAt: number
  flash: () => void
  rejectedAt: number
  reject: () => void
} {
  const [flashedAt, setFlashedAt] = React.useState(0)
  const [rejectedAt, setRejectedAt] = React.useState(0)
  return {
    flashedAt,
    flash: React.useCallback(() => setFlashedAt(Date.now()), []),
    // The other half of the optimistic contract (DESIGN.md §10): the flash says "taken", this says
    // "put back". `usePatchCardMutation` already rolls the value back on failure -- what it had no
    // way to do was *say so* on the one property that moved, so a refused edit silently reverted and
    // read as the app eating the click. Attaching it also means every one of these `mutateAsync`
    // chains now has a `catch`, which none of them did.
    rejectedAt,
    reject: React.useCallback(() => setRejectedAt(Date.now()), []),
  }
}

function Field({
  label,
  grouped = false,
  action,
  children,
  flashedAt,
  rejectedAt,
}: {
  label: string
  grouped?: boolean
  action?: React.ReactNode
  children: React.ReactNode
  /** round2 SEV2 "property edits commit with no feedback": a token from `useFieldFlash`. Each new
   * token plays one soft success-tinted wash over the control, opacity only. Reduced motion keeps
   * the wash (a colour fade is not travel) and simply holds it longer -- see `<FlashOnChange>`. */
  flashedAt?: number
  /** The same token shape for the failing half: each new value shakes the control once, the
   * product's one refusal gesture. Reduced motion replaces it with a destructive ring. */
  rejectedAt?: number
}) {
  const [shake, setShake] = React.useState(false)
  React.useEffect(() => {
    if (!rejectedAt) return undefined
    setShake(false)
    const raf = requestAnimationFrame(() => setShake(true))
    return () => cancelAnimationFrame(raf)
  }, [rejectedAt])

  const Container = grouped ? 'section' : 'label'
  return (
    <Container
      className="flex min-w-0 flex-col gap-1.5 text-small"
      {...(grouped ? { 'aria-label': label } : {})}
    >
      <span className="flex min-w-0 flex-wrap items-center gap-2">
        <span className="text-caption font-medium uppercase tracking-(--text-eyebrow--letter-spacing) text-muted-foreground">
          {label}
        </span>
        {action ? <span className="ml-auto min-w-0 max-w-full">{action}</span> : null}
      </span>
      {/* v1.1 motion pass: this was a bespoke `AnimatePresence` sweep written here, and the same
          gesture is now `<FlashOnChange>` in `packages/ui/src/motion` -- one implementation, one
          reduced-motion contract, used by every optimistic edit in the product rather than by this
          one panel. The flash sits around the *control* rather than the whole label, so the eye
          lands on the value that changed and not on the word for it. */}
      <Shake play={shake} onDone={() => setShake(false)}>
        <FlashOnChange value={flashedAt ?? 0} tone="saved" className="flex flex-col">
          {children}
        </FlashOnChange>
      </Shake>
    </Container>
  )
}

function Checklist({
  card,
  canEdit,
}: {
  canEdit: boolean
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
        cardId: card.id,
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

  function renderItem(item: (typeof card.checklist)[number]): React.ReactNode {
    return (
      <div key={item.id} className="flex flex-col gap-1">
        <ChecklistRow
          item={item}
          canEdit={canEdit}
          onSave={(text) => patchItem.mutateAsync({ itemId: item.id, patch: { text } })}
          onToggle={(done) => patchItem.mutate({ itemId: item.id, patch: { done } })}
          onDelete={() => deleteItem.mutate(item.id)}
        />
        {childrenOf(item.id).length ? (
          <div className="pl-4">{childrenOf(item.id).map(renderItem)}</div>
        ) : null}
      </div>
    )
  }
  return (
    <Field
      grouped
      label={`${t('work.field.checklist')} (${done}/${card.checklist.length})`}
      action={
        subtasksEnabled && canEdit ? (
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
        {topLevel.map(renderItem)}
        {canEdit ? (
          <form
            className="flex gap-2 pt-1"
            onSubmit={(e) => {
              e.preventDefault()
              if (!text.trim() || addItem.isPending) return
              addItem.mutate(
                { text: text.trim() },
                {
                  onSuccess: () => setText(''),
                  onError: () => toast.error(t('toast.saveError')),
                },
              )
            }}
          >
            <Input
              aria-label={t('work.card.addChecklistItem')}
              disabled={addItem.isPending}
              maxLength={500}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={t('work.card.addChecklistItem')}
            />
            <Button
              type="submit"
              size="sm"
              disabled={!text.trim() || addItem.isPending}
              aria-label={t('work.card.addChecklistItem')}
            >
              <Plus className="size-4" aria-hidden="true" />
              {t('work.action.save')}
            </Button>
          </form>
        ) : null}

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

function Comments({
  cardId,
  cardTitle,
  comments,
  members,
}: {
  cardId: string
  cardTitle: string
  comments: Array<{
    id: string
    authorUserId: string
    body: { text: string }
    createdAt: string
    editedAt: string | null
  }>
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
  const editComment = useEditCommentMutation(cardId)
  const deleteComment = useDeleteCommentMutation(cardId)
  const [editing, setEditing] = React.useState<string | null>(null)
  const [editedText, setEditedText] = React.useState('')
  const [editedRevision, setEditedRevision] = React.useState<string | null>(null)
  const [deleting, setDeleting] = React.useState<string | null>(null)
  function mentionedUsers(value: string) {
    return [
      ...new Set(
        [...value.matchAll(/@([\p{L}]+)/gu)]
          .map((match) => resolveQuickAddAssignee(match[1]!, members)?.userId)
          .filter((id): id is string => Boolean(id)),
      ),
    ]
  }

  // v1.1 EPIC-018: tell colleagues a comment is being written, while it is being written.
  //
  // The trigger is "there is unsent text", not "a key was pressed": a person who typed three words
  // and then went to read the card is still writing a comment, and a signal that expired while they
  // were thinking would flicker. `useSignalWhile` throttles to one call every four seconds and
  // sends the "stopped" signal the moment the box empties or the panel closes -- so posting the
  // comment clears the indicator, because `submit()` empties `text`.
  useSignalWhile('comment_typing', cardId, text.trim().length > 0)
  const signals = useCardSignals(cardId)
  const typists = signals.filter((s) => s.kind === 'comment_typing')

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
      grouped
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
                  src={avatarUrl(author?.avatarKey, 64)}
                  alt={author ? fullName(author) : ''}
                  initials={author ? initialsFromName(author.givenName, author.familyName) : '?'}
                  hueSeed={c.authorUserId}
                />
                <div className="min-w-0 flex-1 rounded-md bg-muted/55 p-3">
                  <div className="mb-1 flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="text-small font-medium text-foreground">
                      {author ? fullName(author) : ''}
                    </span>
                    <span className="ml-auto shrink-0 text-caption text-muted-foreground">
                      {formatDate(new Date(c.createdAt), locale)}
                    </span>
                    {c.editedAt ? (
                      <span className="text-caption text-muted-foreground">
                        {t('work.comments.edited')}
                      </span>
                    ) : null}
                    {(c.authorUserId === user?.id || viewerRole === 'head') &&
                    editing !== c.id &&
                    deleting !== c.id ? (
                      <div className="flex shrink-0 items-center gap-1">
                        <IconButton
                          className="md:size-7"
                          aria-label={t('work.comments.edit')}
                          tooltip={t('work.comments.edit')}
                          onClick={() => {
                            setEditing(c.id)
                            setEditedText(c.body.text)
                            setEditedRevision(c.editedAt)
                          }}
                        >
                          <Pencil className="size-3.5" aria-hidden="true" />
                        </IconButton>
                        <IconButton
                          className="text-muted-foreground hover:text-destructive md:size-7"
                          aria-label={t('work.action.delete')}
                          tooltip={t('work.action.delete')}
                          onClick={() => setDeleting(c.id)}
                        >
                          <Trash2 className="size-3.5" aria-hidden="true" />
                        </IconButton>
                      </div>
                    ) : null}
                  </div>
                  {editing === c.id ? (
                    <form
                      className="mt-2 flex flex-col gap-2"
                      onSubmit={(event) => {
                        event.preventDefault()
                        void editComment
                          .mutateAsync({
                            id: c.id,
                            text: editedText.trim(),
                            mentions: mentionedUsers(editedText),
                            editedAt: editedRevision,
                          })
                          .then(() => setEditing(null))
                          .catch(() => toast.error(t('work.comments.saveError')))
                      }}
                    >
                      <textarea
                        aria-label={t('work.comments.edit')}
                        value={editedText}
                        maxLength={10000}
                        onChange={(event) => setEditedText(event.target.value)}
                        rows={3}
                        className="w-full rounded-sm border border-border bg-card p-2 text-small"
                      />
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          type="submit"
                          disabled={!editedText.trim()}
                          loading={editComment.isPending}
                        >
                          {t('common.save')}
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          disabled={editComment.isPending}
                          onClick={() => setEditing(null)}
                        >
                          {t('common.cancel')}
                        </Button>
                      </div>
                    </form>
                  ) : (
                    <p className="whitespace-pre-wrap wrap-anywhere text-small text-foreground">
                      {c.body.text}
                    </p>
                  )}
                  {deleting === c.id ? (
                    <div className="mt-2 rounded-sm border border-border p-2">
                      <p className="text-small">{t('work.comments.deleteConfirm')}</p>
                      <div className="mt-2 flex gap-2">
                        <Button
                          size="sm"
                          variant="destructive"
                          loading={deleteComment.isPending}
                          onClick={() =>
                            void deleteComment
                              .mutateAsync(c.id)
                              .then(() => setDeleting(null))
                              .catch(() => toast.error(t('work.comments.saveError')))
                          }
                        >
                          {t('work.action.delete')}
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setDeleting(null)}>
                          {t('common.cancel')}
                        </Button>
                      </div>
                    </div>
                  ) : null}
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

        {typists.length > 0 ? (
          <p
            aria-live="polite"
            className="flex items-center gap-1.5 text-caption text-primary motion-safe:animate-[devon-fade-in_220ms_var(--ease-out)]"
          >
            <span
              aria-hidden="true"
              className="size-1.5 shrink-0 rounded-full bg-primary motion-safe:animate-pulse"
            />
            {typists.length > 1
              ? t('realtime.signal.typingMany', { count: typists.length })
              : typists[0]!.name
                ? t('realtime.signal.typingBy', { name: typists[0]!.name })
                : t('realtime.signal.typing')}
          </p>
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

/** Keep the complete title readable when text wraps, after both edits and viewport changes. */
function CardTitleField({ value, ...props }: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const ref = React.useRef<HTMLTextAreaElement>(null)
  const metricsRef = React.useRef<HTMLSpanElement>(null)
  const fit = React.useCallback(() => {
    const element = ref.current
    if (!element) return
    element.style.height = 'auto'
    const border = element.offsetHeight - element.clientHeight
    element.style.height = `${element.scrollHeight + border}px`
  }, [])
  React.useLayoutEffect(fit, [value, fit])
  React.useEffect(() => {
    const element = ref.current
    if (!element) return
    let width: number | undefined
    let frame: number | undefined
    const scheduleFit = () => {
      if (frame !== undefined) cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        frame = undefined
        fit()
      })
    }
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        // The independent glyph responds to text-only font enlargement even when the field's
        // inline width stays unchanged. Its intrinsic size cannot depend on textarea height.
        if (entry.target === metricsRef.current) {
          scheduleFit()
        } else {
          const nextWidth = entry.borderBoxSize[0]?.inlineSize ?? entry.contentRect.width
          // Changing the textarea height must never trigger another fit of that same block size.
          if (nextWidth === width) continue
          width = nextWidth
          scheduleFit()
        }
      }
    })
    observer.observe(element)
    if (metricsRef.current) observer.observe(metricsRef.current)
    document.fonts.addEventListener('loadingdone', scheduleFit)
    return () => {
      observer.disconnect()
      if (frame !== undefined) cancelAnimationFrame(frame)
      document.fonts.removeEventListener('loadingdone', scheduleFit)
    }
  }, [fit])
  return (
    <>
      <textarea {...props} ref={ref} rows={1} value={value} />
      <span
        ref={metricsRef}
        aria-hidden="true"
        className={props.className}
        style={{
          ...props.style,
          position: 'fixed',
          left: 0,
          top: 0,
          width: 'max-content',
          height: 'auto',
          padding: 0,
          border: 0,
          whiteSpace: 'pre',
          visibility: 'hidden',
          pointerEvents: 'none',
        }}
      >
        M
      </span>
    </>
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
