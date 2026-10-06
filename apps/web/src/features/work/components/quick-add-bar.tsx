// The quick-add bar (TECH-SPEC §5/§4): `"Nodira: EGDI paketi, juma"` -> one Enter keypress creates a
// card assigned to Nodira, due next Friday. Pure local parsing lives in `lib/quick-add.ts`; this
// component adds the AI-backed alternative (TECH-SPEC §8 `quick_add_parse`) behind a sparkle button
// next to the input -- a free-typed sentence in any of the four locales goes to the gateway, comes
// back as structured fields, and is shown in an `AiResultPanel` the person accepts, edits (by
// changing the text and re-running) or discards before anything is created (UI-OVERHAUL.md "AI
// helpers": "preview panel with Accept/Edit/Discard; never auto-applies"). The same component, in
// `compact` form with a `defaultAssigneeUserId`, is the board's inline "+ Add card" at a column's
// foot.
import * as React from 'react'
import { CalendarClock, FileStack, Plus, UserRound } from 'lucide-react'
import { useT, useLocale, formatDate } from '@devon/i18n'
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  IconButton,
  Input,
  SparkleButton,
  toast,
} from '@devon/ui'
import { replaceSearchParam } from '../../../lib/router.js'
import { useAiSettingsQuery, useRunAiFeatureMutation } from '../../ai/use-ai.js'
import { AiResultPanel } from '../../ai/components/ai-result-panel.js'
import { DuplicatePreview, QuickAddPreview } from '../../ai/components/previews.js'
import {
  parseFeatureOutput,
  type DuplicateCheckOutput,
  type QuickAddOutput,
} from '../../ai/outputs.js'
import type { RunMeta } from '../../ai/types.js'
import { useBoardQuery, useCreateCardMutation, useLabelsQuery } from '../hooks.js'
import { useCreateCardFromTemplateMutation, useWorkTemplatesQuery } from '../hooks-plus.js'
import { parseQuickAdd, resolveQuickAddAssignee } from '../lib/quick-add.js'
import type { MemberSummary } from '../api.js'
import { fullName } from '../lib/format.js'

function isoDateToUtcMidnight(isoDate: string): string {
  return new Date(`${isoDate}T00:00:00.000Z`).toISOString()
}

/**
 * AI-AUDIT §0.3, the headline defect: `quick_add_parse`'s system prompt orders the model to
 * "resolve relative dates against today's date" and v1.0 never gave it one. Every "ertaga",
 * "juma" and "завтра" was therefore either hallucinated or dropped. This is that date, in
 * Asia/Tashkent -- the department's own clock, not the browser's, so a person travelling does not
 * silently get yesterday's Friday.
 */
function todayInTashkent(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tashkent',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
}

export interface QuickAddBarProps {
  members: readonly MemberSummary[]
  /** The board's per-column footer row pre-assigns to that column's member when neither the typed
   * grammar nor the AI parse named anyone -- a title alone, typed at the foot of Nodira's column,
   * should still land on Nodira (TECH-SPEC "inline + Add card at the column foot"). */
  defaultAssigneeUserId?: string | null
  /** The board's per-column footer: a smaller, icon-only trigger with a shorter placeholder, instead
   * of the top quick-add bar's full grammar hint. */
  compact?: boolean
  onCreated?: () => void
}

