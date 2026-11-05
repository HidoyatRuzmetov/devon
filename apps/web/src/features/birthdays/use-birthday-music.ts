import * as React from 'react'
import { BirthdayMusicPlayer, type BirthdayMusicState } from './music-player.js'

const musicAsset = new URL('./assets/happy-birthday-music-box.mp3', import.meta.url).href
const preferenceKey = 'workportal.birthday.music-muted'
export function useBirthdayMusic() {
  const [state, setState] = React.useState<BirthdayMusicState>('off')
  const player = React.useRef<BirthdayMusicPlayer | null>(null)
  React.useEffect(() => {
    const audio = new Audio(musicAsset)
    const current = new BirthdayMusicPlayer(audio, setState)
    player.current = current
    let muted = false
    try {
      muted = localStorage.getItem(preferenceKey) === 'true'
    } catch {
      /* Storage is optional. */
    }
    if (!muted && document.visibilityState === 'visible') void current.play()
    const visibility = () => {
      if (document.visibilityState !== 'visible') void current.stop()
    }
    document.addEventListener('visibilitychange', visibility)
    return () => {
      document.removeEventListener('visibilitychange', visibility)
      current.dispose()
      if (player.current === current) player.current = null
    }
  }, [])
  const toggle = () => {
    const mute = state === 'playing' || state === 'starting'
    try {
      localStorage.setItem(preferenceKey, String(mute))
    } catch {
      /* Storage is optional. */
    }
    if (mute) void player.current?.stop()
    else void player.current?.play()
  }
  return { state, toggle, stop: () => player.current?.stop() ?? Promise.resolve() }
}
