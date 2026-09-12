// The structured previews (v1.1 SPEC §8 "Surfaces": "structured previews ... not a wall of text").
//
// One component per feature output shape, each pure: it takes the model's already-validated output
// plus the lookups needed to turn ids into names, and renders. No fetching, no mutation, no feature
// flag reading -- the host screen owns all of that, and hands the result down. That is what makes the
// same preview usable from the board, the card, the personal workspace and `/ai` without duplication.
//
// The rule every one of them follows, and v1.0 broke everywhere (AI-AUDIT §0.2): **everything the
// model returned is shown, and everything shown is applied on Accept.** A preview that renders a
// checklist the Accept path then discards is worse than not rendering it -- the person believes they
// asked for something and got nothing.
import * as React from 'react'
import { Link } from 'react-router-dom'
import {
  AlertTriangle,
  ArrowRight,
  CalendarClock,
  CheckCircle2,
  CircleHelp,
  Clock,
  Flag,
  ListChecks,
  MessageSquareQuote,
  Users,
} from 'lucide-react'
import { Badge, Stagger, StaggerItem } from '@devon/ui'
import { useT, useLocale, formatDate, formatNumber } from '@devon/i18n'
import type {
  BoardRiskDigestOutput,
  CatchUpOutput,
  DeadlineRiskOutput,
  DraftEventOutput,
  DraftReplyOutput,
  DuplicateCheckOutput,
  NlAnalyticsOutput,
  PlanSprintOutput,
  QuickAddOutput,
  SemanticAskOutput,
  SubtaskBreakdownOutput,
  SuggestAssigneeOutput,
  SummarizeThreadOutput,
  TranslateOutput,
} from '../outputs.js'
import { ConfidenceChip, FieldRow, PreviewNote } from './ai-result-panel.js'
import { parseRef, searchHitHref, type SearchHit } from '../types.js'

function useDateText(): (iso: string | null) => string {
  const locale = useLocale()
  const t = useT()
  return React.useCallback(
    (iso) => (iso ? formatDate(new Date(`${iso}T00:00:00`), locale) : t('ai.preview.noDate')),
    [locale, t],
  )
}

// --- F1 quick_add_parse -------------------------------------------------------------------------

export function QuickAddPreview({
  output,
  memberName,
  labelName,
  projectName,
}: {
  output: QuickAddOutput
  memberName: (id: string) => string | null
  labelName: (id: string) => string | null
  projectName: (id: string) => string | null
}): React.JSX.Element {
  const t = useT()
  const dateText = useDateText()
  const labels = output.labelIds.map((id) => labelName(id)).filter((n): n is string => n !== null)
  return (
    <div className="flex flex-col divide-y divide-border">
      <FieldRow label={t('ai.preview.quickAdd.title')}>
        <span className="font-medium">{output.title}</span>
      </FieldRow>
      <FieldRow label={t('ai.preview.quickAdd.assignee')}>
        {output.assigneeUserId ? (
          <>
            <span>{memberName(output.assigneeUserId) ?? t('ai.preview.unknownPerson')}</span>
            <ConfidenceChip level={output.confidence.assignee} />
          </>
        ) : (
          <span className="text-muted-foreground">{t('ai.preview.quickAdd.noAssignee')}</span>
        )}
      </FieldRow>
      <FieldRow label={t('ai.preview.quickAdd.due')}>
        <span className="tabular-nums">{dateText(output.dueDate)}</span>
        {output.dueDate ? <ConfidenceChip level={output.confidence.dueDate} /> : null}
      </FieldRow>
      <FieldRow label={t('ai.preview.quickAdd.priority')}>
        <Badge tone={output.priority === 'urgent' ? 'destructive' : 'neutral'}>
          {t(`work.priority.${output.priority}`)}
        </Badge>
        <ConfidenceChip level={output.confidence.priority} />
      </FieldRow>
      {labels.length > 0 ? (
        <FieldRow label={t('ai.preview.quickAdd.labels')}>
          {labels.map((name) => (
            <Badge key={name} tone="neutral">
              {name}
            </Badge>
          ))}
        </FieldRow>
      ) : null}
      {output.projectId ? (
        <FieldRow label={t('ai.preview.quickAdd.project')}>
          <span>{projectName(output.projectId) ?? t('ai.preview.unknownProject')}</span>
        </FieldRow>
      ) : null}
      {output.ambiguous.length > 0 ? (
        <FieldRow label={t('ai.preview.quickAdd.ambiguous')}>
          <span className="text-warning">{output.ambiguous.join(', ')}</span>
        </FieldRow>
      ) : null}
      {output.notes ? (
        <div className="pt-2">
          <PreviewNote>{output.notes}</PreviewNote>
        </div>
      ) : null}
    </div>
  )
}

