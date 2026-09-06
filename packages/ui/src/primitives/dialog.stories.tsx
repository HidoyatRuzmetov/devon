import type { Meta, StoryObj } from '@storybook/react-vite'
import { Dialog, DialogContent, DialogTrigger } from './dialog.js'
import { Button } from './button.js'

const meta: Meta<typeof Dialog> = { title: 'Primitives/Dialog' }
export default meta
type Story = StoryObj<typeof Dialog>

export const Default: Story = {
  render: () => (
    <Dialog>
      <DialogTrigger asChild>
        <Button>Klaviatura yorliqlarini ochish</Button>
      </DialogTrigger>
      <DialogContent title="Klaviatura yorliqlari">
        <p className="mt-4 text-body text-muted-foreground">
          Ctrl/⌘ + K -- qidirish va amallar. Esc -- yopish.
        </p>
      </DialogContent>
    </Dialog>
  ),
}
