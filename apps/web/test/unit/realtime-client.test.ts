import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const fixture = vi.hoisted(() => ({
  clients: [] as Array<{
    state: string
    connect: ReturnType<typeof vi.fn>
    disconnect: ReturnType<typeof vi.fn>
    handlers: Map<string, () => void>
  }>,
}))
vi.mock('../../src/lib/realtime/api.js', () => ({
  fetchRealtimeConfig: vi.fn(),
  fetchConnectionToken: vi.fn(),
  fetchSubscriptionToken: vi.fn(),
}))
vi.mock('centrifuge', () => ({
  Centrifuge: class {
    state = 'disconnected'
    handlers = new Map<string, () => void>()
    connect = vi.fn(() => {
      this.state = 'connecting'
    })
    disconnect = vi.fn(() => {
      this.state = 'disconnected'
    })
    constructor() {
      fixture.clients.push(this)
    }
    on(name: string, handler: () => void) {
      this.handlers.set(name, handler)
    }
  },
}))
import { fetchRealtimeConfig } from '../../src/lib/realtime/api.js'
import {
  ensureRealtimeConnection,
  realtimeChannels,
  realtimeStatus,
  resetRealtime,
  subscribeChannel,
} from '../../src/lib/realtime/client.js'

const config = {
  enabled: true,
  url: 'wss://fixture.invalid/realtime/connection/websocket',
  channels: { personal: 'personal#fixture', department: 'dept:fixture', board: 'board:fixture' },
  ttlSeconds: 600,
}

describe('realtime connection lifetime', () => {
  beforeEach(() => {
    fixture.clients.length = 0
    vi.mocked(fetchRealtimeConfig).mockReset().mockResolvedValue(config)
  })
  afterEach(() => resetRealtime())

  it('cannot restore the previous session after reset while config is in flight', async () => {
    let resolve!: (value: typeof config) => void
    vi.mocked(fetchRealtimeConfig).mockReturnValueOnce(
      new Promise((done) => {
        resolve = done
      }),
    )
    const pending = ensureRealtimeConnection()
    resetRealtime()
    resolve(config)
    await pending
    expect(realtimeChannels()).toBeNull()
    expect(realtimeStatus()).toBe('idle')
    expect(fixture.clients).toHaveLength(0)
    await ensureRealtimeConnection()
    expect(fixture.clients).toHaveLength(1)
  })

  it('recovers from a failed initial config request on the next attempt', async () => {
    vi.mocked(fetchRealtimeConfig).mockRejectedValueOnce(new Error('offline'))
    await ensureRealtimeConnection()
    expect(realtimeStatus()).toBe('error')
    await ensureRealtimeConnection()
    expect(fixture.clients).toHaveLength(1)
    expect(fixture.clients[0]!.connect).toHaveBeenCalledOnce()
  })

  it('starts a connection even when only the personal server subscription is requested', async () => {
    const unsubscribe = subscribeChannel('personal#fixture', () => {})
    await vi.waitFor(() => expect(fixture.clients).toHaveLength(1))
    expect(fixture.clients[0]!.connect).toHaveBeenCalledOnce()
    unsubscribe()
  })

  it('ignores late transport events from a signed-out session', async () => {
    await ensureRealtimeConnection()
    const previous = fixture.clients[0]!
    resetRealtime()
    previous.handlers.get('error')!()
    previous.handlers.get('connected')!()
    expect(realtimeStatus()).toBe('idle')
  })

  it('retries a terminally disconnected client and shares a concurrent bootstrap', async () => {
    await Promise.all([ensureRealtimeConnection(), ensureRealtimeConnection()])
    expect(fixture.clients).toHaveLength(1)
    fixture.clients[0]!.state = 'disconnected'
    await ensureRealtimeConnection()
    expect(fixture.clients[0]!.connect).toHaveBeenCalledTimes(2)
  })
})
