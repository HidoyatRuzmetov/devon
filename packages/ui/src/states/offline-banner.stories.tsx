import type { Meta, StoryObj } from '@storybook/react-vite'
import { OfflineBanner } from './offline-banner.js'
import { StateView } from './state-view.js'

const meta: Meta<typeof OfflineBanner> = {
  title: 'States/OfflineBanner',
  component: OfflineBanner,
  parameters: { layout: 'fullscreen' },
}
export default meta
type Story = StoryObj<typeof OfflineBanner>

/** Cached content exists: the banner carries the single action, the content below is unchanged. */
export const WithCachedContent: Story = {
  render: () => (
    <div>
      <OfflineBanner hasCachedContent onRetry={() => {}} />
      <div className="p-6 text-body text-muted-foreground">
        (oldingi yuklangan sahifa mazmuni shu yerda koʻrinadi)
      </div>
    </div>
  ),
}

/** No cached content: the banner is status-only, the StateView below carries the single action. */
export const NoCachedContent: Story = {
  render: () => (
    <div>
      <OfflineBanner hasCachedContent={false} onRetry={() => {}} />
      <StateView
        kind="offline"
        titleKey="state.offline.banner"
        bodyKey="state.offline.empty"
        action={{ labelKey: 'state.error.action', onAction: () => {} }}
      />
    </div>
  ),
}
