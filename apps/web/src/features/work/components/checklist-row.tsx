import * as React from 'react'
import { useT } from '@devon/i18n'
import { Checkbox, IconButton, Input, Strikethrough } from '@devon/ui'
import { Check, Pencil, Trash2, X } from 'lucide-react'

type SaveResult = Promise<unknown>

export function ChecklistRow({
  item,
  canEdit,
  onToggle,
  onSave,
  onDelete,
}: {
  item: { id: string; text: string; doneAt: string | null }
  canEdit: boolean
  onToggle: (done: boolean) => void
  onSave: (text: string) => SaveResult
  onDelete: () => void
}) {
  const t = useT()
  const checkboxId = React.useId()
  const [editing, setEditing] = React.useState(false)
  const [draft, setDraft] = React.useState(item.text)
  const [saving, setSaving] = React.useState(false)
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
    <div
      className="flex items-center gap-2 rounded-sm px-1 py-1 hover:bg-accent"
      data-checklist-id={item.id}
    >
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
          {canEdit ? (
            <>
              <IconButton
                aria-label={t('work.card.editChecklistItem')}
                tooltip={t('work.card.editChecklistItem')}
                onClick={() => {
                  setDraft(item.text)
                  setEditing(true)
                }}
              >
                <Pencil className="size-3.5" />
              </IconButton>
              <IconButton
                aria-label={t('work.action.delete')}
                tooltip={t('work.action.delete')}
                onClick={onDelete}
              >
                <Trash2 className="size-3.5" />
              </IconButton>
            </>
          ) : null}
        </>
      )}
    </div>
  )
}
