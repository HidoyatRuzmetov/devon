import type { AiChatMessage } from '@devon/contracts'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, createEvent, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { setLocale } from '@devon/i18n'
import { TooltipProvider } from '@devon/ui'
import { AssistantWorkspace } from '../../src/features/ai/assistant-screen.js'

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  send: vi.fn(),
  messages: [] as AiChatMessage[],
}))
const existingId = 'bfbf5d9b-1ae7-4a2c-9da8-415639821045'
const createdId = '9b8988dc-cb4c-48f0-8659-ff5a160052b5'

vi.mock('../../src/features/ai/use-ai.js', () => ({
  useBriefingQuery: () => ({ data: { briefing: null, canRefresh: false } }),
  useRefreshBriefingMutation: () => ({ mutate: vi.fn(), isPending: false, isError: false }),
}))
vi.mock('../../src/features/ai/conversations.js', () => ({
  useConversationsQuery: () => ({
    data: {
      pages: [
        {
          conversations: [
            {
              id: 'bfbf5d9b-1ae7-4a2c-9da8-415639821045',
              title: 'Earlier priorities',
              updatedAt: '2026-10-21T00:00:00Z',
            },
          ],
        },
      ],
    },
  }),
  useConversationQuery: (id: string | null) => ({
    data: id
      ? { id, title: 'Earlier priorities', status: 'ready', messages: mocks.messages }
      : undefined,
  }),
  useCreateConversationMutation: () => ({
    mutateAsync: mocks.create,
    reset: vi.fn(),
    isPending: false,
  }),
  useSendConversationMessageMutation: () => ({
    mutateAsync: mocks.send,
    reset: vi.fn(),
    isPending: false,
  }),
  useCancelConversationMessageMutation: () => ({
    mutate: vi.fn(),
    reset: vi.fn(),
    isPending: false,
  }),
  useConversationUploadMutation: () => ({ mutateAsync: vi.fn(), isPending: false }),
}))

function Harness() {
  return (
    <TooltipProvider>
      <AssistantWorkspace />
    </TooltipProvider>
  )
}

async function scrollHarness() {
  const observers: ControlledResizeObserver[] = []
  class ControlledResizeObserver implements ResizeObserver {
    nodes = new Set<Element>()
    constructor(readonly callback: ResizeObserverCallback) {
      observers.push(this)
    }
    observe(node: Element) {
      this.nodes.add(node)
    }
    unobserve(node: Element) {
      this.nodes.delete(node)
    }
    disconnect() {
      this.nodes.clear()
    }
  }
  vi.stubGlobal('ResizeObserver', ControlledResizeObserver)
  window.history.replaceState(null, '', `/assistant?conversation=${existingId}`)
  render(<Harness />)
  const log = await screen.findByRole('log')
  let contentHeight = 800,
    viewportHeight = 300,
    top = 500
  Object.defineProperties(log, {
    scrollHeight: { configurable: true, get: () => contentHeight },
    clientHeight: { configurable: true, get: () => viewportHeight },
    scrollTop: {
      configurable: true,
      get: () => top,
      set: (value: number) => {
        top = Math.max(0, Math.min(value, contentHeight - viewportHeight))
      },
    },
  })
  const observer = observers.find((item) => item.nodes.has(log))!
  expect(observer.nodes.has(log.firstElementChild!)).toBe(true)
  return {
    log,
    resize(content: number, viewport: number, anchoredTop: number) {
      contentHeight = content
      viewportHeight = viewport
      log.scrollTop = anchoredTop
      // Browsers can deliver the reflow-induced scroll event before ResizeObserver.
      fireEvent.scroll(log)
      act(() => observer.callback([], observer))
    },
  }
}

