// v1.1 SPEC §7 (A10) -- "blocks" / "blocked by" on a card, with the cycle guard.
//
// The picker greys out every card that would close a loop *before* the click, using the same
// `wouldCreateDependencyCycle` the server refuses with (`@devon/contracts`). Letting the server say
// no would cost a round trip and teach nothing -- a disabled row with "this would create a loop"
// under it explains the rule the moment it matters.
import * as React from 'react'
import { ArrowRight, Link2Off, Loader2, Lock, Unlock } from 'lucide-react'
import { wouldCreateDependencyCycle, type DependencyEdge } from '@devon/contracts'
import { useT, useLocale, formatDate } from '@devon/i18n'
import {
  Button,
  Combobox,
  IconButton,
  Skeleton,
  Stagger,
  StaggerItem,
  StateView,
  cn,
  toast,
  type ComboboxOption,
} from '@devon/ui'
import { useCardsQuery } from '../hooks.js'
import {
  useAddDependencyMutation,
  useCardDependenciesQuery,
  useDependencyGraphQuery,
  useRemoveDependencyMutation,
} from '../hooks-plus.js'
import type { CardRef, DependencyEntry } from '../api-plus.js'

function DependencyRow({
  entry,
  onOpenCard,
  onRemove,
  removing,
  canEdit,
}: {
  entry: DependencyEntry
  onOpenCard: (cardId: string) => void
  onRemove: () => void
  removing: boolean
  canEdit: boolean
}): React.JSX.Element {
  const t = useT()
  const locale = useLocale()
  const card: CardRef = entry.card
  const open = card.status === 'active'
  return (
    <div className="flex items-center gap-2 rounded-md border border-border bg-card px-3 py-2">
      <span
        aria-hidden="true"
        className={cn(
          'inline-flex size-5 shrink-0 items-center justify-center rounded-full',
          open ? 'bg-destructive/15 text-destructive' : 'bg-success/15 text-success',
        )}
      >
        {open ? <Lock className="size-3" /> : <Unlock className="size-3" />}
      </span>
      <button
        type="button"
        onClick={() => onOpenCard(card.id)}
        className="min-w-0 flex-1 truncate text-left text-small text-foreground hover:underline"
      >
        {card.title}
      </button>
      {card.dueAt ? (
        <span className="shrink-0 text-caption text-muted-foreground">
          {formatDate(new Date(card.dueAt), locale)}
        </span>
      ) : null}
      <span className="shrink-0 text-caption text-muted-foreground">
        {open ? t('work.dependencies.stillOpen') : t('work.dependencies.doneAlready')}
      </span>
      {canEdit ? (
        <IconButton
          aria-label={t('work.dependencies.remove', { title: card.title })}
          onClick={onRemove}
          disabled={removing}
          className="shrink-0"
        >
          {removing ? (
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          ) : (
            <Link2Off className="size-4" aria-hidden="true" />
          )}
        </IconButton>
      ) : null}
    </div>
  )
}

export interface DependenciesPanelProps {
  cardId: string
  canEdit: boolean
  onOpenCard: (cardId: string) => void
}

