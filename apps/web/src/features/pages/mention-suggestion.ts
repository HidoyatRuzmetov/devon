import {
  exitSuggestion,
  type SuggestionOptions,
  type SuggestionProps,
  type SuggestionKeyDownProps,
} from '@tiptap/suggestion'
import { PluginKey } from '@tiptap/pm/state'
import { SuggestionList, type SuggestionLabels } from './suggestion-list.js'

export type MentionCandidate = { id: string; label: string }
const mentionPluginKey = new PluginKey('pageMention')

export function createMentionSuggestion(
  getCandidates: () => MentionCandidate[],
  getLabels: () => SuggestionLabels,
): Omit<SuggestionOptions<MentionCandidate>, 'editor'> {
  return {
    char: '@',
    pluginKey: mentionPluginKey,
    items: ({ query }) => {
      const needle = query.trim().toLocaleLowerCase()
      return getCandidates()
        .filter((candidate) => candidate.label.toLocaleLowerCase().includes(needle))
        .slice(0, 8)
    },
    render: () => {
      let list: SuggestionList<MentionCandidate> | null = null
      function update(props: SuggestionProps<MentionCandidate>) {
        const command = (item: MentionCandidate) =>
          props.command({ id: item.id, label: item.label })
        const anchor = () => props.clientRect?.() ?? null
        list ??= new SuggestionList(props.editor.view.dom, command, anchor, () =>
          exitSuggestion(props.editor.view, mentionPluginKey),
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
            exitSuggestion(props.view, mentionPluginKey)
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
}
