import type { Meta, StoryObj } from '@storybook/react-vite'
import { Toaster, toast, toastWithUndo } from './toast.js'
import { Button } from './button.js'

const meta: Meta<typeof Toaster> = { title: 'Primitives/Toast' }
export default meta
type Story = StoryObj<typeof Toaster>

export const Success: Story = {
  render: () => (
    <>
      <Toaster />
      <Button onClick={() => toast('Nusxa olindi')}>Nusxa olish</Button>
    </>
  ),
}

export const WithUndo: Story = {
  render: () => (
    <>
      <Toaster />
      <Button
        onClick={() =>
          toastWithUndo({
            message: 'Vazifa oʻchirildi',
            undoLabel: 'Bekor qilish',
            onUndo: () => {},
          })
        }
      >
        Oʻchirish
      </Button>
    </>
  ),
}
