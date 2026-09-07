// Notes (TECH-SPEC §3.3): a calm, pinned/unpinned list, each note a title + free text body that
// autosaves as you type -- with a translate pass (TECH-SPEC §8 `translate`) one click away.
import * as React from 'react'
import { useT, useLocale, LOCALE_LABEL, type Locale } from '@devon/i18n'
import { Check, Pin, PinOff, Plus, Trash2 } from 'lucide-react'
import {
  AiPreviewPanel,
  Button,
  Card,
  EmptyPersonalIllustration,
  IconButton,
  Input,
  Reveal,
  SparkleButton,
  Stagger,
  StaggerItem,
  StateView,
  cn,
  toastWithUndo,
} from '@devon/ui'
import { useRunAiFeatureMutation } from '../ai/use-ai.js'
import { aiCostLine, aiErrorMessageKey } from './lib/ai-helpers.js'
import { Textarea } from './components/form-controls.js'
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

/** The "other" locale to offer a one-click translation into -- Uzbek notes translate to Russian and
 * vice-versa, since that is the pairing a civil servant in this instance actually needs; a full
 * locale picker would be one more decision for a feature that is meant to be a single click. */
const TRANSLATE_TARGET: Record<Locale, Locale> = {
  'uz-Latn': 'ru',
  'uz-Cyrl': 'ru',
  ru: 'uz-Latn',
  en: 'uz-Latn',
}

type TranslateAiState =
  | { status: 'pending' }
  | { status: 'ready'; text: string; targetLocale: Locale; costLine: string }
  | { status: 'error'; message: string }

function NoteCard({ note, onDelete }: { note: Note; onDelete: () => void }) {
  const t = useT()
  const locale = useLocale()
  const patchNote = usePatchNoteMutation()
  const translate = useRunAiFeatureMutation('translate')
  const [title, setTitle] = React.useState(note.title)
  const [text, setText] = React.useState(note.body.text)
  const [saveState, setSaveState] = React.useState<'idle' | 'saving' | 'saved'>('idle')
  const [translateAi, setTranslateAi] = React.useState<TranslateAiState | null>(null)
  React.useEffect(() => setTitle(note.title), [note.title])
  React.useEffect(() => setText(note.body.text), [note.body.text])

  function saveBody(value: string) {
    if (value === note.body.text) return
    setSaveState('saving')
    patchNote.mutate(
      { id: note.id, input: { body: { text: value }, version: note.version } },
      {
        onSuccess: () => {
          setSaveState('saved')
          setTimeout(() => setSaveState((s) => (s === 'saved' ? 'idle' : s)), 2000)
        },
        onError: () => setSaveState('idle'),
      },
    )
  }

  const debouncedSaveText = useDebouncedCallback(saveBody, 600)
  const targetLocale = TRANSLATE_TARGET[locale]

  function runTranslate() {
    if (!text.trim()) return
    setTranslateAi({ status: 'pending' })
    translate.mutate(
      { locale: targetLocale, sourceLocale: locale, text },
      {
        onSuccess: (res) => {
          const translated = String(res.data['translatedText'] ?? '').trim()
          setTranslateAi({
            status: 'ready',
            text: translated || text,
            targetLocale,
            costLine: aiCostLine(t, res.meta),
          })
        },
        onError: (err) => setTranslateAi({ status: 'error', message: t(aiErrorMessageKey(err)) }),
      },
    )
  }

  return (
    <Card
      padding="md"
      className={cn('flex flex-col gap-2', note.pinned && 'border-attention/40 bg-attention/5')}
    >
      <div className="flex items-start justify-between gap-2">
        <Input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={() => {
            if (title.trim() && title !== note.title)
              patchNote.mutate({
                id: note.id,
                input: { title: title.trim(), version: note.version },
              })
          }}
          className="h-8 flex-1 border-none bg-transparent px-1 font-medium shadow-none focus-visible:ring-0"
        />
        <div className="flex shrink-0 items-center gap-1">
          <IconButton
            aria-label={t(note.pinned ? 'personal.notes.unpin' : 'personal.notes.pin')}
            onClick={() =>
              patchNote.mutate({
                id: note.id,
                input: { pinned: !note.pinned, version: note.version },
              })
            }
          >
            {note.pinned ? (
              <PinOff className="size-4 text-attention" aria-hidden="true" />
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
        onBlur={() => saveBody(text)}
        rows={5}
        placeholder={t('personal.notes.bodyPlaceholder')}
        className="min-h-24 w-full resize-y rounded-sm border border-transparent bg-transparent px-1 py-1 text-body text-foreground placeholder:text-muted-foreground focus-visible:border-border focus-visible:outline-none"
      />
      <div className="flex items-center justify-between gap-2">
        <SparkleButton
          aria-label={t('personal.ai.translate.action', { locale: LOCALE_LABEL[targetLocale] })}
          label={t('personal.ai.translate.action', { locale: LOCALE_LABEL[targetLocale] })}
          size="sm"
          loading={translateAi?.status === 'pending'}
          disabled={!text.trim()}
          onClick={runTranslate}
        />
        <span
          aria-live="polite"
          className="flex items-center gap-1 text-caption text-muted-foreground transition-opacity duration-(--dur-standard)"
          style={{ opacity: saveState === 'idle' ? 0 : 1 }}
        >
          {saveState === 'saving' ? (
            t('personal.notes.autosave.saving')
          ) : (
            <>
              <Check className="size-3 text-success" aria-hidden="true" />
              {t('personal.notes.autosave.saved')}
            </>
          )}
        </span>
      </div>

      {translateAi ? (
        <Reveal>
          <AiPreviewPanel
            title={t('personal.ai.translate.title', { locale: LOCALE_LABEL[targetLocale] })}
            status={translateAi.status}
            pendingLabel={t('personal.ai.pending')}
            acceptLabel={t('personal.ai.accept')}
            editLabel={t('personal.ai.edit')}
            discardLabel={t('personal.ai.discard')}
            {...(translateAi.status === 'error' ? { errorMessage: translateAi.message } : {})}
            {...(translateAi.status === 'ready' ? { costLine: translateAi.costLine } : {})}
            onAccept={() => {
              if (translateAi.status !== 'ready') return
              setText(translateAi.text)
              saveBody(translateAi.text)
              setTranslateAi(null)
            }}
            onDiscard={() => setTranslateAi(null)}
            onEdit={() => {
              if (translateAi.status === 'ready') {
                setText(translateAi.text)
                debouncedSaveText(translateAi.text)
              }
              setTranslateAi(null)
            }}
          >
            {translateAi.status === 'ready' ? (
              <Textarea value={translateAi.text} readOnly rows={4} />
            ) : null}
          </AiPreviewPanel>
        </Reveal>
      ) : null}
    </Card>
  )
}

export function NotesView() {
  const t = useT()
  const notesQuery = useNotesQuery()
  const createNote = useCreateNoteMutation()
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

  const notes = [...notesQuery.data]
    .filter((n) => !hiddenIds.has(n.id))
    .sort((a, b) => Number(b.pinned) - Number(a.pinned))

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
          illustration={<EmptyPersonalIllustration />}
          action={{
            labelKey: 'personal.notes.create',
            onAction: () => createNote.mutate({ title: t('personal.notes.newTitle') }),
          }}
        />
      ) : (
        <Stagger className="grid grid-cols-1 gap-3 sm:grid-cols-2" animateKey={notes.length}>
          {notes.map((note) => (
            <StaggerItem key={note.id}>
              <NoteCard note={note} onDelete={() => scheduleDelete(note)} />
            </StaggerItem>
          ))}
        </Stagger>
      )}
    </div>
  )
}
