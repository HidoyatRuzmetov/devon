// Notes (TECH-SPEC §3.3): a calm, pinned/unpinned list, each note a title + free text body that
// autosaves as you type -- with a translate pass (TECH-SPEC §8 `translate`) one click away.
import * as React from 'react'
import { useT, useLocale, LOCALE_LABEL, type Locale } from '@devon/i18n'
import { Check, Pin, PinOff, Plus, Trash2 } from 'lucide-react'
import {
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
  toast,
} from '@devon/ui'
import { useRunAiFeatureMutation } from '../ai/use-ai.js'
import { AiResultPanel } from '../ai/components/ai-result-panel.js'
import { TranslatePreview } from '../ai/components/previews.js'
import { TranslateTargetPicker, defaultTranslateTarget } from '../ai/components/translate-target.js'
import { parseFeatureOutput, type TranslateOutput } from '../ai/outputs.js'
import type { RunMeta } from '../ai/types.js'
import { aiErrorMessageKey } from './lib/ai-helpers.js'
import {
  useCreateNoteMutation,
  useDeleteNoteMutation,
  useNotesQuery,
  usePatchNoteMutation,
} from './use-personal.js'
import type { Note, PatchNoteInput } from './types.js'
import { useQueuedSave } from './lib/use-queued-save.js'

/** The "other" locale to offer a one-click translation into -- Uzbek notes translate to Russian and
 * vice-versa, since that is the pairing a civil servant in this instance actually needs; a full
 * locale picker would be one more decision for a feature that is meant to be a single click. */
type TranslateAiState =
  | { status: 'pending' }
  | { status: 'ready'; output: TranslateOutput; meta: RunMeta | null; targetLocale: Locale }
  | { status: 'error'; message: string }

