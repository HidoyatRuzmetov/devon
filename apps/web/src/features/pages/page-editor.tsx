// The Tiptap editor for one page (TECH-SPEC §5: "Tiptap 3.31 with mentions, checklist items,
// callouts, links with unfurled titles"). Autosaves on a short debounce after the document actually
// changes; the title is a plain input above the editor, not part of the Tiptap document itself.
import * as React from 'react'
import { useEditor, useEditorState, EditorContent, type JSONContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import TaskList from '@tiptap/extension-task-list'
import TaskItem from '@tiptap/extension-task-item'
import Placeholder from '@tiptap/extension-placeholder'
import Mention from '@tiptap/extension-mention'
import { useT, useLocale, type Locale } from '@devon/i18n'
import { IconButton, Input, SparkleButton, cn, toast } from '@devon/ui'
import { AiResultPanel } from '../ai/components/ai-result-panel.js'
import { TranslateTargetPicker, defaultTranslateTarget } from '../ai/components/translate-target.js'
import {
  Bold,
  Code2,
  Heading1,
  Heading2,
  Italic,
  List,
  ListChecks,
  ListOrdered,
  MessageSquareQuote,
  Megaphone,
} from 'lucide-react'
import { Callout } from './callout-extension.js'
import { createMentionSuggestion, type MentionCandidate } from './mention-suggestion.js'
import { createSlashCommandExtension, type SlashCommandItem } from './slash-command-extension.js'
import { useRunAiFeatureMutation } from '../ai/use-ai.js'
import { ApiError } from '../../lib/api-client.js'
import type { TiptapNode } from './types.js'

function translateErrorKey(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.code === 'validation_failed') return 'pages.editor.translate.errors.invalid'
    if (err.code === 'forbidden') return 'pages.editor.translate.errors.forbidden'
  }
  return 'pages.editor.translate.errors.failed'
}

export type PageEditorHandle = { getJSON: () => TiptapNode }

function ToolbarButton({
  active,
  labelKey,
  onClick,
  children,
}: {
  active?: boolean
  labelKey: string
  onClick: () => void
  children: React.ReactNode
}) {
  const t = useT()
  return (
    <IconButton
      aria-label={t(labelKey)}
      tooltip={t(labelKey)}
      aria-pressed={active}
      onClick={onClick}
      className={cn(active && 'bg-accent text-accent-foreground')}
    >
      {children}
    </IconButton>
  )
}

