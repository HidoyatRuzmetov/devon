import { afterEach, expect, it } from 'vitest'
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { Callout } from '../../src/features/pages/callout-extension.js'

let editor: Editor | undefined
afterEach(() => editor?.destroy())

it('explicitly unwraps an isolated callout without losing paragraphs, marks or the text selection', () => {
  editor = new Editor({
    extensions: [StarterKit, Callout],
    content: {
      type: 'doc',
      content: [
        {
          type: 'callout',
          content: [
            {
              type: 'paragraph',
              content: [{ type: 'text', text: 'First', marks: [{ type: 'bold' }] }],
            },
            { type: 'paragraph', content: [{ type: 'text', text: 'Second' }] },
          ],
        },
        { type: 'paragraph', content: [{ type: 'text', text: 'Outside' }] },
      ],
    },
  })
  editor.commands.setTextSelection({ from: 2, to: 15 })
  const selected = editor.state.doc.textBetween(
    editor.state.selection.from,
    editor.state.selection.to,
    ' ',
  )
  const before = editor.getJSON()
  expect(editor.can().toggleCallout()).toBe(true)
  expect(editor.getJSON()).toEqual(before)
  expect(editor.commands.toggleCallout()).toBe(true)
  expect(editor.getJSON().content).toEqual([
    { type: 'paragraph', content: [{ type: 'text', text: 'First', marks: [{ type: 'bold' }] }] },
    { type: 'paragraph', content: [{ type: 'text', text: 'Second' }] },
    { type: 'paragraph', content: [{ type: 'text', text: 'Outside' }] },
  ])
  expect(
    editor.state.doc.textBetween(editor.state.selection.from, editor.state.selection.to, ' '),
  ).toBe(selected)
  expect(editor.schema.nodes['callout']?.spec.isolating).toBe(true)
})
