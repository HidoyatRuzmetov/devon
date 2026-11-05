export type BirthdayMusicState =
  | 'off'
  | 'starting'
  | 'playing'
  | 'blocked'
  | 'ended'
  | 'unavailable'
// The asset itself is mastered quietly (-9.9 dBFS peak) for platforms with fixed media volume.
export const BIRTHDAY_MUSIC_VOLUME = 0.5

/** Native play() is the authority: browsers may reject autoplay, and a pending play is never
 * reported as audible. No WebAudio contexts or global player survive a celebration. */
export class BirthdayMusicPlayer {
  private generation = 0
  private disposed = false
  private wanted = false
  private fade: ReturnType<typeof setInterval> | undefined
  private fadeDone: (() => void) | undefined
  private playing = () => {
    if (this.wanted && !this.disposed) this.changed('playing')
    else this.audio.pause()
  }
  private ended = () => {
    this.wanted = false
    if (!this.disposed) this.changed('ended')
  }
  private error = () => {
    this.wanted = false
    if (!this.disposed) this.changed('unavailable')
  }
  constructor(
    private audio: HTMLAudioElement,
    private changed: (state: BirthdayMusicState) => void,
  ) {
    audio.volume = BIRTHDAY_MUSIC_VOLUME
    audio.loop = false
    audio.preload = 'auto'
    audio.addEventListener('playing', this.playing)
    audio.addEventListener('ended', this.ended)
    audio.addEventListener('error', this.error)
  }
  private cancelFade() {
    clearInterval(this.fade)
    this.fade = undefined
    this.fadeDone?.()
    this.fadeDone = undefined
  }
  async play() {
    if (this.disposed) return
    this.cancelFade()
    const generation = ++this.generation
    this.wanted = true
    this.audio.volume = BIRTHDAY_MUSIC_VOLUME
    if (this.audio.ended) this.audio.currentTime = 0
    if (this.audio.error) this.audio.load()
    this.changed('starting')
    try {
      await this.audio.play()
      if (!this.disposed && generation === this.generation && this.wanted && !this.audio.paused)
        this.changed('playing')
    } catch (error) {
      if (!this.disposed && generation === this.generation) {
        this.wanted = false
        this.changed(
          error && typeof error === 'object' && 'name' in error && error.name === 'NotAllowedError'
            ? 'blocked'
            : 'unavailable',
        )
      }
    }
  }
  stop(fade = true): Promise<void> {
    ++this.generation
    this.wanted = false
    this.cancelFade()
    if (!this.disposed) this.changed('off')
    if (!fade || this.audio.paused) {
      this.audio.pause()
      return Promise.resolve()
    }
    const initial = this.audio.volume
    return new Promise((resolve) => {
      this.fadeDone = resolve
      let step = 0
      this.fade = setInterval(() => {
        this.audio.volume = initial * Math.max(0, 1 - ++step / 8)
        if (step >= 8) {
          this.audio.pause()
          this.cancelFade()
        }
      }, 20)
    })
  }
  dispose() {
    this.disposed = true
    ++this.generation
    this.wanted = false
    this.cancelFade()
    this.audio.pause()
    this.audio.removeEventListener('playing', this.playing)
    this.audio.removeEventListener('ended', this.ended)
    this.audio.removeEventListener('error', this.error)
    this.audio.removeAttribute('src')
    this.audio.load()
  }
}
