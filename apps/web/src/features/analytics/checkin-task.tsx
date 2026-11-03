import * as React from 'react'
import type { CheckinEntry, CheckinSourceCard } from '@devon/contracts'
import { useT } from '@devon/i18n'
import { IconButton, Input, toast } from '@devon/ui'
import { Check, ListTodo, Pencil, Plus, Trash2, X } from 'lucide-react'
import {
  useAddChecklistItemMutation,
  usePatchCardMutation,
  usePatchChecklistItemMutation,
  useDeleteChecklistItemMutation,
} from '../work/hooks.js'
import { openCardPeek } from '../work/lib/open-card-peek.js'
import { useCheckinChange } from './checkins-api.js'
import type { CheckinTask } from './checkin-layout.js'

type SourceItem = CheckinSourceCard['checklist'][number]
function TextEdit({
  value,
  label,
  maxLength = 500,
  onSave,
  onCancel,
}: {
  value: string
  label: string
  maxLength?: number
  onSave: (value: string) => Promise<unknown>
  onCancel: () => void
}) {
  const [draft, setDraft] = React.useState(value),
    [saving, setSaving] = React.useState(false)
  const t = useT()
  return (
    <form
      className="checkin-inline-edit"
      onSubmit={async (e) => {
        e.preventDefault()
        if (!draft.trim() || saving) return
        setSaving(true)
        try {
          await onSave(draft.trim())
          onCancel()
        } catch {
          toast.error(t('checkins.saveError'))
        } finally {
          setSaving(false)
        }
      }}
    >
      <Input
        autoFocus
        value={draft}
        maxLength={maxLength}
        aria-label={label}
        disabled={saving}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault()
            e.stopPropagation()
            onCancel()
          }
        }}
      />
      <IconButton type="submit" aria-label={t('checkins.save')} disabled={saving || !draft.trim()}>
        <Check />
      </IconButton>
      <IconButton
        type="button"
        aria-label={t('checkins.cancel')}
        disabled={saving}
        onClick={onCancel}
      >
        <X />
      </IconButton>
    </form>
  )
}

function TaskRow({
  cardId,
  source,
  entry,
  editing,
  chosen,
  protectedChoice,
  canEdit,
  closed,
  onChoose,
}: {
  cardId: string
  source: SourceItem | undefined
  entry: CheckinEntry | undefined
  editing: boolean
  chosen: boolean
  protectedChoice: boolean
  canEdit: boolean
  closed: boolean
  onChoose: () => void
}) {
  const t = useT(),
    change = useCheckinChange(),
    patch = usePatchChecklistItemMutation(cardId),
    remove = useDeleteChecklistItemMutation(cardId)
  const [renaming, setRenaming] = React.useState(false)
  const text = source?.text ?? entry!.text
  const state = entry?.state ?? (source?.doneAt ? 'done' : 'pending')
  const textLocked = source?.textLocked ?? entry?.textLocked ?? false
  return (
    <li className="checkin-row" data-state={state} data-selected={chosen}>
      {editing ? (
        <IconButton
          className="checkin-choice"
          aria-label={t(chosen ? 'checkins.remove' : 'checkins.add')}
          aria-pressed={chosen}
          disabled={protectedChoice || closed}
          onClick={onChoose}
        >
          {chosen ? <Check /> : <Plus />}
        </IconButton>
      ) : null}
      <div className="checkin-row-copy">
        {renaming ? (
          <TextEdit
            value={text}
            label={t('checkins.edit')}
            onCancel={() => setRenaming(false)}
            onSave={(value) =>
              source
                ? patch.mutateAsync({ itemId: source.id, patch: { text: value } })
                : change.mutateAsync({
                    kind: 'update',
                    id: entry!.id,
                    version: entry!.version,
                    text: value,
                  })
            }
          />
        ) : editing ? (
          <button
            className="checkin-row-text"
            disabled={protectedChoice || closed}
            onClick={onChoose}
          >
            {text}
          </button>
        ) : (
          <span className="checkin-row-text">{text}</span>
        )}
      </div>
      {!renaming && canEdit ? (
        <div className="checkin-row-tools">
          <IconButton
            aria-label={t('checkins.edit')}
            disabled={textLocked || closed}
            onClick={() => setRenaming(true)}
          >
            <Pencil />
          </IconButton>
          {editing && source ? (
            <IconButton
              aria-label={t('work.action.delete')}
              disabled={source.deletionProtected || remove.isPending || closed}
              onClick={() =>
                remove.mutate(source.id, { onError: () => toast.error(t('checkins.saveError')) })
              }
            >
              <Trash2 />
            </IconButton>
          ) : null}
        </div>
      ) : null}
      {chosen ? (
        <select
          className="checkin-row-status"
          aria-label={t('checkins.statusFor', { item: text })}
          value={state}
          disabled={closed || change.isPending || !entry}
          onChange={(e) => {
            if (entry)
              change.mutate({
                kind: 'update',
                id: entry.id,
                version: entry.version,
                state: e.target.value as CheckinEntry['state'],
              })
          }}
        >
          {(['pending', 'blocked', 'done'] as const).map((s) => (
            <option key={s} value={s}>
              {t(`checkins.state.${s}`)}
            </option>
          ))}
        </select>
      ) : null}
    </li>
  )
}

