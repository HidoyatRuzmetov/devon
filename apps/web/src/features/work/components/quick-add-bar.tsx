// The quick-add bar (TECH-SPEC §5/§4): `"Nodira: EGDI paketi, juma"` -> one Enter keypress creates a
// card assigned to Nodira, due next Friday. Pure local parsing lives in `lib/quick-add.ts`; this
// component adds the AI-backed alternative (TECH-SPEC §8 `quick_add_parse`) behind a sparkle button
// next to the input -- a free-typed sentence in any of the four locales goes to the gateway, comes
// back as structured fields, and is shown in an `AiPreviewPanel` the person accepts, edits (by
// changing the text and re-running) or discards before anything is created (UI-OVERHAUL.md "AI
// helpers": "preview panel with Accept/Edit/Discard; never auto-applies"). The same component, in
// `compact` form with a `defaultAssigneeUserId`, is the board's inline "+ Add card" at a column's
// foot.
import * as React from 'react'
import { CalendarClock, FileStack, Plus, UserRound } from 'lucide-react'
import { useT, useLocale, formatDate } from '@devon/i18n'
import {
  AiPreviewPanel,
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
import { useCreateCardMutation } from '../hooks.js'
import { useCreateCardFromTemplateMutation, useWorkTemplatesQuery } from '../hooks-plus.js'
import { parseQuickAdd, resolveQuickAddAssignee } from '../lib/quick-add.js'
import type { CardPriority, MemberSummary } from '../api.js'
import { PRIORITY_LABEL_KEY, fullName } from '../lib/format.js'

type AiQuickAddResult = {
  title: string
  assigneeName: string | null
  dueDate: string | null
  priority: CardPriority
  labels: string[]
}

function isAiQuickAddResult(data: Record<string, unknown>): data is AiQuickAddResult {
  return typeof data['title'] === 'string'
}

function isoDateToUtcMidnight(isoDate: string): string {
  return new Date(`${isoDate}T00:00:00.000Z`).toISOString()
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
  const [aiResult, setAiResult] = React.useState<AiQuickAddResult | null>(null)
  const [aiMeta, setAiMeta] = React.useState<{ totalTokens: number; latencyMs: number } | null>(
    null,
  )
  // v1.1 SPEC §7.2: "create from template in quick-add". The gallery is the place to *manage*
  // templates; this is the place to *use* one, which is where somebody actually is when the thought
  // "we do this every month" occurs.
  const cardTemplates = useWorkTemplatesQuery('card').data ?? []
  const createFromTemplate = useCreateCardFromTemplateMutation()
  const createCard = useCreateCardMutation()
  const aiSettings = useAiSettingsQuery()
  const parseAi = useRunAiFeatureMutation('quick_add_parse')

  const parsed = value.trim().length > 0 ? parseQuickAdd(value) : null
  const resolvedAssignee =
    parsed?.assigneeToken != null ? resolveQuickAddAssignee(parsed.assigneeToken, members) : null

  const aiEnabled =
    aiSettings.data !== undefined &&
    aiSettings.data.flags['quick_add_parse'] === true &&
    aiSettings.data.budgetStatus !== 'hard_stop'

  function resolveAiAssignee(name: string | null): MemberSummary | null {
    if (!name) return null
    const needle = name.trim().toLowerCase()
    return (
      members.find(
        (m) => fullName(m).toLowerCase() === needle || m.givenName.toLowerCase() === needle,
      ) ?? null
    )
  }

  async function submit() {
    if (!parsed || parsed.title.trim().length === 0) return
    try {
      await createCard.mutateAsync({
        title: parsed.title,
        assigneeUserId: resolvedAssignee?.userId ?? defaultAssigneeUserId,
        dueAt: parsed.dueAt ? parsed.dueAt.toISOString() : null,
      })
      setValue('')
      setAiResult(null)
      onCreated?.()
      toast(t('work.quickAdd.created', { title: parsed.title }))
    } catch {
      toast(t('work.quickAdd.error'))
    }
  }

  function runAiParse() {
    if (!value.trim()) return
    setAiResult(null)
    parseAi.mutate(
      { text: value.trim(), memberNames: members.map((m) => fullName(m)), locale },
      {
        onSuccess: (res) => {
          if (!isAiQuickAddResult(res.data)) return
          setAiResult(res.data)
          setAiMeta({ totalTokens: res.meta.totalTokens, latencyMs: res.meta.latencyMs })
        },
      },
    )
  }

  async function acceptAi() {
    if (!aiResult) return
    const assignee = resolveAiAssignee(aiResult.assigneeName)
    try {
      await createCard.mutateAsync({
        title: aiResult.title,
        assigneeUserId: assignee?.userId ?? defaultAssigneeUserId,
        dueAt: aiResult.dueDate ? isoDateToUtcMidnight(aiResult.dueDate) : null,
        priority: aiResult.priority,
        labels: [],
      })
      setValue('')
      setAiResult(null)
      parseAi.reset()
      onCreated?.()
      toast(t('work.quickAdd.created', { title: aiResult.title }))
    } catch {
      toast(t('work.quickAdd.error'))
    }
  }

  const aiAssignee = aiResult ? resolveAiAssignee(aiResult.assigneeName) : null

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
        <AiPreviewPanel
          title={t('work.quickAdd.aiPreviewTitle')}
          status={parseAi.isPending ? 'pending' : parseAi.isError ? 'error' : 'ready'}
          pendingLabel={t('work.quickAdd.aiParse')}
          errorMessage={t('work.quickAdd.aiError')}
          acceptLabel={t('work.ai.accept')}
          editLabel={t('work.ai.edit')}
          discardLabel={t('work.ai.discard')}
          retryLabel={t('work.ai.retry')}
          onAccept={() => void acceptAi()}
          onEdit={() => setAiResult(null)}
          onDiscard={() => {
            setAiResult(null)
            parseAi.reset()
          }}
          onRetry={runAiParse}
          {...(aiMeta
            ? {
                costLine: t('work.quickAdd.aiMeta', {
                  tokens: aiMeta.totalTokens,
                  ms: aiMeta.latencyMs,
                }),
              }
            : {})}
        >
          {aiResult ? (
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-small">
              <dt className="text-muted-foreground">{t('work.field.title')}</dt>
              <dd className="text-foreground">{aiResult.title}</dd>
              <dt className="text-muted-foreground">{t('work.field.assignee')}</dt>
              <dd className="text-foreground">
                {aiAssignee ? fullName(aiAssignee) : t('work.field.unassigned')}
              </dd>
              <dt className="text-muted-foreground">{t('work.field.due')}</dt>
              <dd className="text-foreground">
                {aiResult.dueDate
                  ? formatDate(new Date(isoDateToUtcMidnight(aiResult.dueDate)), locale)
                  : '—'}
              </dd>
              {aiResult.priority !== 'none' ? (
                <>
                  <dt className="text-muted-foreground">{t('work.field.priority')}</dt>
                  <dd className="text-foreground">{t(PRIORITY_LABEL_KEY[aiResult.priority])}</dd>
                </>
              ) : null}
            </dl>
          ) : null}
        </AiPreviewPanel>
      ) : null}
    </div>
  )
}
