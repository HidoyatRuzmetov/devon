import { Extension, type Editor } from '@tiptap/core'
import Suggestion, {
  exitSuggestion,
  type SuggestionKeyDownProps,
  type SuggestionOptions,
  type SuggestionProps,
} from '@tiptap/suggestion'
import { PluginKey } from '@tiptap/pm/state'
import { SuggestionList, type SuggestionLabels } from './suggestion-list.js'

export type SlashCommandItem = { id: string; label: string; run: (editor: Editor) => void }
const slashPluginKey = new PluginKey('slashCommand')

export function createSlashCommandExtension(
  getItems: () => SlashCommandItem[],
  getLabels: () => SuggestionLabels,
) {
  return Extension.create({
    name: 'slashCommand',
    addProseMirrorPlugins() {
      const suggestion: Omit<SuggestionOptions<SlashCommandItem>, 'editor'> = {
        char: '/',
        pluginKey: slashPluginKey,
        allow: ({ state, range }) => {
          const from = state.doc.resolve(range.from)
          return from.parent.type.name !== 'codeBlock' && from.parentOffset <= 1
        },
        items: ({ query }) =>
          getItems().filter((item) =>
            item.label.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()),
          ),
        command: ({ editor, range, props }) => {
          editor.chain().focus().deleteRange(range).run()
          props.run(editor)
        },
        render: () => {
          let list: SuggestionList<SlashCommandItem> | null = null
          function update(props: SuggestionProps<SlashCommandItem>) {
            const command = (item: SlashCommandItem) => props.command(item)
            const anchor = () => props.clientRect?.() ?? null
            list ??= new SuggestionList(props.editor.view.dom, command, anchor, () =>
              exitSuggestion(props.editor.view, slashPluginKey),
            )
            list.update(props.items, command, getLabels(), anchor)
          }
          return {
            onStart: update,
            onUpdate: update,
            onKeyDown: (props: SuggestionKeyDownProps) => {
              if (!list) return false
              if (props.event.key === 'ArrowDown' || props.event.key === 'ArrowUp') {
                list.moveSelection(props.event.key === 'ArrowDown' ? 1 : -1)
                return true
              }
              if (props.event.key === 'Enter') return list.selectCurrent()
              if (props.event.key === 'Escape' || props.event.key === 'Tab') {
                exitSuggestion(props.view, slashPluginKey)
                return props.event.key === 'Escape'
              }
              return false
            },
            onExit: () => {
              list?.destroy()
              list = null
            },
          }
        },
      }
      return [Suggestion({ editor: this.editor, ...suggestion })]
    },
  })
}
