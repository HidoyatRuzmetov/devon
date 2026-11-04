import * as React from 'react'
import { useT } from '@devon/i18n'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  IconButton,
  toast,
  toastWithUndo,
} from '@devon/ui'
import { Check, Ellipsis, FolderPlus, Pin, PinOff, Trash2 } from 'lucide-react'
import type { Card } from '../api.js'
import { useDeleteCardMutation, usePatchCardMutation } from '../hooks.js'
import { useAddFocusMutation, useRemoveFocusMutation } from '../hooks-plus.js'
import { ConvertProjectDialog } from '../../projects/components/convert-project-dialog.js'

/** Avoid mounting mutation observers for every tile until its menu is first opened. */
export function CardActionsMenu({ card }: { card: Card }) {
  const t = useT()
  const [activated, setActivated] = React.useState(false)
  if (activated) return <ActiveCardActions card={card} />
  return (
    <IconButton
      className="md:size-6"
      aria-label={t('portal.cards.actions')}
      aria-haspopup="menu"
      tooltip={t('portal.cards.actions')}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.stopPropagation()
        setActivated(true)
      }}
    >
      <Ellipsis className="size-4" />
    </IconButton>
  )
}
function ActiveCardActions({ card }: { card: Card }) {
  const t = useT()
  const patch = usePatchCardMutation(),
    remove = useDeleteCardMutation(),
    undo = useDeleteCardMutation(true)
  const pin = useAddFocusMutation(),
    unpin = useRemoveFocusMutation()
  const [convertOpen, setConvertOpen] = React.useState(false)
  const busy = patch.isPending || remove.isPending || pin.isPending || unpin.isPending
  const denied = card.canEdit === false ? t('state.denied.body') : undefined
  function item(
    label: string,
    icon: React.ReactNode,
    action: () => void,
    reason?: string,
    destructive = false,
  ) {
    return (
      <DropdownMenuItem
        aria-disabled={Boolean(reason) || busy}
        title={reason}
        className={`${reason || busy ? 'cursor-not-allowed opacity-40' : ''} ${destructive ? 'text-destructive' : ''}`}
        onSelect={(event) => {
          if (reason || busy) event.preventDefault()
          else action()
        }}
      >
        {icon}
        {label}
      </DropdownMenuItem>
    )
  }
  return (
    <div>
      <DropdownMenu defaultOpen>
        <DropdownMenuTrigger asChild>
          <IconButton
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => event.stopPropagation()}
            className="md:size-6"
            aria-label={t('portal.cards.actions')}
            tooltip={t('portal.cards.actions')}
          >
            <Ellipsis className="size-4" />
          </IconButton>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" onClick={(event) => event.stopPropagation()}>
          {item(
            t(card.focusPinned ? 'work.focus.unpin' : 'work.focus.pin'),
            card.focusPinned ? <PinOff className="size-4" /> : <Pin className="size-4" />,
            () =>
              (card.focusPinned ? unpin : pin).mutate(card.id, {
                onError: () => toast.error(t('work.focus.failed')),
              }),
          )}
          {item(
            t('projectEdit.convert'),
            <FolderPlus className="size-4" />,
            () => setConvertOpen(true),
            denied ?? (card.projectId ? t('cardActions.alreadyGrouped') : undefined),
          )}
          {item(
            t('work.bulk.markDone'),
            <Check className="size-4" />,
            () => patch.mutate({ id: card.id, patch: { status: 'done', version: card.version } }),
            denied ?? (card.status === 'done' ? t('cardActions.alreadyDone') : undefined),
          )}
          {item(
            t('work.action.delete'),
            <Trash2 className="size-4" />,
            () =>
              remove.mutate(card.id, {
                onSuccess: () =>
                  toastWithUndo({
                    message: t('work.deletion.done'),
                    undoLabel: t('action.undo'),
                    durationMs: 20_000,
                    onUndo: () => undo.mutate(card.id),
                  }),
              }),
            denied ?? (card.deletionProtected ? t('cardActions.checkinProtected') : undefined),
            true,
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      {convertOpen ? (
        <ConvertProjectDialog cardId={card.id} open={convertOpen} onOpenChange={setConvertOpen} />
      ) : null}
    </div>
  )
}