describe('assistant workspace lifecycle', () => {
  afterEach(() => vi.unstubAllGlobals())
  beforeEach(() => {
    setLocale('en')
    window.history.replaceState(null, '', '/assistant')
    mocks.create.mockReset()
    mocks.send.mockReset()
    mocks.messages = []
    HTMLElement.prototype.scrollTo = vi.fn()
  })

  it('does not hijack a selected saved conversation when an earlier create finishes late', async () => {
    let finishCreate!: (value: { id: string }) => void
    mocks.create.mockImplementation(
      () =>
        new Promise((resolve) => {
          finishCreate = resolve
        }),
    )
    render(<Harness />)
    fireEvent.change(screen.getByRole('textbox', { name: 'Ask about your department' }), {
      target: { value: 'First question' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }))
    expect(mocks.create).toHaveBeenCalledOnce()
    fireEvent.click(screen.getByRole('button', { name: 'Saved conversations' }))
    fireEvent.click(await screen.findByRole('button', { name: /Earlier priorities/ }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Ask about your department' }), {
      target: { value: 'Different draft' },
    })
    await act(async () => finishCreate({ id: createdId }))
    expect(window.location.search).toContain(existingId)
    expect(screen.getByRole('textbox', { name: 'Ask about your department' })).toHaveValue(
      'Different draft',
    )
    expect(mocks.send).not.toHaveBeenCalled()
    expect(await screen.findByRole('log')).toHaveAttribute('tabindex', '0')
  })

  it('does not send a question after its owning assistant unmounts during creation', async () => {
    let finishCreate!: (value: { id: string }) => void
    mocks.create.mockImplementation(
      () =>
        new Promise((resolve) => {
          finishCreate = resolve
        }),
    )
    const view = render(<Harness />)
    fireEvent.change(screen.getByRole('textbox', { name: 'Ask about your department' }), {
      target: { value: 'Question for the old department' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }))
    await waitFor(() => expect(mocks.create).toHaveBeenCalledOnce())
    view.unmount()
    await act(async () => finishCreate({ id: createdId }))
    expect(mocks.send).not.toHaveBeenCalled()
    expect(window.location.search).toBe('')
  })

  it('shows only the date when a saved briefing has no snapshot record counts', async () => {
    mocks.messages = [
      {
        id: createdId,
        role: 'assistant',
        content: 'Saved briefing',
        status: 'complete',
        error: null,
        createdAt: '2026-10-21T00:00:00Z',
        sources: [],
        context: {
          generatedAt: '2026-10-21T00:00:00Z',
          recordsIncluded: 0,
          recordsTotal: 0,
          historyMessages: 0,
          limited: false,
        },
      },
    ]
    window.history.replaceState(null, '', `/assistant?conversation=${existingId}`)
    render(<Harness />)
    await waitFor(() => expect(screen.getByText(/^Briefing · /)).toBeVisible())
    expect(screen.queryByText(/Based on 0 records/)).not.toBeInTheDocument()
  })

  it('keeps following through reflow and keyboard resizing even when scroll fires first', async () => {
    const { log, resize } = await scrollHarness()
    resize(1200, 250, 420)
    expect(log.scrollTop).toBe(950)
    resize(1220, 150, 920)
    expect(log.scrollTop).toBe(1070)
  })

  it('preserves deliberate reading positions through resize and resumes at the bottom', async () => {
    const { log, resize } = await scrollHarness()
    fireEvent.wheel(log, { deltaY: -100 })
    log.scrollTop = 400
    fireEvent.scroll(log)
    resize(1200, 250, 380)
    expect(log.scrollTop).toBe(380)
    fireEvent.keyDown(log, { key: 'Home', ctrlKey: true })
    log.scrollTop = 0
    fireEvent.scroll(log)
    resize(1300, 200, 0)
    expect(log.scrollTop).toBe(0)
    log.scrollTop = 1100
    fireEvent.scroll(log)
    resize(1500, 250, 1000)
    expect(log.scrollTop).toBe(1250)
  })

  it('does not detach on a pointer or touch tap, but respects a scrollbar drag', async () => {
    const { log, resize } = await scrollHarness()
    const pointerDown = () => {
      const event = createEvent.pointerDown(log)
      Object.defineProperty(event, 'pointerType', { value: 'mouse' })
      fireEvent(log, event)
    }
    pointerDown()
    fireEvent.pointerUp(window)
    fireEvent.touchStart(log, { touches: [{ clientY: 100 }] })
    fireEvent.touchEnd(log)
    resize(1200, 250, 400)
    expect(log.scrollTop).toBe(950)
    pointerDown()
    log.scrollTop = 600
    fireEvent.scroll(log)
    fireEvent.pointerUp(window)
    resize(1300, 200, 550)
    expect(log.scrollTop).toBe(550)
  })

  it('recognizes native scrollbar scrolling even when the browser omits pointer events', async () => {
    const { log, resize } = await scrollHarness()
    resize(800, 300, 500)
    log.scrollTop = 300
    fireEvent.scroll(log)
    resize(1200, 250, 280)
    expect(log.scrollTop).toBe(280)
  })
})
