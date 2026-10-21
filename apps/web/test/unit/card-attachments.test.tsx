import * as React from 'react'
import type * as UI from '@devon/ui'
import type * as API from '../../src/lib/api-client.js'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { setLocale } from '@devon/i18n'
import { ApiError } from '../../src/lib/api-client.js'
import { CardAttachments } from '../../src/features/work/components/card-attachments.js'

const mocks = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), uploadFile: vi.fn() }))
vi.mock('../../src/lib/api-client.js', async (original) => ({
  ...(await original<typeof API>()),
  apiClient: mocks,
}))
vi.mock('../../src/lib/session.js', () => ({ useMeQuery: () => ({ data: { csrfToken: 'csrf' } }) }))
vi.mock('@devon/ui', async (original) => ({ ...(await original<typeof UI>()), toast: vi.fn() }))

const base = '/api/v1/cards/card-a/attachments'
const signed = {
  uploadId: 'upload-a',
  url: '/signed/already-approved',
  method: 'PUT',
  headers: { 'content-type': 'application/octet-stream' },
}
const saved = {
  id: signed.uploadId,
  name: 'recording.mp4',
  mime: 'video/mp4',
  size: 101 * 1024 ** 2,
  createdAt: '2026-10-21T00:00:00Z',
}
function setup() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  render(
    <QueryClientProvider client={client}>
      <CardAttachments cardId="card-a" canEdit />
    </QueryClientProvider>,
  )
  const file = new File(['test'], saved.name, { type: saved.mime })
  // Exercise a large-file approval without allocating 101 MiB in the test process.
  Object.defineProperty(file, 'size', { value: saved.size })
  return { client, file, user: userEvent.setup() }
}
beforeEach(() => {
  vi.resetAllMocks()
  setLocale('en')
  mocks.get.mockResolvedValue([])
  mocks.post.mockImplementation(async (path) => (path.endsWith('/upload-url') ? signed : saved))
  mocks.uploadFile.mockResolvedValue(undefined)
})

describe('attachment upload retries', () => {
  it('retries a capacity refusal using the same approved URL and File before finalizing', async () => {
    mocks.uploadFile.mockRejectedValueOnce(new ApiError(503, 'maintenance', null))
    const { client, file, user } = setup()
    await user.upload(screen.getByLabelText(/Upload a file/), file)
    const retry = await screen.findByRole('button', { name: 'Try again' })
    expect(mocks.post).toHaveBeenCalledTimes(1)
    expect(mocks.post.mock.calls[0]?.[0]).toBe(`${base}/upload-url`)
    expect(mocks.post.mock.calls[0]?.[1]).toEqual({ name: file.name, size: saved.size })
    expect(mocks.post.mock.calls.some(([path]) => path.endsWith('/finalize'))).toBe(false)
    await user.click(retry)
    await waitFor(() => expect(mocks.post).toHaveBeenCalledTimes(2))
    expect(mocks.uploadFile).toHaveBeenCalledTimes(2)
    for (const [url, init] of mocks.uploadFile.mock.calls) {
      expect(url).toBe(signed.url)
      expect(init).toEqual(
        expect.objectContaining({ body: file, method: signed.method, headers: signed.headers }),
      )
    }
    expect(mocks.post.mock.calls[1]?.[0]).toBe(`${base}/${signed.uploadId}/finalize`)
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument(),
    )
    client.clear()
  })

  it('retries only finalization when scanning fails after a successful transfer', async () => {
    mocks.post
      .mockResolvedValueOnce(signed)
      .mockRejectedValueOnce(new ApiError(503, 'maintenance', null))
      .mockResolvedValueOnce(saved)
    const { client, file, user } = setup()
    await user.upload(screen.getByLabelText(/Upload a file/), file)
    await user.click(await screen.findByRole('button', { name: 'Try again' }))
    await waitFor(() => expect(mocks.post).toHaveBeenCalledTimes(3))
    expect(mocks.uploadFile).toHaveBeenCalledTimes(1)
    expect(mocks.post.mock.calls.map(([path]) => path)).toEqual([
      `${base}/upload-url`,
      `${base}/${signed.uploadId}/finalize`,
      `${base}/${signed.uploadId}/finalize`,
    ])
    client.clear()
  })

  it('does not offer transfer retry for a terminal upload rejection', async () => {
    mocks.uploadFile.mockRejectedValueOnce(new ApiError(413, 'payload_too_large', null))
    const { client, file, user } = setup()
    await user.upload(screen.getByLabelText(/Upload a file/), file)
    await screen.findByRole('alert')
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument()
    expect(mocks.post).toHaveBeenCalledTimes(1)
    client.clear()
  })
})