export function PageEditor({
  title,
  content,
  editable,
  mentionCandidates,
  onTitleChange,
  onChange,
  onBlur,
  titleErrorId,
}: {
  title: string
  content: TiptapNode
  editable: boolean
  mentionCandidates: MentionCandidate[]
  onTitleChange: (title: string) => void
  onChange: (json: TiptapNode) => void
  onBlur?: () => void
  titleErrorId?: string | undefined
}) {
  const t = useT()
  const candidatesRef = React.useRef(mentionCandidates)
  candidatesRef.current = mentionCandidates
  const tRef = React.useRef(t)
  tRef.current = t

  // The slash menu's item list (UI-OVERHAUL.md §2 "block editor with slash menu"): the same block
  // commands the toolbar already exposes, so typing `/` never offers something a toolbar button
  // could not also do. Built fresh every render (translations can change with the locale) but read
  // through a ref, same convention as `candidatesRef` above -- `createSlashCommandExtension` closes
  // over the ref once, at editor construction, never re-reading `useEditor`'s own extensions list.
  const slashItemsRef = React.useRef<SlashCommandItem[]>([])
  slashItemsRef.current = React.useMemo<SlashCommandItem[]>(
    () => [
      {
        id: 'heading1',
        label: t('pages.editor.toolbar.heading1'),
        run: (e) => e.chain().focus().toggleHeading({ level: 1 }).run(),
      },
      {
        id: 'heading2',
        label: t('pages.editor.toolbar.heading2'),
        run: (e) => e.chain().focus().toggleHeading({ level: 2 }).run(),
      },
      {
        id: 'bulletList',
        label: t('pages.editor.toolbar.bulletList'),
        run: (e) => e.chain().focus().toggleBulletList().run(),
      },
      {
        id: 'orderedList',
        label: t('pages.editor.toolbar.orderedList'),
        run: (e) => e.chain().focus().toggleOrderedList().run(),
      },
      {
        id: 'taskList',
        label: t('pages.editor.toolbar.taskList'),
        run: (e) => e.chain().focus().toggleTaskList().run(),
      },
      {
        id: 'blockquote',
        label: t('pages.editor.toolbar.blockquote'),
        run: (e) => e.chain().focus().toggleBlockquote().run(),
      },
      {
        id: 'codeBlock',
        label: t('pages.editor.toolbar.codeBlock'),
        run: (e) => e.chain().focus().toggleCodeBlock().run(),
      },
      {
        id: 'callout',
        label: t('pages.editor.toolbar.callout'),
        run: (e) => e.chain().focus().toggleCallout('info').run(),
      },
    ],
    [t],
  )
  // Tiptap fires one or more `onUpdate` transactions while extensions attach and normalise the
  // initial `content` document on mount (schema-conformance fixups), before any real keystroke --
  // found live: opening a page with zero edits still PATCHed it and wrote an identical extra version
  // every time. A single "skip the first update" flag was not enough (mount can fire more than one),
  // so this instead ignores every update until a macrotask after creation has actually elapsed --
  // synchronous mount-time churn always finishes well within that tick; a real keystroke never can.
  const readyRef = React.useRef(false)

  const editor = useEditor({
    editable,
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2] } }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Placeholder.configure({ placeholder: t('pages.editor.contentPlaceholder') }),
      Callout,
      Mention.configure({
        HTMLAttributes: { class: 'text-primary font-medium' },
        suggestion: createMentionSuggestion(
          () => candidatesRef.current,
          () => ({
            name: tRef.current('pages.editor.toolbar.mention'),
            empty: tRef.current('pages.editor.suggestions.empty'),
          }),
        ),
      }),
      createSlashCommandExtension(
        () => slashItemsRef.current,
        () => ({
          name: tRef.current('pages.editor.suggestions.commands'),
          empty: tRef.current('pages.editor.suggestions.empty'),
        }),
      ),
    ],
    editorProps: {
      attributes: {
        role: 'textbox',
        'aria-multiline': 'true',
        'aria-label': t('pages.editor.contentLabel'),
      },
    },
    content: content as JSONContent,
    onCreate: () => {
      setTimeout(() => {
        readyRef.current = true
      }, 0)
    },
    onUpdate: ({ editor: e }) => {
      if (!readyRef.current) return
      onChange(e.getJSON() as TiptapNode)
    },
  })

  // Tiptap does not rerender useEditor for every transaction by default. Formatting and caret
  // moves must still update the toolbar, even when they do not produce a new parent document.
  const activeFormats = useEditorState({
    editor,
    selector: ({ editor: current }) =>
      current
        ? {
            bold: current.isActive('bold'),
            italic: current.isActive('italic'),
            heading1: current.isActive('heading', { level: 1 }),
            heading2: current.isActive('heading', { level: 2 }),
            bulletList: current.isActive('bulletList'),
            orderedList: current.isActive('orderedList'),
            taskList: current.isActive('taskList'),
            blockquote: current.isActive('blockquote'),
            codeBlock: current.isActive('codeBlock'),
            callout: current.isActive('callout'),
          }
        : null,
  })

  React.useEffect(() => {
    editor?.setEditable(editable)
  }, [editable, editor])

  React.useEffect(() => {
    editor?.setOptions({
      editorProps: {
        attributes: {
          role: 'textbox',
          'aria-multiline': 'true',
          'aria-label': t('pages.editor.contentLabel'),
        },
      },
    })
  }, [editor, t])

  React.useEffect(() => {
    if (editor && JSON.stringify(editor.getJSON()) !== JSON.stringify(content))
      editor.commands.setContent(content as JSONContent, { emitUpdate: false })
  }, [content, editor])

  // AI wiring (AI-AUDIT F9): translate the selected text, preview it, and only replace the selection
  // on Accept -- never a whole-document rewrite, so a bad translation never costs more than the
  // sentence the person already had selected.
  //
  // v1.1 fixes the defect behind "AI mostly translates to Uzbek and nothing happens" (§0.1): v1.0
  // passed `locale` -- the reader's own UI language -- as the TARGET, so a uz-Latn user translating
  // an Uzbek paragraph asked GLM for Uzbek and got their own text back. The target is a picker now,
  // and uz-Latn to uz-Cyrl never reaches a model at all (D-2: `packages/i18n` does it exactly).
  const locale = useLocale()
  const translateMutation = useRunAiFeatureMutation('translate')
  const [translateTarget, setTranslateTarget] = React.useState<Locale>(() =>
    defaultTranslateTarget(locale),
  )
  const [translateOpen, setTranslateOpen] = React.useState(false)
  const [translateRange, setTranslateRange] = React.useState<{ from: number; to: number } | null>(
    null,
  )

  function startTranslate() {
    if (!editor) return
    const { from, to, empty } = editor.state.selection
    if (empty) {
      toast(t('pages.editor.translate.selectFirst'))
      return
    }
    const text = editor.state.doc.textBetween(from, to, ' ')
    setTranslateRange({ from, to })
    setTranslateOpen(true)
    setEditedTranslation('')
    translateMutation.mutate({
      locale,
      targetLocale: translateTarget,
      sourceLocale: null,
      text,
      glossary: [],
      preserve: [],
    })
  }

  const [editedTranslation, setEditedTranslation] = React.useState('')
  React.useEffect(() => {
    const data = translateMutation.data?.data
    const text =
      typeof data?.['translatedText'] === 'string' ? (data['translatedText'] as string) : ''
    setEditedTranslation(text)
    // Reset the editable draft only when a *new* result object arrives (each successful mutation
    // resolves to a fresh response), never on a re-render that leaves it unchanged -- that would
    // stomp the person's own in-panel edits.
  }, [translateMutation.data])

  function closeTranslate() {
    setTranslateOpen(false)
    setTranslateRange(null)
    translateMutation.reset()
  }

  if (!editor) return null

  return (
    <div className="flex flex-col gap-3">
      <Input
        value={title}
        onChange={(e) => onTitleChange(e.target.value)}
        placeholder={t('pages.editor.titlePlaceholder')}
        aria-label={t('pages.editor.titlePlaceholder')}
        maxLength={300}
        aria-invalid={Boolean(titleErrorId) || undefined}
        aria-describedby={titleErrorId}
        onBlur={onBlur}
        disabled={!editable}
        className="h-auto border-none bg-transparent px-0 font-display text-h1"
      />

      {editable ? (
        <div
          role="toolbar"
          aria-label={t('pages.editor.suggestions.formatting')}
          className="flex flex-wrap items-center gap-0.5 border-b border-border pb-2"
        >
          <ToolbarButton
            labelKey="pages.editor.toolbar.bold"
            active={activeFormats?.bold ?? false}
            onClick={() => editor.chain().focus().toggleBold().run()}
          >
            <Bold className="size-4" aria-hidden="true" />
          </ToolbarButton>
          <ToolbarButton
            labelKey="pages.editor.toolbar.italic"
            active={activeFormats?.italic ?? false}
            onClick={() => editor.chain().focus().toggleItalic().run()}
          >
            <Italic className="size-4" aria-hidden="true" />
          </ToolbarButton>
          <ToolbarButton
            labelKey="pages.editor.toolbar.heading1"
            active={activeFormats?.heading1 ?? false}
            onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
          >
            <Heading1 className="size-4" aria-hidden="true" />
          </ToolbarButton>
          <ToolbarButton
            labelKey="pages.editor.toolbar.heading2"
            active={activeFormats?.heading2 ?? false}
            onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
          >
            <Heading2 className="size-4" aria-hidden="true" />
          </ToolbarButton>
          <ToolbarButton
            labelKey="pages.editor.toolbar.bulletList"
            active={activeFormats?.bulletList ?? false}
            onClick={() => editor.chain().focus().toggleBulletList().run()}
          >
            <List className="size-4" aria-hidden="true" />
          </ToolbarButton>
          <ToolbarButton
            labelKey="pages.editor.toolbar.orderedList"
            active={activeFormats?.orderedList ?? false}
            onClick={() => editor.chain().focus().toggleOrderedList().run()}
          >
            <ListOrdered className="size-4" aria-hidden="true" />
          </ToolbarButton>
          <ToolbarButton
            labelKey="pages.editor.toolbar.taskList"
            active={activeFormats?.taskList ?? false}
            onClick={() => editor.chain().focus().toggleTaskList().run()}
          >
            <ListChecks className="size-4" aria-hidden="true" />
          </ToolbarButton>
          <ToolbarButton
            labelKey="pages.editor.toolbar.blockquote"
            active={activeFormats?.blockquote ?? false}
            onClick={() => editor.chain().focus().toggleBlockquote().run()}
          >
            <MessageSquareQuote className="size-4" aria-hidden="true" />
          </ToolbarButton>
          <ToolbarButton
            labelKey="pages.editor.toolbar.codeBlock"
            active={activeFormats?.codeBlock ?? false}
            onClick={() => editor.chain().focus().toggleCodeBlock().run()}
          >
            <Code2 className="size-4" aria-hidden="true" />
          </ToolbarButton>
          <ToolbarButton
            labelKey="pages.editor.toolbar.callout"
            active={activeFormats?.callout ?? false}
            onClick={() => editor.chain().focus().toggleCallout('info').run()}
          >
            <Megaphone className="size-4" aria-hidden="true" />
          </ToolbarButton>
          <span className="ml-auto flex flex-wrap items-center gap-2">
            <TranslateTargetPicker
              id="page-translate-target"
              value={translateTarget}
              onChange={setTranslateTarget}
              disabled={translateMutation.isPending}
            />
            <SparkleButton
              aria-label={t('pages.editor.toolbar.translate')}
              size="sm"
              loading={translateMutation.isPending}
              onClick={startTranslate}
            />
          </span>
        </div>
      ) : null}

      {translateOpen ? (
        <AiResultPanel
          title={t('pages.editor.translate.title')}
          status={
            translateMutation.isPending ? 'pending' : translateMutation.isError ? 'error' : 'ready'
          }
          {...(translateMutation.error
            ? { errorMessage: t(translateErrorKey(translateMutation.error)) }
            : {})}
          {...(translateMutation.data ? { meta: translateMutation.data.meta } : {})}
          acceptLabel={t('pages.editor.translate.accept')}
          editLabel={t('pages.editor.translate.edit')}
          onRetry={startTranslate}
          onAccept={() => {
            if (editedTranslation && translateRange) {
              editor.chain().focus().insertContentAt(translateRange, editedTranslation).run()
            }
            closeTranslate()
          }}
          onEdit={() => {
            // The field below is always editable -- "Edit" has nothing further to switch on; it
            // exists so every AI preview in the product offers the same three actions.
          }}
          onDiscard={closeTranslate}
        >
          {editedTranslation ? (
            <textarea
              value={editedTranslation}
              onChange={(e) => setEditedTranslation(e.target.value)}
              rows={3}
              aria-label={t('pages.editor.translate.title')}
              className="w-full resize-y rounded-sm border border-border bg-card p-2 text-body text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          ) : null}
        </AiResultPanel>
      ) : null}

      <EditorContent
        editor={editor}
        onBlur={onBlur}
        className={cn(
          'prose-devon min-h-40 text-body text-foreground focus:outline-none',
          '[&_.is-editor-empty:first-child::before]:pointer-events-none [&_.is-editor-empty:first-child::before]:float-left [&_.is-editor-empty:first-child::before]:h-0 [&_.is-editor-empty:first-child::before]:text-muted-foreground [&_.is-editor-empty:first-child::before]:content-[attr(data-placeholder)]',
          '[&_h1]:font-display [&_h1]:text-h1 [&_h2]:font-display [&_h2]:text-h2',
          '[&_ul]:list-disc [&_ul]:pl-6 [&_ol]:list-decimal [&_ol]:pl-6',
          '[&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground',
          '[&_pre]:overflow-x-auto [&_pre]:rounded-sm [&_pre]:bg-muted [&_pre]:p-3 [&_pre]:font-mono [&_pre]:text-small',
          '[&_[data-callout]]:rounded-sm [&_[data-callout]]:border [&_[data-callout]]:border-info [&_[data-callout]]:bg-accent [&_[data-callout]]:p-3',
          '[&_ul[data-type=taskList]]:list-none [&_ul[data-type=taskList]]:pl-0',
          '[&_li[data-checked]>label]:mr-2',
          '[&_.tiptap]:break-words [&_.tiptap]:rounded-sm [&_.tiptap:focus-visible]:outline [&_.tiptap:focus-visible]:outline-2 [&_.tiptap:focus-visible]:outline-ring',
        )}
      />
    </div>
  )
}
