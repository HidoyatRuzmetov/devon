import * as React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { setLocale } from '@devon/i18n'
import { TooltipProvider } from '@devon/ui'
import { OnboardingTemplatesPanel } from '../../src/features/pages/onboarding-templates.js'
import type { OnboardingTemplate } from '../../src/features/pages/types.js'

const state = vi.hoisted(() => ({
  data: [] as OnboardingTemplate[],
  patch: vi.fn(),
  create: vi.fn(),
  remove: vi.fn(),
}))
vi.mock('../../src/features/pages/use-pages.js', () => ({
  useOnboardingTemplatesQuery: () => ({ data: state.data, isPending: false, isError: false }),
  usePatchOnboardingTemplateMutation: () => ({
    mutate: state.patch,
    isPending: false,
    reset: vi.fn(),
  }),
  useCreateOnboardingTemplateMutation: () => ({
    mutate: state.create,
    isPending: false,
    reset: vi.fn(),
  }),
  useDeleteOnboardingTemplateMutation: () => ({
    mutate: state.remove,
    isPending: false,
    reset: vi.fn(),
  }),
}))
const original: OnboardingTemplate = {
  id: 'template',
  name: 'Checklist',
  enabled: true,
  items: [{ id: 'original', text: 'Original item', ownerRole: 'newcomer', sort: 0 }],
  version: 1,
  createdByUserId: 'creator',
  createdAt: '',
  updatedAt: '',
}
beforeEach(() => {
  setLocale('en')
  vi.clearAllMocks()
  state.data = [original]
})

function show() {
  return render(<OnboardingTemplatesPanel />, { wrapper: TooltipProvider })
}

describe('onboarding draft safety', () => {
  it('retains dirty items when a different incoming item array arrives', () => {
    const view = show()
    fireEvent.change(screen.getByRole('textbox', { name: 'What needs to happen?' }), {
      target: { value: 'My draft' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Add item' }))
    state.data = [
      {
        ...original,
        version: 2,
        items: [...original.items, { id: 'peer', text: 'Peer item', ownerRole: 'head', sort: 1 }],
      },
    ]
    view.rerender(<OnboardingTemplatesPanel />)
    expect(screen.getByText('My draft')).toBeVisible()
  })
  it('blocks two immediate create submissions before React pending state renders', () => {
    show()
    const input = screen.getByRole('textbox', { name: 'Checklist name' })
    fireEvent.change(input, { target: { value: 'New checklist' } })
    const form = input.closest('form')!
    fireEvent.submit(form)
    fireEvent.submit(form)
    expect(state.create).toHaveBeenCalledOnce()
  })
  it('asks before deleting the whole template and supports cancellation', () => {
    show()
    fireEvent.click(screen.getByRole('button', { name: 'Delete checklist' }))
    expect(state.remove).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog')).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(state.remove).not.toHaveBeenCalled()
  })
})
