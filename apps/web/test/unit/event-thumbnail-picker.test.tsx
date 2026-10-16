import * as React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { setLocale } from '@devon/i18n'
import { ApiError, apiClient } from '../../src/lib/api-client.js'
import { EventThumbnailPicker } from '../../src/features/events/components/event-thumbnail-picker.js'

const calls = vi.hoisted(() => ({ request: vi.fn(), finalize: vi.fn() }))
vi.mock('../../src/features/events/api.js', () => ({
  requestEventThumbnailUpload: calls.request,
  finalizeEventThumbnailUpload: calls.finalize,
}))
vi.mock('../../src/features/events/hooks.js', () => ({ useCsrfToken: () => 'local-csrf' }))
beforeEach(() => {
  setLocale('en')
  vi.restoreAllMocks()
  vi.clearAllMocks()
  calls.request.mockResolvedValue({
    uploadId: 'uploaded-image',
    url: '/signed/upload',
    method: 'PUT',
    headers: {},
  })
  calls.finalize.mockResolvedValue({
    uploadId: 'uploaded-image',
    thumbnailUrl: '/api/v1/events/thumbnails/uploaded-image',
  })
  vi.spyOn(apiClient, 'uploadFile').mockResolvedValue(undefined)
})

describe('event photo selection', () => {
  it('uploads through the signed file path and applies only the checked final image', async () => {
    const changed = vi.fn()
    const busy = vi.fn()
    render(<EventThumbnailPicker thumbnailUrl={null} onChange={changed} onBusyChange={busy} />)
    const file = new File(['synthetic image'], 'event.png', { type: 'image/png' })
    await userEvent.setup().upload(screen.getByLabelText('Event photo (optional)'), file)
    await waitFor(() =>
      expect(changed).toHaveBeenCalledWith({
        uploadId: 'uploaded-image',
        thumbnailUrl: '/api/v1/events/thumbnails/uploaded-image',
      }),
    )
    expect(calls.request).toHaveBeenCalledWith(file, 'local-csrf')
    expect(apiClient.uploadFile).toHaveBeenCalledWith(
      '/signed/upload',
      expect.objectContaining({ body: file, method: 'PUT' }),
    )
    expect(calls.finalize).toHaveBeenCalledWith('uploaded-image', 'local-csrf')
    expect(busy.mock.calls).toEqual([[true], [false]])
  })

  it('retries a temporarily unavailable scan without uploading duplicate bytes', async () => {
    calls.finalize.mockRejectedValueOnce(new ApiError(503, 'unavailable', null))
    const changed = vi.fn()
    render(<EventThumbnailPicker thumbnailUrl={null} onChange={changed} onBusyChange={vi.fn()} />)
    const user = userEvent.setup()
    await user.upload(
      screen.getByLabelText('Event photo (optional)'),
      new File(['image'], 'event.png', { type: 'image/png' }),
    )
    await expect(
      screen.findByText('The file check is temporarily unavailable. Retry before continuing.'),
    ).resolves.toBeVisible()
    expect(changed).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Retry' }))
    await waitFor(() => expect(changed).toHaveBeenCalledOnce())
    expect(calls.request).toHaveBeenCalledOnce()
    expect(apiClient.uploadFile).toHaveBeenCalledOnce()
    expect(calls.finalize).toHaveBeenCalledTimes(2)
  })

  it('removes a saved photo explicitly and rejects oversized selections before any upload', async () => {
    const changed = vi.fn()
    render(
      <EventThumbnailPicker thumbnailUrl="/saved.webp" onChange={changed} onBusyChange={vi.fn()} />,
    )
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Remove photo' }))
    expect(changed).toHaveBeenCalledWith(null)
    await user.upload(
      screen.getByLabelText('Event photo (optional)'),
      new File([new Uint8Array(5 * 1024 * 1024 + 1)], 'large.png', { type: 'image/png' }),
    )
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Choose a JPG, PNG or WebP image smaller than 5 MB.',
    )
    expect(calls.request).not.toHaveBeenCalled()
  })
})
