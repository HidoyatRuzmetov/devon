// v1.1 SPEC §7 -- everything v1.1 added to the card sheet, as four disclosure sections below the
// checklist: estimate + time log (A3), dependencies (A10), repeat (A7) and reminders (7.4).
//
// Disclosures rather than four always-open blocks: the v1.0 sheet was already long, and a card that
// has no dependencies and no repeat should cost one line each, not two empty panels. Each header
// carries its own summary chip, so the closed state still answers "is there anything in here?" --
// which is the whole job of a collapsed section (DESIGN.md §9.4).
import * as React from 'react'
import { BellRing, ChevronDown, Link2, Repeat, Timer } from 'lucide-react'
import { useT } from '@devon/i18n'
import { Chip, Collapsible, cn } from '@devon/ui'
import { DependenciesPanel } from './dependencies-panel.js'
import { EstimateField } from './estimate-field.js'
import { RecurrenceField } from './recurrence-field.js'
import { RemindersPanel } from './reminders-panel.js'
import { TimeLogPanel } from './time-log-panel.js'
import { formatDurationShort } from '../lib/estimate.js'
import type { CardDetail, MemberSummary } from '../api.js'
import type { RecurrenceRule } from '@devon/contracts'

function Section({
  id,
  icon: Icon,
  title,
  summary,
  defaultOpen = false,
  children,
}: {
  id: string
  icon: React.ComponentType<React.SVGProps<SVGSVGElement>>
  title: string
  /** Rendered in the header, visible whether the section is open or shut -- the closed state still
   * has to answer "is there anything in here?". */
  summary?: React.ReactNode
  defaultOpen?: boolean
  children: React.ReactNode
}): React.JSX.Element {
  const [open, setOpen] = React.useState(defaultOpen)
  return (
    <div className="border-t border-border pt-3">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={id}
        className="flex w-full flex-wrap items-center gap-2 text-caption font-medium uppercase tracking-(--text-eyebrow--letter-spacing) text-muted-foreground hover:text-foreground"
      >
        <ChevronDown
          className={cn(
            'size-3.5 shrink-0 transition-transform duration-(--dur-micro)',
            !open && '-rotate-90',
          )}
          aria-hidden="true"
        />
        <Icon className="size-3.5 shrink-0" aria-hidden="true" />
        <span className="min-w-0 flex-1 basis-32 text-left [overflow-wrap:anywhere]">{title}</span>
        {summary ? <span className="ml-auto min-w-0 max-w-full normal-case">{summary}</span> : null}
      </button>
      <Collapsible open={open} id={id}>
        <div className="pt-3">{children}</div>
      </Collapsible>
    </div>
  )
}

export interface CardPlusSectionsProps {
  card: CardDetail
  canEdit: boolean
  members: readonly MemberSummary[]
  onOpenCard: (cardId: string) => void
  onEstimateChange: (minutes: number | null) => void
  onRecurrenceChange: (rule: RecurrenceRule | null) => void | Promise<void>
}

export function CardPlusSections({
  card,
  canEdit,
  members,
  onOpenCard,
  onEstimateChange,
  onRecurrenceChange,
}: CardPlusSectionsProps): React.JSX.Element {
  const t = useT()

  const estimateMin = card.estimateMin ?? null
  const loggedMin = card.loggedMin ?? 0
  const blockedCount = card.blockedByOpenCount ?? 0
  const blocksCount = card.blocksCount ?? 0
  const repeating = card.recurrence != null

  return (
    <div className="flex flex-col">
      <Section
        id={`card-time-${card.id}`}
        icon={Timer}
        title={t('work.section.time')}
        defaultOpen={estimateMin !== null || loggedMin > 0}
        summary={
          estimateMin !== null || loggedMin > 0 ? (
            <Chip tone="outline">
              {loggedMin > 0 && estimateMin !== null
                ? t('work.section.timeSummary', {
                    logged: formatDurationShort(loggedMin, t),
                    estimate: formatDurationShort(estimateMin, t),
                  })
                : estimateMin !== null
                  ? formatDurationShort(estimateMin, t)
                  : formatDurationShort(loggedMin, t)}
            </Chip>
          ) : null
        }
      >
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <span className="text-caption font-medium uppercase tracking-(--text-eyebrow--letter-spacing) text-muted-foreground">
              {t('work.estimate.label')}
            </span>
            <EstimateField
              value={estimateMin}
              onCommit={onEstimateChange}
              disabled={!canEdit}
              id={`estimate-${card.id}`}
            />
          </div>
          <TimeLogPanel cardId={card.id} canEdit={canEdit} members={members} />
        </div>
      </Section>

      <Section
        id={`card-deps-${card.id}`}
        icon={Link2}
        title={t('work.section.dependencies')}
        defaultOpen={blockedCount > 0}
        summary={
          blockedCount > 0 ? (
            <Chip tone="destructive">{t('work.chip.blocked')}</Chip>
          ) : blocksCount > 0 ? (
            <Chip tone="outline">{t('work.dependencies.blocksCount', { count: blocksCount })}</Chip>
          ) : null
        }
      >
        <DependenciesPanel cardId={card.id} canEdit={canEdit} onOpenCard={onOpenCard} />
      </Section>

      <Section
        id={`card-repeat-${card.id}`}
        icon={Repeat}
        title={t('work.section.repeat')}
        defaultOpen={repeating}
        summary={repeating ? <Chip tone="info">{t('work.chip.repeats')}</Chip> : null}
      >
        <RecurrenceField
          value={card.recurrence ?? null}
          onCommit={onRecurrenceChange}
          anchorIso={card.dueAt}
          disabled={!canEdit}
        />
      </Section>

      {/* A reminder is personal, so this section never depends on `canEdit` -- anyone who can see
          the card may ask to be reminded about it, including a watcher who cannot edit a field. */}
      <Section id={`card-reminders-${card.id}`} icon={BellRing} title={t('work.section.reminders')}>
        <RemindersPanel cardId={card.id} />
      </Section>
    </div>
  )
}
