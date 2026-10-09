import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorkTemplate } from '../../src/features/work/api-plus.js'

const create = vi.hoisted(() => vi.fn())
const patch = vi.hoisted(() => vi.fn())
vi.mock('@devon/i18n', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useT: () => (key: string) => key,
}))
vi.mock('../../src/features/work/hooks-plus.js', () => ({
  useCreateTemplateMutation: () => ({ isPending: false, mutateAsync: create }),
  usePatchTemplateMutation: () => ({ isPending: false, mutateAsync: patch }),
}))
import { CardTemplateEditor } from '../../src/features/work/components/card-template-editor.js'

const template: WorkTemplate = {
  id: '36e3dd78-3801-42d9-8259-9d32b3580b00',
  kind: 'card',
  scope: 'department',
  ownerUserId: '58d67600-6478-4291-af99-d095d9ef6766',
  name: 'Report',
  description: 'Gallery description',
  useCount: 2,
  createdAt: '2026-10-08T00:00:00.000Z',
  canManage: true,
  payload: {
    title: 'Original card',
    description: 'Keep this description',
    priority: 'high',
    dueInDays: 7,
    estimateMin: 90,
    labels: ['de7e3e80-88e7-44c2-8455-a5ea3c545ae2'],
    checklist: ['First', 'Second'],
  },
}
function props(value: WorkTemplate | null = template) {
  return { template: value, isHead: true, onClose: vi.fn(), onCloseAutoFocus: vi.fn() }
}
beforeEach(() => {
  create.mockReset()
  patch.mockReset()
})
describe('CardTemplateEditor', () => {
  it('keeps dirty fields across refresh and preserves every untouched latest payload field', async () => {
    patch.mockResolvedValue(undefined)
    const options = props()
    const { rerender } = render(<CardTemplateEditor {...options} />)
    fireEvent.change(screen.getByLabelText('work.templateEditor.name'), {
      target: { value: 'Edited report' },
    })
    fireEvent.change(screen.getByLabelText('work.templateEditor.cardTitle'), {
      target: { value: 'Edited card' },
    })
    fireEvent.change(screen.getByLabelText('work.templateEditor.checklist'), {
      target: { value: 'First\nNew step' },
    })
    const latest = {
      ...template,
      payload: { ...template.payload, description: 'Peer description', estimateMin: 180 },
    }
    rerender(<CardTemplateEditor {...options} template={latest} />)
    expect(screen.getByLabelText('work.templateEditor.cardTitle')).toHaveValue('Edited card')
    fireEvent.click(screen.getByRole('button', { name: 'common.save' }))
    await waitFor(() =>
      expect(patch).toHaveBeenCalledWith({
        id: template.id,
        patch: {
          name: 'Edited report',
          scope: 'department',
          payload: { ...latest.payload, title: 'Edited card', checklist: ['First', 'New step'] },
        },
      }),
    )
    expect(options.onClose).toHaveBeenCalledOnce()
    expect(create).not.toHaveBeenCalled()
  })
  it('keeps the entire draft when saving is refused and permits retry', async () => {
    create.mockRejectedValueOnce(new Error('refused')).mockResolvedValueOnce({ id: template.id })
    const options = props(null)
    render(<CardTemplateEditor {...options} isHead={false} />)
    fireEvent.change(screen.getByLabelText('work.templateEditor.name'), {
      target: { value: 'Personal report' },
    })
    fireEvent.change(screen.getByLabelText('work.templateEditor.cardTitle'), {
      target: { value: 'Personal card' },
    })
    fireEvent.change(screen.getByLabelText('work.templateEditor.checklist'), {
      target: { value: 'Instruction' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'common.save' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('work.templateEditor.saveFailed')
    expect(screen.getByLabelText('work.templateEditor.name')).toHaveValue('Personal report')
    expect(screen.getByLabelText('work.templateEditor.checklist')).toHaveValue('Instruction')
    expect(screen.getByRole('combobox')).toHaveValue('personal')
    expect(screen.getAllByRole('option')).toHaveLength(1)
    expect(options.onClose).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'common.save' }))
    await waitFor(() => expect(options.onClose).toHaveBeenCalledOnce())
    expect(create).toHaveBeenLastCalledWith({
      kind: 'card',
      scope: 'personal',
      name: 'Personal report',
      payload: { title: 'Personal card', checklist: ['Instruction'] },
    })
  })
  it('refuses invalid checklist lengths without modifying or dropping payload', async () => {
    render(<CardTemplateEditor {...props()} />)
    fireEvent.change(screen.getByLabelText('work.templateEditor.checklist'), {
      target: { value: 'A'.repeat(501) },
    })
    fireEvent.click(screen.getByRole('button', { name: 'common.save' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('work.templateEditor.invalid')
    expect(screen.getByLabelText('work.templateEditor.checklist')).toHaveValue('A'.repeat(501))
    expect(patch).not.toHaveBeenCalled()
  })
})