export function QuickAddBar({
  members,
  defaultAssigneeUserId = null,
  compact = false,
  onCreated,
}: QuickAddBarProps) {
  const t = useT()
  const locale = useLocale()
  const [value, setValue] = React.useState('')
  const [aiResult, setAiResult] = React.useState<QuickAddOutput | null>(null)
  const [aiMeta, setAiMeta] = React.useState<RunMeta | null>(null)
  // N-5: the duplicate check runs *after* a successful parse, on the parsed title -- never on every
  // keystroke. One extra call, only when the person is about to create something, which is the only
  // moment the answer can still change what they do.
  const [duplicates, setDuplicates] = React.useState<DuplicateCheckOutput | null>(null)
  // v1.1 SPEC §7.2: "create from template in quick-add". The gallery is the place to *manage*
  // templates; this is the place to *use* one, which is where somebody actually is when the thought
  // "we do this every month" occurs.
  const cardTemplates = useWorkTemplatesQuery('card').data ?? []
  const createFromTemplate = useCreateCardFromTemplateMutation()
  const createCard = useCreateCardMutation()
  const aiSettings = useAiSettingsQuery()
  const parseAi = useRunAiFeatureMutation('quick_add_parse')
  const duplicateAi = useRunAiFeatureMutation('duplicate_check')
  // Labels and projects come from the board the bar already sits on, so the model can return real
  // ids instead of free-text names the Accept path would have to guess at (AI-AUDIT §0.2: v1.0 hard
  // -coded `labels: []` and threw the model's answer away).
  const labelsQuery = useLabelsQuery()
  const boardQuery = useBoardQuery()

  const parsed = value.trim().length > 0 ? parseQuickAdd(value) : null
  const resolvedAssignee =
    parsed?.assigneeToken != null ? resolveQuickAddAssignee(parsed.assigneeToken, members) : null

  const aiEnabled =
    aiSettings.data !== undefined &&
    aiSettings.data.flags['quick_add_parse'] === true &&
    aiSettings.data.budgetStatus !== 'hard_stop'
  const duplicateEnabled = aiSettings.data?.flags['duplicate_check'] === true

  // Its own `useMemo` rather than a bare `?? []`: a fresh array literal on every render would make
  // `labelById` below rebuild every render too, which is exactly what the exhaustive-deps rule is
  // pointing at.
  const labels = React.useMemo(() => labelsQuery.data ?? [], [labelsQuery.data])
  const memberById = React.useMemo(
    () => new Map(members.map((m) => [m.userId, m] as const)),
    [members],
  )
  const labelById = React.useMemo(() => new Map(labels.map((l) => [l.id, l] as const)), [labels])

  async function submit() {
    if (!parsed || parsed.title.trim().length === 0) return
    // A colon can be ordinary punctuation. Never discard an unresolved prefix as a person's name.
    const title = parsed.assigneeToken && !resolvedAssignee ? value.trim() : parsed.title
    try {
      await createCard.mutateAsync({
        title,
        assigneeUserId: resolvedAssignee?.userId ?? defaultAssigneeUserId,
        dueAt: parsed.dueAt ? parsed.dueAt.toISOString() : null,
      })
      setValue('')
      setAiResult(null)
      onCreated?.()
      toast(t('work.quickAdd.created', { title }))
    } catch {
      toast(t('work.quickAdd.error'))
    }
  }

  function runAiParse() {
    if (!value.trim()) return
    setAiResult(null)
    setDuplicates(null)
    parseAi.mutate(
      {
        locale,
        text: value.trim(),
        // The four inputs v1.0 never supplied, which is why the feature "felt random":
        today: todayInTashkent(),
        // The full member ref the feature asks for: `givenName` on its own is what makes
        // "Nodiraga" resolvable, since Uzbek declines the given name and not the full name.
        members: members.map((m) => ({
          userId: m.userId,
          fullName: fullName(m),
          givenName: m.givenName,
          handle: null,
        })),
        labels: labels.map((l) => ({ id: l.id, name: l.name })),
        projects: [],
        defaultAssigneeUserId,
      },
      {
        onSuccess: (res) => {
          const output = parseFeatureOutput<QuickAddOutput>('quick_add_parse', res.data)
          if (!output) return
          setAiResult(output)
          setAiMeta(res.meta)
          if (duplicateEnabled) runDuplicateCheck(output.title)
        },
      },
    )
  }

  function runDuplicateCheck(title: string) {
    const existing = (boardQuery.data?.columns ?? [])
      .flatMap((column) => column.cards)
      .concat(boardQuery.data?.unassigned ?? [])
      .slice(0, 200)
      .map((card) => ({
        id: card.id,
        title: card.title,
        status: card.status === 'done' ? ('done' as const) : ('active' as const),
        assigneeName: card.assigneeUserId
          ? (memberById.get(card.assigneeUserId)?.givenName ?? null)
          : null,
        similarity: 0,
      }))
      // A prefilter, in the client, over the board this bar already has: the model is a
      // *confirmation* call over a shortlist, never a search (AI-AUDIT §4, N-5).
      .filter((card) => sharesAWord(card.title, title))
      .slice(0, 10)
    if (existing.length === 0) return
    duplicateAi.mutate(
      { locale, candidateTitle: title, candidateDescription: null, existing },
      {
        onSuccess: (res) => {
          const output = parseFeatureOutput<DuplicateCheckOutput>('duplicate_check', res.data)
          setDuplicates(output)
        },
      },
    )
  }

  async function acceptAi() {
    if (!aiResult) return
    try {
      await createCard.mutateAsync({
        title: aiResult.title,
        assigneeUserId: aiResult.assigneeUserId ?? defaultAssigneeUserId,
        dueAt: aiResult.dueDate ? isoDateToUtcMidnight(aiResult.dueDate) : null,
        priority: aiResult.priority,
        // AI-AUDIT §5 fix 3: v1.0 rendered the labels in the preview and then wrote `labels: []`.
        // Everything the person saw is now what gets created. Ids the model invented were already
        // dropped server-side by the feature's own `validateOutput`; this filter is the second
        // belt, against a label deleted between the parse and the Accept.
        labels: aiResult.labelIds.filter((id) => labelById.has(id)),
        ...(aiResult.projectId ? { projectId: aiResult.projectId } : {}),
      })
      setValue('')
      setAiResult(null)
      setDuplicates(null)
      parseAi.reset()
      onCreated?.()
      toast(t('work.quickAdd.created', { title: aiResult.title }))
    } catch {
      toast(t('work.quickAdd.error'))
    }
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2">
        {compact ? null : (
          <Plus className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        )}
        <Input
          value={value}
          onChange={(e) => {
            setValue(e.target.value)
            setAiResult(null)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              void submit()
            }
          }}
          placeholder={compact ? t('work.board.addCard') : t('work.quickAdd.placeholder')}
          aria-label={compact ? t('work.board.addCard') : t('work.quickAdd.placeholder')}
          disabled={createCard.isPending}
          className={compact ? 'h-9 text-small' : undefined}
        />
        {!compact ? (
          <Button
            size="sm"
            onClick={() => void submit()}
            loading={createCard.isPending}
            disabled={!value.trim()}
          >
            {t('work.actions.create')}
          </Button>
        ) : null}
        {cardTemplates.length > 0 ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <IconButton
                aria-label={t('work.quickAdd.fromTemplate')}
                title={t('work.quickAdd.fromTemplate')}
                disabled={createFromTemplate.isPending || createCard.isPending}
              >
                <FileStack className="size-4" aria-hidden="true" />
              </IconButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="max-h-72 w-64 overflow-y-auto">
              <DropdownMenuLabel>{t('work.quickAdd.fromTemplate')}</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {cardTemplates.map((template) => (
                <DropdownMenuItem
                  key={template.id}
                  onSelect={() =>
                    createFromTemplate.mutate(
                      {
                        id: template.id,
                        input: defaultAssigneeUserId
                          ? { assigneeUserId: defaultAssigneeUserId }
                          : {},
                      },
                      {
                        onSuccess: (created) => {
                          toast.success(t('work.templates.created', { name: template.name }))
                          onCreated?.()
                          // Opening the new card is the point: a card made from a template almost
                          // always needs one field adjusted before it is real.
                          replaceSearchParam('card', created.id)
                        },
                        onError: () => toast.error(t('work.templates.createFailed')),
                      },
                    )
                  }
                >
                  {template.name}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
        {aiEnabled ? (
          <SparkleButton
            aria-label={t('work.quickAdd.aiParse')}
            size={compact ? 'sm' : 'md'}
            loading={parseAi.isPending}
            disabled={!value.trim() || createCard.isPending}
            onClick={runAiParse}
          />
        ) : null}
      </div>

      {!aiResult && !parseAi.isPending && parsed && (parsed.assigneeToken || parsed.dueAt) ? (
        <div className="flex flex-wrap items-center gap-3 pl-6 text-caption text-muted-foreground">
          {parsed.assigneeToken ? (
            <span className="flex items-center gap-1">
              <UserRound className="size-3.5" aria-hidden="true" />
              {resolvedAssignee
                ? fullName(resolvedAssignee)
                : t('work.quickAdd.unknownAssignee', { name: parsed.assigneeToken })}
            </span>
          ) : null}
          {parsed.dueAt ? (
            <span className="flex items-center gap-1">
              <CalendarClock className="size-3.5" aria-hidden="true" />
              {formatDate(parsed.dueAt, locale)}
            </span>
          ) : null}
        </div>
      ) : null}

      {parseAi.isPending || aiResult || parseAi.isError ? (
        <AiResultPanel
          title={t('work.quickAdd.aiPreviewTitle')}
          status={parseAi.isPending ? 'pending' : parseAi.isError ? 'error' : 'ready'}
          meta={aiMeta ?? undefined}
          errorMessage={t('work.quickAdd.aiError')}
          acceptLabel={t('work.ai.accept')}
          editLabel={t('work.ai.edit')}
          onAccept={() => void acceptAi()}
          // Edit puts the person back in the input with the model's title, which is the thing they
          // most often want to adjust before creating. v1.0's Edit simply discarded the answer,
          // making it indistinguishable from Discard (AI-AUDIT §5 fix 11, the same defect).
          onEdit={() => {
            if (aiResult) setValue(aiResult.title)
            setAiResult(null)
            setDuplicates(null)
            parseAi.reset()
          }}
          onDiscard={() => {
            setAiResult(null)
            setDuplicates(null)
            parseAi.reset()
          }}
          onRetry={runAiParse}
        >
          {aiResult ? (
            <div className="flex flex-col gap-3">
              <QuickAddPreview
                output={aiResult}
                memberName={(id) => {
                  const member = memberById.get(id)
                  return member ? fullName(member) : null
                }}
                labelName={(id) => labelById.get(id)?.name ?? null}
                projectName={() => null}
              />
              {duplicates && duplicates.matches.length > 0 ? (
                <section className="flex flex-col gap-1 rounded-sm border border-warning/40 bg-warning/10 px-3 py-2">
                  <h4 className="text-caption font-medium uppercase tracking-wide text-muted-foreground">
                    {t('work.quickAdd.duplicateTitle')}
                  </h4>
                  <DuplicatePreview
                    output={duplicates}
                    cardTitle={(id) =>
                      (boardQuery.data?.columns ?? [])
                        .flatMap((column) => column.cards)
                        .concat(boardQuery.data?.unassigned ?? [])
                        .find((card) => card.id === id)?.title ?? null
                    }
                  />
                </section>
              ) : null}
            </div>
          ) : null}
        </AiResultPanel>
      ) : null}
    </div>
  )
}

/**
 * The duplicate prefilter's whole rule: two titles are worth a confirmation call when they share a
 * word of four letters or more. Deliberately crude and deliberately local -- it exists to keep the
 * model's input to ten candidates, not to decide anything. The real judgement is the model's, and
 * the real authority is the person looking at the two titles side by side.
 *
 * Four letters because three-letter words in all four of this product's locales are almost entirely
 * function words ("va", "bu", "для", "the"), and matching on those would shortlist the whole board.
 */
function sharesAWord(a: string, b: string): boolean {
  const words = (text: string) =>
    new Set(
      text
        .toLowerCase()
        .split(/[^\p{L}\p{N}]+/u)
        .filter((word) => word.length >= 4),
    )
  const left = words(a)
  for (const word of words(b)) if (left.has(word)) return true
  return false
}
