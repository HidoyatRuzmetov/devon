import { useT } from '@devon/i18n'
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  IconButton,
  toast,
} from '@devon/ui'
import { ChevronDown, Pin, PinOff } from 'lucide-react'
import { useDepartment, useMeQuery } from '../../../lib/session.js'
import type { Card, MemberSummary } from '../api.js'
import { useAddFocusMutation, usePersonPinMutation, useRemoveFocusMutation } from '../hooks-plus.js'

export function CardPinButton({
  card,
  members,
}: {
  card: Card
  members: readonly MemberSummary[]
}) {
  const t = useT()
  const { department } = useDepartment()
  const viewerId = useMeQuery().data?.user.id
  const pin = useAddFocusMutation()
  const unpin = useRemoveFocusMutation()
  const personPin = usePersonPinMutation(card.assigneeUserId ?? '')
  const pinned = card.focusPinned === true
  const busy = pin.isPending || unpin.isPending || personPin.isPending
  const onError = () => toast.error(t('work.focus.failed'))
  const ownToggle = () => (pinned ? unpin : pin).mutate(card.id, { onError })
  const assignee = members.find((member) => member.userId === card.assigneeUserId)
  if (department?.role !== 'head' || !assignee || card.assigneeUserId === viewerId)
    return (
      <IconButton
        aria-label={t(pinned ? 'work.focus.unpin' : 'work.focus.pin')}
        tooltip={t(pinned ? 'work.focus.unpin' : 'work.focus.pin')}
        aria-pressed={pinned}
        disabled={busy}
        className={pinned ? 'bg-accent text-primary' : 'text-muted-foreground'}
        onClick={ownToggle}
      >
        {pinned ? <PinOff aria-hidden="true" /> : <Pin aria-hidden="true" />}
      </IconButton>
    )
  const name = `${assignee.givenName} ${assignee.familyName}`
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          disabled={busy}
          aria-label={t('personWork.pinOptions')}
          className={
            card.assigneePinned || pinned
              ? 'gap-1 bg-accent px-2 text-primary'
              : 'gap-1 px-2 text-muted-foreground'
          }
        >
          <Pin className="size-4" aria-hidden="true" />
          <ChevronDown className="size-3" aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem
          onSelect={() =>
            personPin.mutate({ cardId: card.id, pinned: !card.assigneePinned }, { onError })
          }
        >
          {card.assigneePinned ? <PinOff className="size-4" /> : <Pin className="size-4" />}
          {t(card.assigneePinned ? 'personWork.unpinFor' : 'personWork.pinFor', { name })}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={ownToggle}>
          {pinned ? <PinOff className="size-4" /> : <Pin className="size-4" />}
          {t(pinned ? 'personWork.unpinForMe' : 'personWork.pinForMe')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
