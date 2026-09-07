// The Tiptap editor for one page (TECH-SPEC §5: "Tiptap 3.31 with mentions, checklist items,
// callouts, links with unfurled titles"). Autosaves on a short debounce after the document actually
// changes; the title is a plain input above the editor, not part of the Tiptap document itself.
import * as React from 'react'
import { useEditor, EditorContent, type JSONContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import TaskList from '@tiptap/extension-task-list'
import TaskItem from '@tiptap/extension-task-item'
import Placeholder from '@tiptap/extension-placeholder'
import Mention from '@tiptap/extension-mention'
import { useT } from '@devon/i18n'
import { IconButton, Input, cn } from '@devon/ui'
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
import type { TiptapNode } from './types.js'

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
}: {
  title: string
  content: TiptapNode
  editable: boolean
  mentionCandidates: MentionCandidate[]
  onTitleChange: (title: string) => void
  onChange: (json: TiptapNode) => void
}) {
  const t = useT()
  const candidatesRef = React.useRef(mentionCandidates)
  candidatesRef.current = mentionCandidates

  const editor = useEditor({
    editable,
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2] } }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Placeholder.configure({ placeholder: t('pages.editor.mentionPlaceholder') }),
      Callout,
      Mention.configure({
        HTMLAttributes: { class: 'text-primary font-medium' },
        suggestion: createMentionSuggestion(() => candidatesRef.current),
      }),
    ],
    content: content as JSONContent,
    onUpdate: ({ editor: e }) => onChange(e.getJSON() as TiptapNode),
  })

  React.useEffect(() => {
    editor?.setEditable(editable)
  }, [editable, editor])

  if (!editor) return null

  return (
    <div className="flex flex-col gap-3">
      <Input
        value={title}
        onChange={(e) => onTitleChange(e.target.value)}
        placeholder={t('pages.editor.titlePlaceholder')}
        aria-label={t('pages.editor.titlePlaceholder')}
        disabled={!editable}
        className="h-auto border-none bg-transparent px-0 font-display text-h1 focus-visible:ring-0"
      />

      {editable ? (
        <div
          role="toolbar"
          aria-label={t('pages.editor.titlePlaceholder')}
          className="flex flex-wrap items-center gap-0.5 border-b border-border pb-2"
        >
          <ToolbarButton
            labelKey="pages.editor.toolbar.bold"
            active={editor.isActive('bold')}
            onClick={() => editor.chain().focus().toggleBold().run()}
          >
            <Bold className="size-4" aria-hidden="true" />
          </ToolbarButton>
          <ToolbarButton
            labelKey="pages.editor.toolbar.italic"
            active={editor.isActive('italic')}
            onClick={() => editor.chain().focus().toggleItalic().run()}
          >
            <Italic className="size-4" aria-hidden="true" />
          </ToolbarButton>
          <ToolbarButton
            labelKey="pages.editor.toolbar.heading1"
            active={editor.isActive('heading', { level: 1 })}
            onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
          >
            <Heading1 className="size-4" aria-hidden="true" />
          </ToolbarButton>
          <ToolbarButton
            labelKey="pages.editor.toolbar.heading2"
            active={editor.isActive('heading', { level: 2 })}
            onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
          >
            <Heading2 className="size-4" aria-hidden="true" />
          </ToolbarButton>
          <ToolbarButton
            labelKey="pages.editor.toolbar.bulletList"
            active={editor.isActive('bulletList')}
            onClick={() => editor.chain().focus().toggleBulletList().run()}
          >
            <List className="size-4" aria-hidden="true" />
          </ToolbarButton>
          <ToolbarButton
            labelKey="pages.editor.toolbar.orderedList"
            active={editor.isActive('orderedList')}
            onClick={() => editor.chain().focus().toggleOrderedList().run()}
          >
            <ListOrdered className="size-4" aria-hidden="true" />
          </ToolbarButton>
          <ToolbarButton
            labelKey="pages.editor.toolbar.taskList"
            active={editor.isActive('taskList')}
            onClick={() => editor.chain().focus().toggleTaskList().run()}
          >
            <ListChecks className="size-4" aria-hidden="true" />
          </ToolbarButton>
          <ToolbarButton
            labelKey="pages.editor.toolbar.blockquote"
            active={editor.isActive('blockquote')}
            onClick={() => editor.chain().focus().toggleBlockquote().run()}
          >
            <MessageSquareQuote className="size-4" aria-hidden="true" />
          </ToolbarButton>
          <ToolbarButton
            labelKey="pages.editor.toolbar.codeBlock"
            active={editor.isActive('codeBlock')}
            onClick={() => editor.chain().focus().toggleCodeBlock().run()}
          >
            <Code2 className="size-4" aria-hidden="true" />
          </ToolbarButton>
          <ToolbarButton
            labelKey="pages.editor.toolbar.callout"
            active={editor.isActive('callout')}
            onClick={() => editor.chain().focus().toggleCallout('info').run()}
          >
            <Megaphone className="size-4" aria-hidden="true" />
          </ToolbarButton>
        </div>
      ) : null}

      <EditorContent
        editor={editor}
        className={cn(
          'prose-devon min-h-40 text-body text-foreground focus:outline-none',
          '[&_.is-editor-empty:first-child::before]:pointer-events-none [&_.is-editor-empty:first-child::before]:float-left [&_.is-editor-empty:first-child::before]:h-0 [&_.is-editor-empty:first-child::before]:text-muted-foreground [&_.is-editor-empty:first-child::before]:content-[attr(data-placeholder)]',
          '[&_h1]:font-display [&_h1]:text-h1 [&_h2]:font-display [&_h2]:text-h2',
          '[&_ul]:list-disc [&_ul]:pl-6 [&_ol]:list-decimal [&_ol]:pl-6',
          '[&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground',
          '[&_pre]:rounded-sm [&_pre]:bg-muted [&_pre]:p-3 [&_pre]:font-mono [&_pre]:text-small',
          '[&_[data-callout]]:rounded-sm [&_[data-callout]]:border [&_[data-callout]]:border-info [&_[data-callout]]:bg-accent [&_[data-callout]]:p-3',
          '[&_ul[data-type=taskList]]:list-none [&_ul[data-type=taskList]]:pl-0',
          '[&_li[data-checked]>label]:mr-2',
        )}
      />
    </div>
  )
}
