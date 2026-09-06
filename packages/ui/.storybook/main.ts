import type { StorybookConfig } from '@storybook/react-vite'

/** Storybook is the component gallery for @devon/ui (EPIC-000.4 handoff): every primitive, state
 * component and shell pattern ships a story here for every state x light/dark; the glyph and
 * formatting pages under `Foundations/*` are design.md §12.F's required evidence for AC-6. */
const config: StorybookConfig = {
  stories: ['../src/**/*.stories.@(ts|tsx)'],
  addons: ['@storybook/addon-a11y', '@storybook/addon-themes', '@storybook/addon-docs'],
  framework: { name: '@storybook/react-vite', options: {} },
  staticDirs: ['../public'],
  async viteFinal(viteConfig) {
    const { default: tailwindcss } = await import('@tailwindcss/vite')
    viteConfig.plugins = [...(viteConfig.plugins ?? []), tailwindcss()]
    return viteConfig
  },
}

export default config