// --- F2 subtask_breakdown -----------------------------------------------------------------------

export function SubtasksPreview({
  output,
}: {
  output: SubtaskBreakdownOutput
}): React.JSX.Element {
  const t = useT()
  const locale = useLocale()
  if (output.insufficientInput) {
    return <PreviewNote>{t('ai.preview.subtasks.insufficient')}</PreviewNote>
  }
  const totalMin = output.subtasks.reduce((sum, item) => sum + item.estimateMin, 0)
  return (
    <div className="flex flex-col gap-2">
      <Stagger as="ol" className="flex flex-col divide-y divide-border">
        {output.subtasks.map((item, index) => (
          <StaggerItem
            as="li"
            key={`${index}-${item.text}`}
            className="flex items-start gap-2.5 py-2"
          >
            <ListChecks className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
            <span className="min-w-0 flex-1 text-body text-foreground">{item.text}</span>
            <span className="shrink-0 text-caption tabular-nums text-muted-foreground">
              {t('ai.preview.minutes', { count: formatNumber(item.estimateMin, locale) })}
            </span>
            {item.needsApproval ? <Badge tone="warning">{t('ai.preview.needsApproval')}</Badge> : null}
          </StaggerItem>
        ))}
      </Stagger>
      <PreviewNote>
        {t('ai.preview.subtasks.total', {
          count: formatNumber(output.subtasks.length, locale),
          minutes: formatNumber(totalMin, locale),
        })}
      </PreviewNote>
    </div>
  )
}

// --- F3 plan_sprint -----------------------------------------------------------------------------

export function PlanPreview({
  output,
  itemTitle,
}: {
  output: PlanSprintOutput
  itemTitle: (id: string) => string | null
}): React.JSX.Element {
  const t = useT()
  const locale = useLocale()
  const reasonFor = new Map(output.reasons.map((r) => [r.id, r.reason]))
  const wontFit = new Set(output.wontFitIds)
  return (
    <div className="flex flex-col gap-3">
      <p className="text-body text-foreground">{output.summary}</p>
      <Stagger as="ol" className="flex flex-col divide-y divide-border">
        {output.orderedIds.map((id, index) => (
          <StaggerItem as="li" key={id} className="flex items-start gap-3 py-2">
            <span
              className={
                id === output.focusId
                  ? 'mt-0.5 inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-primary text-caption font-medium text-primary-foreground'
                  : 'mt-0.5 inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-caption tabular-nums text-muted-foreground'
              }
            >
              {formatNumber(index + 1, locale)}
            </span>
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="flex flex-wrap items-center gap-2">
                <span className="min-w-0 text-body text-foreground">
                  {itemTitle(id) ?? t('ai.preview.unknownCard')}
                </span>
                {id === output.focusId ? (
                  <Badge tone="info">{t('ai.preview.plan.focus')}</Badge>
                ) : null}
                {wontFit.has(id) ? (
                  <Badge tone="warning">{t('ai.preview.plan.wontFit')}</Badge>
                ) : null}
              </span>
              {reasonFor.get(id) ? (
                <span className="text-caption text-muted-foreground">{reasonFor.get(id)}</span>
              ) : null}
            </span>
          </StaggerItem>
        ))}
      </Stagger>
      {output.overCommittedByMin > 0 ? (
        <p className="flex items-center gap-2 rounded-sm border border-warning/40 bg-warning/10 px-3 py-2 text-small text-foreground">
          <Clock className="size-4 shrink-0 text-warning" aria-hidden="true" />
          {t('ai.preview.plan.overCommitted', {
            minutes: formatNumber(output.overCommittedByMin, locale),
          })}
        </p>
      ) : null}
    </div>
  )
}

