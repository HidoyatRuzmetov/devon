import * as React from 'react'
import { Dialog, DialogContent } from '@devon/ui'
import { useT } from '@devon/i18n'
import { ArrowRight, Music2, RotateCcw, Volume2, X } from 'lucide-react'
import { useReducedMotion } from 'motion/react'
import { InkLetter } from './ink-letter.js'
import { useBirthdayMusic } from './use-birthday-music.js'
import './celebration.css'

export default function BirthdayCelebration({
  firstName,
  message,
  onClose,
  onSeen,
}: {
  firstName: string
  message: string
  onClose: () => void
  onSeen?: () => void
}) {
  const t = useT()
  const reduced = !!useReducedMotion()
  const [complete, setComplete] = React.useState(reduced)
  const [replay, setReplay] = React.useState(0)
  const receipt = React.useRef(false)
  const music = useBirthdayMusic()
  const closing = React.useRef(false)
  const close = () => {
    if (closing.current) return
    closing.current = true
    void music.stop().finally(onClose)
  }
  const musicActive = music.state === 'playing' || music.state === 'starting'
  const musicLabel = t(musicActive ? 'birthday.muteMusic' : 'birthday.playMusic')
  React.useEffect(() => {
    const acknowledge = () => {
      if (!receipt.current && document.visibilityState === 'visible') {
        receipt.current = true
        onSeen?.()
      }
    }
    acknowledge()
    document.addEventListener('visibilitychange', acknowledge)
    return () => document.removeEventListener('visibilitychange', acknowledge)
  }, [onSeen])
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) close()
      }}
    >
      <DialogContent
        title={t('birthday.title')}
        titleHidden
        showClose={false}
        className="birthday-celebration"
        aria-describedby="birthday-dedication"
      >
        {!reduced && (
          <div className="birthday-confetti" aria-hidden="true">
            {Array.from({ length: 52 }, (_, index) => (
              <i
                key={`${replay}-${index}`}
                style={
                  {
                    '--piece': index,
                    '--drift': `${((index * 47) % 260) - 130}px`,
                    '--turn': `${180 + ((index * 53) % 540)}deg`,
                    '--left': `${(index * 37) % 100}%`,
                    '--delay': `${(index % 13) * 0.065}s`,
                    '--duration': `${3.4 + (index % 7) * 0.23}s`,
                  } as React.CSSProperties
                }
              />
            ))}
          </div>
        )}
        <div className="birthday-paper">
          <button className="birthday-close" onClick={close} aria-label={t('birthday.close')}>
            <X size={20} strokeWidth={1.8} />
          </button>
          <header className="birthday-letter-heading">
            <span className="birthday-eyebrow">{t('birthday.eyebrow')}</span>
            <div className="birthday-flourish" aria-hidden="true">
              <span />✦<span />
            </div>
            <h2>
              {t('birthday.greeting')}
              <span>{firstName}.</span>
            </h2>
            <p id="birthday-dedication">{t('birthday.dedication')}</p>
          </header>
          <InkLetter
            key={replay}
            message={message}
            complete={complete}
            reducedMotion={reduced}
            onComplete={() => setComplete(true)}
          />
          <footer className="birthday-letter-actions">
            <button
              className="birthday-read birthday-music"
              onClick={music.toggle}
              aria-label={musicLabel}
              title={music.state === 'unavailable' ? t('birthday.musicUnavailable') : musicLabel}
              aria-pressed={music.state === 'playing'}
              data-birthday-music={music.state}
            >
              {musicActive ? <Volume2 size={15} /> : <Music2 size={15} />}
              <span>{musicLabel}</span>
            </button>
            <div className="birthday-action-buttons">
              {!complete && !reduced ? (
                <button className="birthday-read" onClick={() => setComplete(true)}>
                  {t('birthday.readNow')}
                </button>
              ) : !reduced ? (
                <button
                  className="birthday-read"
                  onClick={() => {
                    setComplete(false)
                    setReplay((value) => value + 1)
                  }}
                >
                  <RotateCcw size={14} />
                  {t('birthday.replay')}
                </button>
              ) : null}
              <button className="birthday-thanks" onClick={close}>
                {t('birthday.thankYou')}
                <ArrowRight size={16} />
              </button>
            </div>
          </footer>
        </div>
      </DialogContent>
    </Dialog>
  )
}
