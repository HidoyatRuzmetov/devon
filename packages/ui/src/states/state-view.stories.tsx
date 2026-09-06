import type { Meta, StoryObj } from '@storybook/react-vite'
import { StateView } from './state-view.js'

const meta: Meta<typeof StateView> = {
  title: 'States/StateView',
  component: StateView,
  parameters: { layout: 'padded' },
}
export default meta
type Story = StoryObj<typeof StateView>

/** spec.md §6.1 -- member with no department. */
export const Empty: Story = {
  args: {
    kind: 'empty',
    titleKey: 'home.empty.member.title',
    bodyKey: 'home.empty.member.body',
    action: { labelKey: 'home.empty.action', onAction: () => {} },
  },
}

export const Loading: Story = { args: { kind: 'loading', titleKey: 'state.loading' } }

/** spec.md §8.3: human sentence + retry + a selectable, copyable request id. Never a stack trace. */
export const Error: Story = {
  args: {
    kind: 'error',
    titleKey: 'state.error.title',
    bodyKey: 'state.error.body',
    action: { labelKey: 'state.error.action', onAction: () => {} },
    requestId: '8f3a-c210',
  },
}

/** spec.md §6.4 /admin as a member session -- names who to ask, one way back. */
export const Forbidden: Story = {
  args: {
    kind: 'forbidden',
    titleKey: 'state.denied.title',
    bodyKey: 'state.denied.body',
    action: { labelKey: 'state.denied.action', onAction: () => {} },
  },
}

/** spec.md §8.6: the state block's single action, used only when the route has no cached content
 * to fall back to (the banner alone carries the action when cached content exists). */
export const Offline: Story = {
  args: {
    kind: 'offline',
    titleKey: 'state.offline.banner',
    bodyKey: 'state.offline.empty',
    action: { labelKey: 'state.error.action', onAction: () => {} },
  },
}
