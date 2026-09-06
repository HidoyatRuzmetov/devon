import type { Meta, StoryObj } from '@storybook/react-vite'
import { Copy } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './tooltip.js'
import { IconButton } from './icon-button.js'

const meta: Meta<typeof Tooltip> = { title: 'Primitives/Tooltip' }
export default meta
type Story = StoryObj<typeof Tooltip>

export const Default: Story = {
  render: () => (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <IconButton aria-label="Nusxa olish">
            <Copy aria-hidden="true" />
          </IconButton>
        </TooltipTrigger>
        <TooltipContent>Nusxa olish</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  ),
}
