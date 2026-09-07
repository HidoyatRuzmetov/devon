import * as React from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { ILLUSTRATIONS, type IllustrationName } from './index.js'
import { IdleFloat } from '../motion/ambient-gradient.js'

const meta = {
  title: 'Foundations/Illustrations',
  parameters: { layout: 'fullscreen' },
} satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

/** The whole set, in both themes (switch with the Storybook theme toolbar) -- every fill is a token,
 * so the whole set repaints with the theme and with any future palette change. */
export const AllIllustrations: Story = {
  render: () => (
    <div className="grid grid-cols-2 gap-6 bg-background p-8 font-sans sm:grid-cols-3 lg:grid-cols-4">
      {(Object.keys(ILLUSTRATIONS) as IllustrationName[]).map((name) => {
        const Illustration = ILLUSTRATIONS[name]
        return (
          <figure key={name} className="flex flex-col items-center gap-2">
            <IdleFloat className="w-40">
              <Illustration />
            </IdleFloat>
            <figcaption className="text-caption text-muted-foreground">{name}</figcaption>
          </figure>
        )
      })}
    </div>
  ),
}
