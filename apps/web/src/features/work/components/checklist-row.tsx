import { useT } from '@devon/i18n'
import { Checkbox, IconButton, Input, Strikethrough } from '@devon/ui'
import { Check, X } from 'lucide-react'
import * as React from 'react'
import { ChecklistActionsMenu } from './checklist-actions-menu.js'
import { ChecklistDiscussion } from './checklist-discussion.js'

type SaveResult = Promise<unknown>

export function ChecklistRow({
  cardId,
  item,
  canEdit,
  onToggle,
  onSave,
  onDelete,
  checkin,
}: {
  cardId: string
  item: {
    id: string
    text: string
    doneAt: string | null
    textLocked?: boolean | undefined
    deletionProtected?: boolean | undefined
    commentCount?: number | undefined
  }
  canEdit: boolean
  onToggle: (done: boolean) => void
  onSave: (text: string) => SaveResult
  onDelete: () => void
  checkin?:
    | { selected: boolean; disabled: boolean; reason?: string | undefined; toggle: () => void }
    | undefined
}) {
  const t = useT()
  const checkboxId = React.useId()
  const [editing, setEditing] = React.useState(false)
  const [draft, setDraft] = React.useState(item.text)
  const [saving, setSaving] = React.useState(false)
  const linkedThread = () => window.location.hash.startsWith(`#checklist-${item.id}-comment-`)
  const [commentsOpen, setCommentsOpen] = React.useState(linkedThread)
  const [commentsActivated, setCommentsActivated] = React.useState(linkedThread)
  React.useEffect(() => {
    function followLink() {
      if (!window.location.hash.startsWith(`#checklist-${item.id}-comment-`)) return
      setCommentsActivated(true)
      setCommentsOpen(true)
    }
    followLink()
    window.addEventListener('hashchange', followLink)
    return () => window.removeEventListener('hashchange', followLink)
  }, [item.id])
  async function save() {
    if (!draft.trim() || saving) return
    setSaving(true)
    try {
      await onSave(draft.trim())
      setEditing(false)
    } catch {
      // The mutation hook reports failure once; keep this draft open for correction/retry.
    } finally {
      setSaving(false)
    }
  }
  return (
    <div className="checklist-item" data-checklist-id={item.id}>
      <div className="flex min-h-8 items-center gap-2 rounded-sm px-1 py-1 hover:bg-accent/60">
        <Checkbox
          id={checkboxId}
          checked={item.doneAt !== null}
          disabled={!canEdit}
          onCheckedChange={(v) => onToggle(v === true)}
          celebrate
          size="sm"
          aria-label={item.text}
        />
        {editing ? (
          <form
            className="flex min-w-0 flex-1 items-center gap-1"
            onSubmit={(e) => {
              e.preventDefault()
              void save()
            }}
          >
            <Input
              autoFocus
              aria-label={t('work.card.editChecklistItem')}
              value={draft}
              disabled={saving}
              maxLength={500}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  e.preventDefault()
                  e.stopPropagation()
                  setEditing(false)
                }
              }}
            />
            <IconButton
              type="submit"
              aria-label={t('work.card.saveChecklistItem')}
              tooltip={t('work.card.saveChecklistItem')}
              disabled={saving || !draft.trim()}
            >
              <Check className="size-3.5" />
            </IconButton>
            <IconButton
              type="button"
              aria-label={t('work.card.cancelChecklistEdit')}
              tooltip={t('work.card.cancelChecklistEdit')}
              disabled={saving}
              onClick={() => setEditing(false)}
            >
              <X className="size-3.5" />
            </IconButton>
          </form>
        ) : (
          <>
            <label
              htmlFor={checkboxId}
              className="min-w-0 flex-1 cursor-pointer break-words text-small text-foreground"
            >
              <Strikethrough done={item.doneAt !== null}>{item.text}</Strikethrough>
            </label>
            <ChecklistActionsMenu
              text={item.text}
              commentCount={item.commentCount}
              onComments={() => {
                setCommentsActivated(true)
                setCommentsOpen(true)
              }}
              onEdit={() => {
                setDraft(item.text)
                setEditing(true)
              }}
              onDelete={onDelete}
              editReason={
                !canEdit
                  ? t('state.denied.body')
                  : item.textLocked
                    ? t('checklistDiscussion.textLocked')
                    : undefined
              }
              deleteReason={
                !canEdit
                  ? t('state.denied.body')
                  : item.deletionProtected
                    ? t('cardActions.checkinProtected')
                    : undefined
              }
              checkin={
                checkin
                  ? {
                      ...checkin,
                      disabled: !canEdit || checkin.disabled,
                      reason: !canEdit ? t('state.denied.body') : checkin.reason,
                    }
                  : undefined
              }
            />
          </>
        )}
      </div>
      {commentsActivated ? (
        <ChecklistDiscussion
          cardId={cardId}
          itemId={item.id}
          itemText={item.text}
          open={commentsOpen}
          onClose={() => setCommentsOpen(false)}
        />
      ) : null}
    </div>
  )
}