export function CheckinTaskView({
  task,
  editing,
  selected,
  locked,
  closed,
  choose,
}: {
  task: CheckinTask
  editing: boolean
  selected: (id: string) => boolean
  locked: boolean
  closed: boolean
  choose: (id: string) => void
}) {
  const t = useT(),
    patch = usePatchCardMutation(),
    add = useAddChecklistItemMutation(task.id)
  const [renaming, setRenaming] = React.useState(false),
    [adding, setAdding] = React.useState(false)
  const entries = new Map(task.entries.map((e) => [e.checklistItemId, e]))
  const sources = new Map(task.checklist.map((i) => [i.id, i]))
  const ids = editing ? [...new Set([...sources.keys(), ...entries.keys()])] : [...entries.keys()]
  return (
    <section className="checkin-task" data-muted={editing && !ids.some(selected)}>
      {task.sourceAvailable ? (
        <button
          className="checkin-task-open"
          aria-label={task.title}
          onClick={() => openCardPeek(task.id)}
        />
      ) : null}
      <header className="checkin-task-heading">
        <ListTodo className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        {renaming ? (
          <TextEdit
            value={task.title}
            maxLength={300}
            label={t('checkins.editTask')}
            onCancel={() => setRenaming(false)}
            onSave={(title) =>
              patch.mutateAsync({ id: task.id, patch: { title, version: task.version } })
            }
          />
        ) : (
          <button
            className="checkin-task-title"
            disabled={!task.sourceAvailable}
            onClick={() => openCardPeek(task.id)}
          >
            {task.title}
          </button>
        )}
        {!renaming && task.canEdit && !closed ? (
          <IconButton
            className="checkin-title-edit"
            aria-label={t('checkins.editTask')}
            onClick={() => setRenaming(true)}
          >
            <Pencil />
          </IconButton>
        ) : null}
        <select
          className="checkin-priority"
          data-priority={task.priority}
          value={task.priority}
          aria-label={t('checkins.priority')}
          disabled={!task.canEdit || closed || patch.isPending}
          onChange={(e) =>
            patch.mutate({
              id: task.id,
              patch: { priority: e.target.value as CheckinTask['priority'], version: task.version },
            })
          }
        >
          {(['urgent', 'high', 'medium', 'low', 'none'] as const).map((p) => (
            <option key={p} value={p}>
              {t(`checkins.priorityLabel.${p}`)}
            </option>
          ))}
        </select>
      </header>
      <ul className="checkin-rows">
        {ids.map((id) => (
          <TaskRow
            key={id}
            cardId={task.id}
            source={sources.get(id)}
            entry={entries.get(id)}
            editing={editing}
            chosen={selected(id)}
            protectedChoice={locked && entries.has(id)}
            canEdit={task.canEdit && !locked}
            closed={closed}
            onChoose={() => choose(id)}
          />
        ))}
      </ul>
      {editing && task.canEdit && !closed ? (
        <div className="checkin-task-add">
          {adding ? (
            <TextEdit
              value=""
              label={t('checkins.newItem')}
              onCancel={() => setAdding(false)}
              onSave={(text) => add.mutateAsync({ text })}
            />
          ) : (
            <button
              onClick={() => setAdding(true)}
              className="inline-flex items-center gap-2 text-small text-muted-foreground"
            >
              <Plus className="size-4" />
              {t('checkins.newItem')}
            </button>
          )}
        </div>
      ) : null}
    </section>
  )
}