export function DependenciesPanel({
  cardId,
  canEdit,
  onOpenCard,
}: DependenciesPanelProps): React.JSX.Element {
  const t = useT()
  const [picking, setPicking] = React.useState(false)
  const [pendingRemoval, setPendingRemoval] = React.useState<string | null>(null)

  const query = useCardDependenciesQuery(cardId)
  // The graph is only needed once the picker is open -- a card sheet that nobody adds a dependency
  // from never issues this request at all.
  const graph = useDependencyGraphQuery(picking)
  const candidates = useCardsQuery(picking ? { limit: 100 } : {})
  const addDependency = useAddDependencyMutation(cardId)
  const removeDependency = useRemoveDependencyMutation(cardId)

  const blockedBy = query.data?.blockedBy ?? []
  const blocks = query.data?.blocks ?? []

  const edges: DependencyEdge[] = React.useMemo(
    () =>
      (graph.data ?? []).map((edge) => ({
        cardId: edge.cardId,
        blockedByCardId: edge.blockedByCardId,
      })),
    [graph.data],
  )

  const alreadyLinked = React.useMemo(
    () => new Set(blockedBy.map((entry) => entry.card.id)),
    [blockedBy],
  )

  const options: ComboboxOption[] = React.useMemo(() => {
    const list = candidates.data ?? []
    return list
      .filter((candidate) => candidate.id !== cardId && !alreadyLinked.has(candidate.id))
      .map((candidate) => {
        // The guard runs against the department's whole edge set, so it catches a loop that closes
        // three cards away, not just the obvious A-blocks-B-blocks-A.
        const cycles = wouldCreateDependencyCycle(edges, cardId, candidate.id)
        return {
          value: candidate.id,
          label: candidate.title,
          disabled: cycles,
          ...(cycles ? { description: t('work.dependencies.wouldLoop') } : {}),
        }
      })
  }, [candidates.data, cardId, alreadyLinked, edges, t])

  function addBlocker(blockerId: string): void {
    addDependency.mutate(blockerId, {
      onSuccess: () => {
        setPicking(false)
        toast.success(t('work.dependencies.added'))
      },
      onError: () => toast.error(t('work.dependencies.addFailed')),
    })
  }

  function removeBlocker(entry: DependencyEntry): void {
    setPendingRemoval(entry.id)
    removeDependency.mutate(entry.id, {
      onSettled: () => setPendingRemoval(null),
      onSuccess: () => toast.success(t('work.dependencies.removed')),
      onError: () => toast.error(t('work.dependencies.removeFailed')),
    })
  }

  if (query.isPending) {
    return (
      <div className="flex flex-col gap-2" aria-busy="true">
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-9 w-2/3" />
      </div>
    )
  }

  if (query.isError) {
    return (
      <StateView
        kind="error"
        titleKey="state.error.title"
        bodyKey="state.error.body"
        action={{ labelKey: 'state.error.action', onAction: () => void query.refetch() }}
      />
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <section className="flex flex-col gap-2">
        <h4 className="text-caption font-semibold uppercase tracking-(--text-eyebrow--letter-spacing) text-muted-foreground">
          {t('work.dependencies.blockedByTitle')}
        </h4>
        {blockedBy.length === 0 ? (
          <p className="text-caption text-muted-foreground">
            {t('work.dependencies.blockedByEmpty')}
          </p>
        ) : (
          <Stagger
            presence
            className="flex flex-col gap-1.5"
            animateKey={`blockedBy-${blockedBy.length}`}
          >
            {blockedBy.map((entry) => (
              <StaggerItem key={entry.id} exit="hidden" layout>
                <DependencyRow
                  entry={entry}
                  onOpenCard={onOpenCard}
                  onRemove={() => removeBlocker(entry)}
                  removing={pendingRemoval === entry.id}
                  canEdit={canEdit}
                />
              </StaggerItem>
            ))}
          </Stagger>
        )}
        {canEdit ? (
          picking ? (
            <div className="flex flex-col gap-2">
              <Combobox
                options={options}
                value={null}
                onValueChange={addBlocker}
                label={t('work.dependencies.pickLabel')}
                placeholder={t('work.dependencies.pickPlaceholder')}
                searchPlaceholder={t('work.dependencies.pickSearch')}
                emptyMessage={t('work.dependencies.pickEmpty')}
                loading={candidates.isPending || graph.isPending}
              />
              <Button variant="ghost" size="sm" onClick={() => setPicking(false)}>
                {t('common.cancel')}
              </Button>
            </div>
          ) : (
            <Button
              variant="secondary"
              size="sm"
              className="self-start"
              onClick={() => setPicking(true)}
            >
              {t('work.dependencies.add')}
            </Button>
          )
        ) : null}
      </section>

      <section className="flex flex-col gap-2">
        <h4 className="flex items-center gap-1.5 text-caption font-semibold uppercase tracking-(--text-eyebrow--letter-spacing) text-muted-foreground">
          <ArrowRight className="size-3.5" aria-hidden="true" />
          {t('work.dependencies.blocksTitle')}
        </h4>
        {blocks.length === 0 ? (
          <p className="text-caption text-muted-foreground">{t('work.dependencies.blocksEmpty')}</p>
        ) : (
          <div className="flex flex-col gap-1.5">
            {blocks.map((entry) => (
              // The other end of the edge is owned by the *other* card -- it is removed from there,
              // which is why these rows never offer a remove button.
              <DependencyRow
                key={entry.id}
                entry={entry}
                onOpenCard={onOpenCard}
                onRemove={() => undefined}
                removing={false}
                canEdit={false}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
