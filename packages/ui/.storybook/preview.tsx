import * as React from 'react'
import type { Preview } from '@storybook/react-vite'
import { withThemeByDataAttribute } from '@storybook/addon-themes'
import '../src/styles/fonts.css'
import '../src/styles/tokens.css'
import { Toaster } from '../src/primitives/toast.js'
import { TooltipProvider } from '../src/primitives/tooltip.js'

const preview: Preview = {
  parameters: {
    layout: 'padded',
    a11y: { test: 'error' }, // axe 0 serious/critical, per DESIGN.md §6
  },
  decorators: [
    withThemeByDataAttribute({
      themes: { light: 'light', dark: 'dark' },
      defaultTheme: 'light',
      attributeName: 'data-theme',
    }),
    (Story) => (
      <TooltipProvider>
        <div className="min-h-40 bg-background p-6 font-sans text-foreground">
          <Story />
        </div>
        <Toaster />
      </TooltipProvider>
    ),
  ],
}

export default preview
