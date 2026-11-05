import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  BirthdayMusicPlayer,
  BIRTHDAY_MUSIC_VOLUME,
  type BirthdayMusicState,
} from '../../src/features/birthdays/music-player.js'

class Media extends EventTarget {
  volume = 1
  loop = true
  preload = ''
  paused = true
  ended = false
  error = null
  currentTime = 0
  play = vi.fn(async () => {
    this.paused = false
    this.dispatchEvent(new Event('playing'))
  })
  pause = vi.fn(() => {
    this.paused = true
  })
  load = vi.fn()
  removeAttribute = vi.fn()
}
function setup() {
  const audio = new Media(),
    states: BirthdayMusicState[] = []
  const player = new BirthdayMusicPlayer(audio as unknown as HTMLAudioElement, (state) =>
    states.push(state),
  )
  return { audio, states, player }
}
afterEach(() => vi.useRealTimers())
describe('birthday music lifecycle', () => {
  it('reports blocked autoplay honestly, and plays only after the gesture retry succeeds', async () => {
    const { audio, states, player } = setup()
    audio.play.mockRejectedValueOnce(new DOMException('Autoplay blocked', 'NotAllowedError'))
    await player.play()
    expect(states).toEqual(['starting', 'blocked'])
    expect(audio.paused).toBe(true)
    await player.play()
    expect(states.at(-1)).toBe('playing')
    expect(audio.loop).toBe(false)
    expect(audio.volume).toBe(BIRTHDAY_MUSIC_VOLUME)
    player.dispose()
  })
  it('fades then pauses when hidden or dismissed, and does not revive a pending playback', async () => {
    vi.useFakeTimers()
    const { audio, states, player } = setup()
    await player.play()
    const stopped = player.stop()
    vi.advanceTimersByTime(80)
    expect(audio.volume).toBeLessThan(BIRTHDAY_MUSIC_VOLUME)
    vi.advanceTimersByTime(80)
    await stopped
    expect(audio.paused).toBe(true)
    expect(states.at(-1)).toBe('off')
    let resolve!: () => void
    audio.play.mockImplementationOnce(
      () =>
        new Promise<void>((done) => {
          resolve = done
        }),
    )
    const pending = player.play()
    player.dispose()
    const length = states.length
    resolve()
    await pending
    expect(states).toHaveLength(length)
    expect(audio.paused).toBe(true)
  })
  it('ends after one performance and explicit play starts the melody again', async () => {
    const { audio, states, player } = setup()
    await player.play()
    audio.ended = true
    audio.currentTime = 24
    audio.dispatchEvent(new Event('ended'))
    expect(states.at(-1)).toBe('ended')
    await player.play()
    expect(audio.currentTime).toBe(0)
    player.dispose()
  })
})
