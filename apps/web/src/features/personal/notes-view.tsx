// Notes (TECH-SPEC §3.3): a simple pinned/unpinned list, each note a title + free text body.
import * as React from 'react'
import { useT } from '@devon/i18n'
import { Pin, PinOff, Plus, Trash2 } from 'lucide-react'
import { Button, IconButton, Input, StateView, toastWithUndo } from '@devon/ui'
import {
  useCreateNoteMutation,
  useDelayedDelete,
  useDeleteNoteMutation,
  useNotesQuery,
  usePatchNoteMutation,
} from './use-personal.js'
import type { Note } from './types.js'

function useDebouncedCallback<A extends unknown[]>(fn: (...args: A) => void, delayMs: number) {
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  return React.useCallback(
    (...args: A) => {
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(() => fn(...args), delayMs)
    },
    [fn, delayMs],
  )
}

function NoteCard({
  note,
  onPatch,
  onDelete,
}: {
  note: Note
  onPatch: (input: {
    title?: string
    body?: { text: string }
    pinned?: boolean
    version: number
  }) => void
  onDelete: () => void
}) {
  const t = useT()
  const [title, setTitle] = React.useState(note.title)
  const [text, setText] = React.useState(note.body.text)
  React.useEffect(() => setTitle(note.title), [note.title])
  React.useEffect(() => setText(note.body.text), [note.body.text])

  const debouncedSaveText = useDebouncedCallback((value: string) => {
    if (value !== note.body.text) onPatch({ body: { text: value }, version: note.version })
  }, 600)

  return (
    <div className="flex flex-col gap-2 rounded-md border border-border bg-card p-4">
      <div className="flex items-start justify-between gap-2">
        <Input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={() => {
            if (title.trim() && title !== note.title)
              onPatch({ title: title.trim(), version: note.version })
          }}
          className="h-8 flex-1 border-none bg-transparent px-1 font-medium shadow-none focus-visible:ring-0"
        />
        <div className="flex shrink-0 gap-1">
          <IconButton
            aria-label={t(note.pinned ? 'personal.notes.unpin' : 'personal.notes.pin')}
            onClick={() => onPatch({ pinned: !note.pinned, version: note.version })}
          >
            {note.pinned ? (
              <PinOff className="size-4" aria-hidden="true" />
            ) : (
              <Pin className="size-4" aria-hidden="true" />
            )}
          </IconButton>
          <IconButton aria-label={t('personal.notes.delete')} onClick={onDelete}>
            <Trash2 className="size-4" aria-hidden="true" />
          </IconButton>
        </div>
      </div>
      <textarea
        value={text}
        onChange={(e) => {
          setText(e.target.value)
          debouncedSaveText(e.target.value)
        }}
        rows={5}
        placeholder={t('personal.notes.bodyPlaceholder')}
        className="min-h-24 w-full resize-y rounded-sm border border-transparent bg-transparent px-1 py-1 text-body text-foreground placeholder:text-muted-foreground focus-visible:border-border focus-visible:outline-none"
      />
    </div>
  )
}

export function NotesView() {
  const t = useT()
  const notesQuery = useNotesQuery()
  const createNote = useCreateNoteMutation()
  const patchNote = usePatchNoteMutation()
  const deleteNoteMutation = useDeleteNoteMutation()
  const { schedule, cancel } = useDelayedDelete((id) => deleteNoteMutation.mutateAsync(id))
  const [hiddenIds, setHiddenIds] = React.useState<Set<string>>(new Set())

  if (notesQuery.isPending) return <StateView kind="loading" titleKey="state.loading" />
  if (notesQuery.isError) {
    return (
      <StateView
        kind="error"
        titleKey="state.error.title"
        bodyKey="state.error.body"
        action={{ labelKey: 'state.error.action', onAction: () => notesQuery.refetch() }}
      />
    )
  }

  const notes = notesQuery.data.filter((n) => !hiddenIds.has(n.id))

  function scheduleDelete(note: Note) {
    setHiddenIds((prev) => new Set(prev).add(note.id))
    schedule(note.id)
    toastWithUndo({
      message: t('personal.notes.deleted.toast'),
      undoLabel: t('action.undo'),
      onUndo: () => {
        cancel(note.id)
        setHiddenIds((prev) => {
          const next = new Set(prev)
          next.delete(note.id)
          return next
        })
      },
    })
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end">
        <Button
          size="sm"
          onClick={() => createNote.mutate({ title: t('personal.notes.newTitle') })}
          loading={createNote.isPending}
        >
          <Plus className="size-4" aria-hidden="true" />
          {t('personal.notes.create')}
        </Button>
      </div>

      {notes.length === 0 ? (
        <StateView
          kind="empty"
          titleKey="personal.notes.empty.title"
          bodyKey="personal.notes.empty.body"
          action={{
            labelKey: 'personal.notes.create',
            onAction: () => createNote.mutate({ title: t('personal.notes.newTitle') }),
          }}
        />
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {notes.map((note) => (
            <NoteCard
              key={note.id}
              note={note}
              onPatch={(input) => patchNote.mutate({ id: note.id, input })}
              onDelete={() => scheduleDelete(note)}
            />
          ))}
        </div>
      )}
    </div>
  )
}