function NoteCard({
  note,
  onDelete,
  deletePending,
}: {
  note: Note
  onDelete: () => void
  deletePending: boolean
}) {
  const t = useT()
  const locale = useLocale()
  const patchNote = usePatchNoteMutation()
  const translate = useRunAiFeatureMutation('translate')
  const [title, setTitle] = React.useState(note.title)
  const [text, setText] = React.useState(note.body.text)
  const titleDraft = React.useRef(note.title)
  const bodyDraft = React.useRef(note.body.text)
  const titleDirty = React.useRef(false)
  const bodyDirty = React.useRef(false)
  const titleVersion = React.useRef(note.version)
  const bodyVersion = React.useRef(note.version)
  const bodyTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const [titleError, setTitleError] = React.useState(false)
  const queuedSave = useQueuedSave<Note, PatchNoteInput>(
    note,
    (input) => patchNote.mutateAsync({ id: note.id, input }),
    (_updated, patch) => {
      if (patch.title !== undefined && titleDraft.current.trim() === patch.title)
        titleDirty.current = false
      if (patch.body !== undefined && bodyDraft.current === patch.body.text)
        bodyDirty.current = false
    },
  )
  const [translateAi, setTranslateAi] = React.useState<TranslateAiState | null>(null)
  // AI-AUDIT §5 fix 1: the target language is asked, not assumed. v1.0's notes screen was the one
  // caller that got this even roughly right, via a hard-coded "from Uzbek always to Russian" map --
  // which is still a guess, and still wrong for anyone who wanted English.
  const [targetLocale, setTargetLocale] = React.useState<Locale>(() =>
    defaultTranslateTarget(locale),
  )
  React.useEffect(() => {
    if (!titleDirty.current) {
      titleDraft.current = note.title
      setTitle(note.title)
    }
  }, [note.title])
  React.useEffect(() => {
    if (!bodyDirty.current) {
      bodyDraft.current = note.body.text
      setText(note.body.text)
    }
  }, [note.body.text])

  function saveDraft(extra: Omit<PatchNoteInput, 'version'> = {}, retry = false) {
    if (bodyTimer.current) clearTimeout(bodyTimer.current)
    bodyTimer.current = null
    const input: Omit<PatchNoteInput, 'version'> = { ...extra }
    if (titleDirty.current) {
      if (!titleDraft.current.trim()) {
        setTitleError(true)
        return Promise.resolve(false)
      }
      input.title = titleDraft.current.trim()
    }
    if (bodyDirty.current) input.body = { text: bodyDraft.current }
    if (retry) {
      titleVersion.current = note.version
      bodyVersion.current = note.version
    }
    const versions = [note.version]
    if (titleDirty.current) versions.push(titleVersion.current)
    if (bodyDirty.current) versions.push(bodyVersion.current)
    return retry ? queuedSave.retry(input) : queuedSave.enqueue(input, Math.min(...versions))
  }
  const saveDraftRef = React.useRef(saveDraft)
  React.useLayoutEffect(() => {
    saveDraftRef.current = saveDraft
  })
  React.useEffect(
    () => () => {
      if (bodyTimer.current) clearTimeout(bodyTimer.current)
      if (titleDirty.current || bodyDirty.current) void saveDraftRef.current()
    },
    [],
  )

  function updateBody(value: string, debounce = true) {
    if (!bodyDirty.current) bodyVersion.current = note.version
    bodyDraft.current = value
    bodyDirty.current = true
    setText(value)
    if (bodyTimer.current) clearTimeout(bodyTimer.current)
    if (debounce)
      bodyTimer.current = setTimeout(() => {
        void saveDraftRef.current()
      }, 600)
  }

  function runTranslate() {
    if (!text.trim()) return
    setTranslateAi({ status: 'pending' })
    translate.mutate(
      {
        // `locale` is the READER's language (it only shapes how uncertainty is phrased);
        // `targetLocale` is what the text is translated into. v1.0 conflated the two, which is the
        // whole of AI-AUDIT §0.1.
        locale,
        targetLocale,
        sourceLocale: null,
        text,
        glossary: [],
        preserve: [],
      },
      {
        onSuccess: (res) => {
          const output = parseFeatureOutput<TranslateOutput>('translate', res.data)
          if (!output) {
            setTranslateAi({ status: 'error', message: t('ai.errors.runFailed') })
            return
          }
          setTranslateAi({ status: 'ready', output, meta: res.meta, targetLocale })
        },
        onError: (err) => setTranslateAi({ status: 'error', message: t(aiErrorMessageKey(err)) }),
      },
    )
  }

  return (
    <Card
      padding="md"
      data-personal-note-id={note.id}
      className={cn('flex flex-col gap-2', note.pinned && 'border-attention/40 bg-attention/5')}
    >
      <div className="flex items-start justify-between gap-2">
        <Input
          aria-label={t('personal.notes.title')}
          value={title}
          maxLength={300}
          aria-invalid={titleError || undefined}
          aria-describedby={titleError ? `note-title-error-${note.id}` : undefined}
          onChange={(e) => {
            if (!titleDirty.current) titleVersion.current = note.version
            titleDraft.current = e.target.value
            titleDirty.current = true
            setTitle(e.target.value)
            if (e.target.value.trim()) setTitleError(false)
          }}
          onBlur={() => void saveDraft()}
          className="h-auto min-h-8 min-w-0 flex-1 border-none bg-transparent px-1 py-1 font-medium shadow-none focus-visible:ring-0"
        />
        <div className="flex shrink-0 items-center gap-1">
          <IconButton
            aria-label={t(note.pinned ? 'personal.notes.unpin' : 'personal.notes.pin')}
            disabled={queuedSave.isPending}
            onClick={() => void saveDraft({ pinned: !note.pinned })}
          >
            {note.pinned ? (
              <PinOff className="size-4 text-attention" aria-hidden="true" />
            ) : (
              <Pin className="size-4" aria-hidden="true" />
            )}
          </IconButton>
          <IconButton
            aria-label={t('personal.notes.delete')}
            disabled={deletePending}
            aria-busy={deletePending}
            onClick={onDelete}
          >
            <Trash2 className="size-4" aria-hidden="true" />
          </IconButton>
        </div>
      </div>
      {titleError ? (
        <p id={`note-title-error-${note.id}`} role="alert" className="text-small text-destructive">
          {t('personal.save.titleRequired')}
        </p>
      ) : null}
      <textarea
        aria-label={t('personal.notes.body')}
        value={text}
        onChange={(e) => updateBody(e.target.value)}
        onBlur={() => void saveDraft()}
        rows={5}
        placeholder={t('personal.notes.bodyPlaceholder')}
        className="min-h-24 w-full resize-y rounded-sm border border-transparent bg-transparent px-1 py-1 text-body text-foreground placeholder:text-muted-foreground focus-visible:border-border focus-visible:outline-none"
      />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 max-w-full flex-wrap items-center gap-2">
          <TranslateTargetPicker
            id={`note-translate-target-${note.id}`}
            value={targetLocale}
            onChange={setTargetLocale}
            disabled={translateAi?.status === 'pending'}
          />
          <SparkleButton
            aria-label={t('personal.ai.translate.action', { locale: LOCALE_LABEL[targetLocale] })}
            label={t('personal.ai.translate.action', { locale: LOCALE_LABEL[targetLocale] })}
            size="sm"
            loading={translateAi?.status === 'pending'}
            disabled={!text.trim()}
            onClick={runTranslate}
            className="h-auto min-h-9 max-w-full whitespace-normal py-2 [&>span]:whitespace-normal [&>span]:text-left"
          />
        </div>
        <span
          aria-live="polite"
          className="flex items-center gap-1 text-caption text-muted-foreground transition-opacity duration-(--dur-standard)"
          style={{
            opacity:
              queuedSave.state === 'idle' ||
              queuedSave.state === 'error' ||
              queuedSave.state === 'conflict'
                ? 0
                : 1,
          }}
        >
          {queuedSave.isPending ? (
            t('personal.notes.autosave.saving')
          ) : (
            <>
              <Check className="size-3 text-success" aria-hidden="true" />
              {t('personal.notes.autosave.saved')}
            </>
          )}
        </span>
      </div>
      {queuedSave.state === 'error' || queuedSave.state === 'conflict' ? (
        <div className="flex flex-wrap items-center gap-2">
          <p role="alert" className="text-small text-destructive">
            {t(queuedSave.state === 'conflict' ? 'personal.save.conflict' : 'personal.save.error')}
          </p>
          <Button size="sm" variant="secondary" onClick={() => void saveDraft({}, true)}>
            {t('personal.save.retry')}
          </Button>
        </div>
      ) : null}

      {translateAi ? (
        <Reveal>
          <AiResultPanel
            title={t('personal.ai.translate.title', { locale: LOCALE_LABEL[targetLocale] })}
            status={translateAi.status}
            {...(translateAi.status === 'error' ? { errorMessage: translateAi.message } : {})}
            {...(translateAi.status === 'ready' && translateAi.meta
              ? { meta: translateAi.meta }
              : {})}
            acceptLabel={t('personal.ai.accept')}
            editLabel={t('personal.ai.edit')}
            onAccept={() => {
              if (translateAi.status !== 'ready') return
              updateBody(translateAi.output.translatedText, false)
              void saveDraft().then((saved) => {
                if (saved) setTranslateAi(null)
              })
            }}
            onDiscard={() => setTranslateAi(null)}
            onEdit={() => {
              if (translateAi.status === 'ready') {
                updateBody(translateAi.output.translatedText)
              }
              setTranslateAi(null)
            }}
          >
            {translateAi.status === 'ready' ? (
              <TranslatePreview output={translateAi.output} />
            ) : null}
          </AiResultPanel>
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

  const notes = [...notesQuery.data].sort((a, b) => Number(b.pinned) - Number(a.pinned))

  function scheduleDelete(note: Note) {
    if (!deleteNoteMutation.isPending) deleteNoteMutation.mutate(note.id)
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end">
        <Button
          size="sm"
          onClick={() =>
            createNote.mutate(
              { title: t('personal.notes.newTitle') },
              { onError: () => toast.error(t('toast.saveError')) },
            )
          }
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
            onAction: () =>
              createNote.mutate(
                { title: t('personal.notes.newTitle') },
                { onError: () => toast.error(t('toast.saveError')) },
              ),
          }}
        />
      ) : (
        <Stagger className="grid grid-cols-1 gap-3 sm:grid-cols-2" animateKey={notes.length}>
          {notes.map((note) => (
            <StaggerItem key={note.id}>
              <NoteCard
                note={note}
                onDelete={() => scheduleDelete(note)}
                deletePending={deleteNoteMutation.isPending}
              />
            </StaggerItem>
          ))}
        </Stagger>
      )}
    </div>
  )
}