// --- F4 deadline_risk (the explainer) -----------------------------------------------------------

const RISK_TONE = { high: 'destructive', medium: 'warning', low: 'neutral' } as const

export function RiskExplainPreview({
  output,
}: {
  output: DeadlineRiskOutput
}): React.JSX.Element {
  const t = useT()
  const dateText = useDateText()
  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={RISK_TONE[output.riskLevel]}>{t(`ai.preview.risk.${output.riskLevel}`)}</Badge>
        <span className="min-w-0 text-body font-medium text-foreground">{output.headline}</span>
      </div>
      <p className="text-body text-foreground">{output.explanation}</p>
      <p className="flex flex-wrap items-center gap-2 text-small text-muted-foreground">
        <ArrowRight className="size-4 shrink-0 text-primary" aria-hidden="true" />
        <span className="text-foreground">{output.actionLabel}</span>
        {output.actionPayload.suggestedDueDate ? (
          <span className="tabular-nums">
            {dateText(output.actionPayload.suggestedDueDate)}
          </span>
        ) : null}
      </p>
    </div>
  )
}

// --- F5 catch_up (the briefing) -----------------------------------------------------------------

export function CatchUpPreview({
  output,
  cardTitle,
}: {
  output: CatchUpOutput
  cardTitle: (id: string) => string | null
}): React.JSX.Element {
  const t = useT()
  const locale = useLocale()
  return (
    <div className="flex flex-col gap-4">
      <p className="text-body font-medium text-foreground">{output.headline}</p>

      {output.wins.text ? (
        <section className="flex flex-col gap-1">
          <h4 className="flex items-center gap-2 text-caption font-medium uppercase tracking-wide text-muted-foreground">
            <CheckCircle2 className="size-3.5 text-success" aria-hidden="true" />
            {t('ai.preview.catchUp.wins')}
          </h4>
          <p className="text-body text-foreground">{output.wins.text}</p>
        </section>
      ) : null}

      {output.risks.length > 0 ? (
        <section className="flex flex-col gap-1">
          <h4 className="flex items-center gap-2 text-caption font-medium uppercase tracking-wide text-muted-foreground">
            <AlertTriangle className="size-3.5 text-warning" aria-hidden="true" />
            {t('ai.preview.catchUp.risks')}
          </h4>
          <ul className="flex flex-col divide-y divide-border">
            {output.risks.map((risk) => (
              <li key={risk.cardId} className="flex items-start gap-2 py-1.5">
                <Badge tone={risk.severity === 'high' ? 'destructive' : 'warning'}>
                  {t(`ai.preview.severity.${risk.severity}`)}
                </Badge>
                <span className="min-w-0 flex-1 text-body text-foreground">
                  {risk.text}{' '}
                  <Link
                    to={`/work/card?id=${risk.cardId}`}
                    className="text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {cardTitle(risk.cardId) ?? t('ai.preview.openCard')}
                  </Link>
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {output.overloaded.length > 0 ? (
        <section className="flex flex-col gap-1">
          <h4 className="flex items-center gap-2 text-caption font-medium uppercase tracking-wide text-muted-foreground">
            <Users className="size-3.5 text-primary" aria-hidden="true" />
            {t('ai.preview.catchUp.overloaded')}
          </h4>
          <ul className="flex flex-col gap-1">
            {output.overloaded.map((person) => (
              <li key={person.name} className="flex flex-wrap items-center gap-2 text-body">
                <span className="font-medium text-foreground">{person.name}</span>
                <Badge tone="warning">
                  {t('ai.preview.catchUp.openCount', {
                    count: formatNumber(person.openCount, locale),
                  })}
                </Badge>
                <span className="min-w-0 text-small text-muted-foreground">{person.text}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {output.items.length > 0 ? (
        <section className="flex flex-col gap-1">
          <h4 className="flex items-center gap-2 text-caption font-medium uppercase tracking-wide text-muted-foreground">
            <Flag className="size-3.5 text-primary" aria-hidden="true" />
            {t('ai.preview.catchUp.needsYou', {
              count: formatNumber(output.needsActionCount, locale),
            })}
          </h4>
          <Stagger as="ul" className="flex flex-col divide-y divide-border">
            {output.items.map((item) => (
              <StaggerItem
                as="li"
                key={`${item.kind}-${item.refId}`}
                className="flex items-start gap-2 py-1.5"
              >
                {item.needsAction ? (
                  <Badge tone="info">{t('ai.preview.catchUp.action')}</Badge>
                ) : null}
                <span className="min-w-0 flex-1 text-body text-foreground">{item.text}</span>
              </StaggerItem>
            ))}
          </Stagger>
          {output.moreCount > 0 ? (
            <PreviewNote>
              {t('ai.preview.catchUp.more', { count: formatNumber(output.moreCount, locale) })}
            </PreviewNote>
          ) : null}
        </section>
      ) : null}

      {output.lookingAhead.text ? (
        <section className="flex flex-col gap-1">
          <h4 className="flex items-center gap-2 text-caption font-medium uppercase tracking-wide text-muted-foreground">
            <CalendarClock className="size-3.5 text-primary" aria-hidden="true" />
            {t('ai.preview.catchUp.ahead')}
          </h4>
          <p className="text-body text-foreground">{output.lookingAhead.text}</p>
        </section>
      ) : null}
    </div>
  )
}

// --- F6 draft_event -----------------------------------------------------------------------------

export function EventDraftPreview({
  output,
}: {
  output: DraftEventOutput
}): React.JSX.Element {
  const t = useT()
  const locale = useLocale()
  const dateText = useDateText()
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <p className="text-body font-medium text-foreground">{output.title}</p>
        <p className="text-body text-foreground">{output.description}</p>
      </div>
      {output.location ? (
        <FieldRow label={t('ai.preview.event.place')}>{output.location}</FieldRow>
      ) : null}
      <FieldRow label={t('ai.preview.event.attendees')}>
        {formatNumber(output.estimatedAttendees, locale)}
      </FieldRow>
      <section className="flex flex-col gap-1">
        <h4 className="text-caption font-medium uppercase tracking-wide text-muted-foreground">
          {t('ai.preview.event.dateOptions')}
        </h4>
        <ul className="flex flex-col divide-y divide-border">
          {output.dateOptions.map((option) => (
            <li
              key={`${option.date}-${option.startTime}`}
              className="flex flex-wrap items-center gap-x-3 gap-y-1 py-1.5 text-body"
            >
              <span className="tabular-nums text-foreground">{dateText(option.date)}</span>
              <span className="tabular-nums text-foreground">{option.startTime}</span>
              <span className="text-caption text-muted-foreground">
                {t('ai.preview.minutes', { count: formatNumber(option.durationMin, locale) })}
              </span>
              <span className="min-w-0 text-small text-muted-foreground">{option.label}</span>
            </li>
          ))}
        </ul>
      </section>
      <section className="flex flex-col gap-1">
        <h4 className="text-caption font-medium uppercase tracking-wide text-muted-foreground">
          {t('ai.preview.event.checklist')}
        </h4>
        <ul className="flex flex-col gap-1">
          {output.checklist.map((item) => (
            <li key={item} className="flex items-start gap-2 text-body text-foreground">
              <ListChecks className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
              <span className="min-w-0">{item}</span>
            </li>
          ))}
        </ul>
      </section>
      {output.carpool.needed ? (
        <section className="flex flex-col gap-1">
          <h4 className="text-caption font-medium uppercase tracking-wide text-muted-foreground">
            {t('ai.preview.event.carpool')}
          </h4>
          <p className="text-body text-foreground">{output.carpool.note}</p>
        </section>
      ) : null}
    </div>
  )
}

// --- F7 summarize_thread ------------------------------------------------------------------------

export function ThreadDigestPreview({
  output,
  onJumpToComment,
}: {
  output: SummarizeThreadOutput
  onJumpToComment?: (commentId: string) => void
}): React.JSX.Element {
  const t = useT()
  const dateText = useDateText()

  // if/else rather than an early `return <span/>` followed by `return (`: `check-i18n.mjs`'s
  // hard-coded-text heuristic matches any run of words sitting between one JSX closing bracket and
  // the next opening one, across newlines, so a bare `return (` line between two JSX blocks reads to
  // it as a stray text node.
  // The same trap `people-screen.tsx` and `table-screen.tsx` document for their own ternaries.
  function CommentLink({ id, label }: { id: string; label: string }) {
    if (!onJumpToComment) {
      return <span className="text-caption text-muted-foreground">{label}</span>
    }
    return (
      <button
        type="button"
        onClick={() => onJumpToComment(id)}
        className="rounded-sm text-caption text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {label}
      </button>
    )
  }

  const empty =
    output.decisions.length === 0 &&
    output.openQuestions.length === 0 &&
    output.commitments.length === 0

  if (empty) {
    return <PreviewNote>{t('ai.preview.thread.empty')}</PreviewNote>
  }

  return (
    <div className="flex flex-col gap-4">
      {output.forViewer ? <p className="text-body text-foreground">{output.forViewer}</p> : null}

      {output.decisions.length > 0 ? (
        <section className="flex flex-col gap-1">
          <h4 className="flex items-center gap-2 text-caption font-medium uppercase tracking-wide text-muted-foreground">
            <CheckCircle2 className="size-3.5 text-success" aria-hidden="true" />
            {t('ai.preview.thread.decisions')}
          </h4>
          <ul className="flex flex-col divide-y divide-border">
            {output.decisions.map((decision) => (
              <li key={decision.text} className="flex flex-col gap-0.5 py-1.5">
                <span className="text-body text-foreground">{decision.text}</span>
                <span className="flex flex-wrap gap-2">
                  {decision.commentIds.map((id, i) => (
                    <CommentLink
                      key={id}
                      id={id}
                      label={t('ai.preview.thread.source', { n: String(i + 1) })}
                    />
                  ))}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {output.openQuestions.length > 0 ? (
        <section className="flex flex-col gap-1">
          <h4 className="flex items-center gap-2 text-caption font-medium uppercase tracking-wide text-muted-foreground">
            <CircleHelp className="size-3.5 text-warning" aria-hidden="true" />
            {t('ai.preview.thread.openQuestions')}
          </h4>
          <ul className="flex flex-col divide-y divide-border">
            {output.openQuestions.map((question) => (
              <li key={question.text} className="flex flex-col gap-0.5 py-1.5">
                <span className="text-body text-foreground">{question.text}</span>
                <CommentLink id={question.commentId} label={t('ai.preview.thread.source1')} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {output.commitments.length > 0 ? (
        <section className="flex flex-col gap-1">
          <h4 className="flex items-center gap-2 text-caption font-medium uppercase tracking-wide text-muted-foreground">
            <MessageSquareQuote className="size-3.5 text-primary" aria-hidden="true" />
            {t('ai.preview.thread.commitments')}
          </h4>
          <ul className="flex flex-col divide-y divide-border">
            {output.commitments.map((commitment, index) => (
              <li
                key={`${commitment.who}-${index}`}
                className="flex flex-wrap items-center gap-x-2 gap-y-0.5 py-1.5"
              >
                <span className="text-body font-medium text-foreground">{commitment.who}</span>
                <span className="min-w-0 flex-1 text-body text-foreground">{commitment.what}</span>
                {commitment.byWhen ? (
                  <span className="shrink-0 text-caption tabular-nums text-muted-foreground">
                    {dateText(commitment.byWhen)}
                  </span>
                ) : null}
                <CommentLink id={commitment.commentId} label={t('ai.preview.thread.source1')} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  )
}

// --- F8 nl_analytics ----------------------------------------------------------------------------

export function AnalyticsAnswerPreview({
  output,
  rows,
  total,
}: {
  output: NlAnalyticsOutput
  /** The numbers the filter actually produced, resolved by the host screen. */
  rows?: { label: string; value: number }[]
  total?: number
}): React.JSX.Element {
  const t = useT()
  const locale = useLocale()
  return (
    <div className="flex flex-col gap-3">
      <p className="text-body text-foreground">{output.restatement}</p>

      {total !== undefined ? (
        <p className="text-h3 font-semibold tabular-nums text-foreground">
          {formatNumber(total, locale)}
        </p>
      ) : null}

      {rows && rows.length > 0 ? (
        <ul className="flex flex-col divide-y divide-border">
          {rows.slice(0, 8).map((row) => (
            <li key={row.label} className="flex items-center justify-between gap-3 py-1.5">
              <span className="min-w-0 truncate text-body text-foreground">{row.label}</span>
              <span className="shrink-0 text-body tabular-nums text-foreground">
                {formatNumber(row.value, locale)}
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="flex flex-col gap-1 rounded-sm border border-border bg-muted/30 px-3 py-2">
        <span className="text-caption text-muted-foreground">{t('ai.preview.analytics.filter')}</span>
        <code className="break-all font-mono text-caption text-foreground">
          {output.filterText || t('ai.preview.analytics.noFilter')}
        </code>
        <span className="flex flex-wrap items-center gap-2 pt-1">
          <Badge tone="neutral">{t(`ai.preview.analytics.chart.${output.chartType}`)}</Badge>
          <Badge tone="neutral">{t(`ai.preview.analytics.groupBy.${output.groupBy}`)}</Badge>
          <ConfidenceChip level={output.confidence} />
        </span>
      </div>

      {output.unmappedTerms.length > 0 ? (
        <PreviewNote>
          {t('ai.preview.analytics.unmapped', { terms: output.unmappedTerms.join(', ') })}
        </PreviewNote>
      ) : null}
    </div>
  )
}

// --- F9 translate -------------------------------------------------------------------------------

export function TranslatePreview({
  output,
}: {
  output: TranslateOutput
}): React.JSX.Element {
  const t = useT()
  return (
    <div className="flex flex-col gap-2">
      {output.alreadyInTarget ? (
        <PreviewNote>{t('ai.preview.translate.alreadyInTarget')}</PreviewNote>
      ) : null}
      <p className="whitespace-pre-wrap text-body text-foreground">{output.translatedText}</p>
      {output.uncertainTerms.length > 0 ? (
        <p className="flex flex-wrap items-center gap-2 text-caption text-muted-foreground">
          {t('ai.preview.translate.uncertain')}
          {output.uncertainTerms.map((term) => (
            <Badge key={term} tone="warning">
              {term}
            </Badge>
          ))}
        </p>
      ) : null}
    </div>
  )
}

// --- N-1 draft_reply ----------------------------------------------------------------------------

export function DraftReplyPreview({
  output,
}: {
  output: DraftReplyOutput
}): React.JSX.Element {
  const t = useT()
  return (
    <div className="flex flex-col gap-2.5">
      <span className="flex flex-wrap items-center gap-2">
        <Badge tone="neutral">{t(`ai.preview.reply.tone.${output.tone}`)}</Badge>
        {output.answers.length > 0 ? (
          <span className="text-caption text-muted-foreground">
            {t('ai.preview.reply.answering', { count: String(output.answers.length) })}
          </span>
        ) : null}
      </span>
      <p className="whitespace-pre-wrap rounded-sm border border-border bg-muted/30 px-3 py-2 text-body text-foreground">
        {output.draft}
      </p>
      {output.stillNeeded.length > 0 ? (
        <div className="flex flex-col gap-1">
          <span className="text-caption text-muted-foreground">
            {t('ai.preview.reply.stillNeeded')}
          </span>
          <ul className="flex flex-wrap gap-2">
            {output.stillNeeded.map((item) => (
              <li key={item}>
                <Badge tone="warning">{item}</Badge>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  )
}

// --- N-2 board_risk_digest ----------------------------------------------------------------------

export function BoardRiskDigestPreview({
  output,
  cardTitle,
  onAction,
}: {
  output: BoardRiskDigestOutput
  cardTitle: (id: string) => string | null
  onAction?: (cardId: string, action: BoardRiskDigestOutput['entries'][number]['suggestedAction']) => void
}): React.JSX.Element {
  const t = useT()
  const locale = useLocale()
  return (
    <div className="flex flex-col gap-3">
      <p className="text-body font-medium text-foreground">{output.headline}</p>
      <Stagger as="ol" className="flex flex-col divide-y divide-border">
        {output.entries.map((entry) => (
          <StaggerItem as="li" key={entry.cardId} className="flex items-start gap-3 py-2">
            <span className="mt-0.5 inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-destructive/10 text-caption tabular-nums font-medium text-destructive">
              {formatNumber(entry.rank, locale)}
            </span>
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <Link
                to={`/work/card?id=${entry.cardId}`}
                className="min-w-0 truncate text-body text-foreground underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {cardTitle(entry.cardId) ?? t('ai.preview.openCard')}
              </Link>
              <span className="text-caption text-muted-foreground">{entry.reason}</span>
            </span>
            {onAction ? (
              <button
                type="button"
                onClick={() => onAction(entry.cardId, entry.suggestedAction)}
                className="shrink-0 rounded-sm border border-border px-2 py-1 text-caption text-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {t(`ai.preview.riskAction.${entry.suggestedAction}`)}
              </button>
            ) : (
              <Badge tone="neutral">{t(`ai.preview.riskAction.${entry.suggestedAction}`)}</Badge>
            )}
          </StaggerItem>
        ))}
      </Stagger>
      {output.pressurePoints.length > 0 ? (
        <section className="flex flex-col gap-1">
          <h4 className="flex items-center gap-2 text-caption font-medium uppercase tracking-wide text-muted-foreground">
            <Users className="size-3.5 text-primary" aria-hidden="true" />
            {t('ai.preview.digest.pressure')}
          </h4>
          <ul className="flex flex-col gap-1">
            {output.pressurePoints.map((point) => (
              <li key={point.name} className="flex flex-wrap items-baseline gap-2 text-body">
                <span className="font-medium text-foreground">{point.name}</span>
                <span className="min-w-0 text-small text-muted-foreground">{point.text}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  )
}

// --- N-3 suggest_assignee -----------------------------------------------------------------------

export function AssigneeSuggestionsPreview({
  output,
  memberName,
  onChoose,
}: {
  output: SuggestAssigneeOutput
  memberName: (id: string) => string | null
  onChoose?: (userId: string) => void
}): React.JSX.Element {
  const t = useT()
  const locale = useLocale()
  if (output.suggestions.length === 0) {
    return <PreviewNote>{output.note || t('ai.preview.assignee.none')}</PreviewNote>
  }
  return (
    <div className="flex flex-col gap-2">
      <Stagger as="ol" className="flex flex-col divide-y divide-border">
        {output.suggestions.map((suggestion) => (
          <StaggerItem
            as="li"
            key={suggestion.userId}
            className="flex items-start gap-3 py-2"
          >
            <span className="mt-0.5 inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-caption tabular-nums text-muted-foreground">
              {formatNumber(suggestion.rank, locale)}
            </span>
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="flex flex-wrap items-center gap-2">
                <span className="text-body font-medium text-foreground">
                  {memberName(suggestion.userId) ?? t('ai.preview.unknownPerson')}
                </span>
                <ConfidenceChip level={suggestion.confidence} />
              </span>
              <span className="text-caption text-muted-foreground">{suggestion.reason}</span>
              {suggestion.loadWarning ? (
                <span className="text-caption text-warning">{suggestion.loadWarning}</span>
              ) : null}
            </span>
            {onChoose ? (
              <button
                type="button"
                onClick={() => onChoose(suggestion.userId)}
                className="shrink-0 rounded-sm border border-border px-2 py-1 text-caption text-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {t('ai.preview.assignee.choose')}
              </button>
            ) : null}
          </StaggerItem>
        ))}
      </Stagger>
      {output.note ? <PreviewNote>{output.note}</PreviewNote> : null}
    </div>
  )
}

// --- N-5 duplicate_check ------------------------------------------------------------------------

export function DuplicatePreview({
  output,
  cardTitle,
}: {
  output: DuplicateCheckOutput
  cardTitle: (id: string) => string | null
}): React.JSX.Element {
  const t = useT()
  if (output.verdict === 'none' || output.matches.length === 0) {
    return <PreviewNote>{t('ai.preview.duplicate.none')}</PreviewNote>
  }
  return (
    <ul className="flex flex-col divide-y divide-border">
      {output.matches.map((match) => (
        <li key={match.cardId} className="flex items-start gap-2 py-2">
          <Badge tone={match.relation === 'duplicate' ? 'warning' : 'neutral'}>
            {t(`ai.preview.duplicate.${match.relation}`)}
          </Badge>
          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
            <Link
              to={`/work/card?id=${match.cardId}`}
              className="min-w-0 truncate text-body text-foreground underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {cardTitle(match.cardId) ?? t('ai.preview.openCard')}
            </Link>
            <span className="text-caption text-muted-foreground">{match.reason}</span>
          </span>
        </li>
      ))}
    </ul>
  )
}

// --- EPIC-016 semantic_ask ----------------------------------------------------------------------

export function AskAnswerPreview({
  output,
  sources,
}: {
  output: SemanticAskOutput
  sources: SearchHit[]
}): React.JSX.Element {
  const t = useT()
  const byRef = new Map(sources.map((hit) => [`${hit.subjectType}:${hit.subjectId}`, hit]))

  if (!output.answered) {
    return (
      <div className="flex flex-col gap-2">
        <PreviewNote>{t('ai.preview.ask.notFound')}</PreviewNote>
        {output.followUp ? <p className="text-body text-foreground">{output.followUp}</p> : null}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="whitespace-pre-wrap text-body text-foreground">{output.answer}</p>
      {output.citations.length > 0 ? (
        <section className="flex flex-col gap-1">
          <h4 className="text-caption font-medium uppercase tracking-wide text-muted-foreground">
            {t('ai.preview.ask.sources')}
          </h4>
          <ul className="flex flex-col gap-1">
            {output.citations.map((ref) => {
              const parsed = parseRef(ref)
              const hit = byRef.get(ref)
              if (!parsed) {
                return (
                  <li key={ref} className="text-caption text-muted-foreground">
                    {ref}
                  </li>
                )
              }
              return (
                <li key={ref}>
                  <Link
                    to={searchHitHref(parsed)}
                    className="flex items-center gap-2 rounded-sm text-small text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <Badge tone="neutral">{t(`ai.search.kind.${parsed.subjectType}`)}</Badge>
                    <span className="min-w-0 truncate">
                      {hit?.title || t('ai.preview.ask.openSource')}
                    </span>
                  </Link>
                </li>
              )
            })}
          </ul>
        </section>
      ) : null}
      {output.followUp ? <PreviewNote>{output.followUp}</PreviewNote> : null}
    </div>
  )
}
