// Profile-photo picker (EPIC-001, TECH-SPEC §2.1 "photo (optional)"). One component, two callers:
// `/register` keeps the chosen file local until the account exists (`onSelect` only), `/account`
// uploads on selection (`onSelect` starts `uploadAvatar`, `busy` narrates the two server stages).
// A native `<input type="file">` behind a real button: the OS picker is the only file UI that is
// accessible, localised and mobile-friendly for free; nothing here re-implements it.
import * as React from 'react'
import { useT } from '@devon/i18n'
import { Avatar, Button } from '@devon/ui'
import { AVATAR_ACCEPT, type AvatarUploadStage } from './api.js'

export interface AvatarPickerProps {
  /** The photo already on the account (`avatarUrl(user.avatarKey, 128)`), if any. */
  currentSrc: string | null
  /** A file chosen but not (yet) uploaded -- previewed locally through an object URL. */
  file: File | null
  alt: string
  initials: string
  hueSeed: string
  onSelect: (file: File) => void
  onRemove: () => void
  busy?: AvatarUploadStage | null
  /** i18n key of the message to show under the picker, or `null`. */
  errorKey?: string | null
  disabled?: boolean
}

function useObjectUrl(file: File | null): string | null {
  const [url, setUrl] = React.useState<string | null>(null)
  React.useEffect(() => {
    if (!file) {
      setUrl(null)
      return
    }
    const next = URL.createObjectURL(file)
    setUrl(next)
    return () => URL.revokeObjectURL(next)
  }, [file])
  return url
}

export function AvatarPicker({
  currentSrc,
  file,
  alt,
  initials,
  hueSeed,
  onSelect,
  onRemove,
  busy = null,
  errorKey = null,
  disabled = false,
}: AvatarPickerProps) {
  const t = useT()
  const inputRef = React.useRef<HTMLInputElement>(null)
  const previewUrl = useObjectUrl(file)
  const src = previewUrl ?? currentSrc
  const hasPhoto = src !== null
  const inputId = React.useId()
  const hintId = `${inputId}-hint`
  const statusId = `${inputId}-status`

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = e.target.files?.[0]
    // Reset so choosing the same file again after a failure still fires `change`.
    e.target.value = ''
    if (picked) onSelect(picked)
  }

  return (
    <div className="flex items-start gap-4">
      <Avatar
        src={src}
        alt={alt}
        initials={initials}
        hueSeed={hueSeed}
        size="lg"
        className="size-24 text-h3"
      />
      <div className="flex min-w-0 flex-col gap-2">
        <input
          ref={inputRef}
          id={inputId}
          type="file"
          accept={AVATAR_ACCEPT}
          className="sr-only"
          aria-describedby={hintId}
          disabled={disabled || busy !== null}
          onChange={handleChange}
        />
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            loading={busy !== null}
            disabled={disabled}
            onClick={() => inputRef.current?.click()}
          >
            {t(hasPhoto ? 'accounts.photo.change' : 'accounts.photo.choose')}
          </Button>
          {hasPhoto ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={disabled || busy !== null}
              onClick={onRemove}
            >
              {t('accounts.photo.remove')}
            </Button>
          ) : null}
        </div>
        <p id={hintId} className="text-small text-muted-foreground">
          {t('accounts.photo.hint')}
        </p>
        {busy ? (
          <p id={statusId} role="status" aria-live="polite" className="text-small text-foreground">
            {t(busy === 'uploading' ? 'accounts.photo.uploading' : 'accounts.photo.scanning')}
          </p>
        ) : null}
        {errorKey ? (
          <p role="alert" className="text-small text-destructive">
            {t(errorKey)}
          </p>
        ) : null}
      </div>
    </div>
  )
}
