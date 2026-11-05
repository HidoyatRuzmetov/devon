import * as React from 'react'
import { useT } from '@devon/i18n'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  IconButton,
} from '@devon/ui'
import { ChevronDown, MessageCircle, Minus, Pencil, Plus, Trash2 } from 'lucide-react'

export function ChecklistActionsMenu({
  text,
  onEdit,
  onDelete,
  editReason,
  deleteReason,
  onComments,
  commentCount = 0,
  checkin,
  busy = false,
}: {
  text: string
  onEdit?: (() => void) | undefined
  onDelete?: (() => void) | undefined
  editReason?: string | undefined
  deleteReason?: string | undefined
  onComments?: (() => void) | undefined
  commentCount?: number | undefined
  checkin?:
    | { selected: boolean; disabled: boolean; reason?: string | undefined; toggle: () => void }
    | undefined
  busy?: boolean
}) {
  const t = useT()
  const transfersFocus = React.useRef(false)
  function action(
    label: string,
    icon: React.ReactNode,
    onSelect: () => void,
    reason?: string,
    destructive = false,
    opensEditor = false,
  ) {
    return (
      <DropdownMenuItem
        aria-disabled={!!reason || busy}
        aria-description={reason}
        title={reason}
        className={`${reason || busy ? 'cursor-not-allowed opacity-40' : ''} ${destructive ? 'text-destructive' : ''}`}
        onSelect={(event) => {
          if (reason || busy) event.preventDefault()
          else {
            transfersFocus.current = opensEditor
            onSelect()
          }
        }}
      >
        {icon}
        {label}
      </DropdownMenuItem>
    )
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <IconButton
          className="checklist-actions-trigger h-7 min-w-7 shrink-0 gap-1 px-1"
          aria-label={t('checklistDiscussion.actionsFor', { item: text })}
          tooltip={t('checklistDiscussion.actions')}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
        >
          {commentCount > 0 ? (
            <span className="text-caption tabular-nums">{commentCount}</span>
          ) : null}
          <ChevronDown className="size-3.5" />
        </IconButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        onClick={(event) => event.stopPropagation()}
        onCloseAutoFocus={(event) => {
          // The new inline editor owns focus; restoring it to the menu trigger steals typing.
          if (transfersFocus.current) event.preventDefault()
          transfersFocus.current = false
        }}
      >
        {onComments
          ? action(
              t(
                commentCount > 0
                  ? 'checklistDiscussion.viewComments'
                  : 'checklistDiscussion.addComment',
                { count: commentCount },
              ),
              <MessageCircle className="size-4" />,
              onComments,
              undefined,
              false,
              true,
            )
          : null}
        {onEdit
          ? action(
              t('work.card.editChecklistItem'),
              <Pencil className="size-4" />,
              onEdit,
              editReason,
              false,
              true,
            )
          : null}
        {checkin
          ? action(
              t(checkin.selected ? 'checkins.remove' : 'checkins.add'),
              checkin.selected ? <Minus className="size-4" /> : <Plus className="size-4" />,
              checkin.toggle,
              checkin.disabled
                ? (checkin.reason ?? t('checklistDiscussion.selectionLocked'))
                : undefined,
            )
          : null}
        {onDelete
          ? action(
              t('work.action.delete'),
              <Trash2 className="size-4" />,
              onDelete,
              deleteReason,
              true,
            )
          : null}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
