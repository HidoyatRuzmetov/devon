import * as React from 'react'
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Tabs, TabsContent, TabsList, TabsTrigger } from './tabs.js'

function Panels() {
  return (
    <>
      <TabsList aria-label="Project">
        <TabsTrigger value="plan">Plan</TabsTrigger>
        <TabsTrigger value="discussion">Discussion</TabsTrigger>
        <TabsTrigger value="files">Files</TabsTrigger>
      </TabsList>
      <TabsContent value="plan">Project plan</TabsContent>
      <TabsContent value="discussion">Project conversation</TabsContent>
      <TabsContent value="files">Project attachments</TabsContent>
    </>
  )
}

describe('Tabs selection', () => {
  it('keeps uncontrolled mouse and keyboard selection in sync with the visible panel', async () => {
    const user = userEvent.setup()
    render(
      <Tabs defaultValue="discussion">
        <Panels />
      </Tabs>,
    )
    expect(screen.getByRole('tabpanel')).toHaveTextContent('Project conversation')
    await user.click(screen.getByRole('tab', { name: 'Plan' }))
    expect(screen.getByRole('tab', { name: 'Plan' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tabpanel')).toHaveTextContent('Project plan')
    await user.keyboard('{ArrowRight}')
    expect(screen.getByRole('tab', { name: 'Discussion' })).toHaveFocus()
    expect(screen.getByRole('tabpanel')).toHaveTextContent('Project conversation')
  })

  it('follows the controlled value when navigation changes it externally', async () => {
    const user = userEvent.setup()
    function Controlled() {
      const [value, setValue] = React.useState('files')
      return (
        <>
          <button onClick={() => setValue('plan')}>Back to plan</button>
          <Tabs value={value} onValueChange={setValue}>
            <Panels />
          </Tabs>
        </>
      )
    }
    render(<Controlled />)
    await user.click(screen.getByRole('tab', { name: 'Discussion' }))
    expect(screen.getByRole('tabpanel')).toHaveTextContent('Project conversation')
    await user.click(screen.getByRole('button', { name: 'Back to plan' }))
    expect(screen.getByRole('tab', { name: 'Plan' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tabpanel')).toHaveTextContent('Project plan')
  })
})
