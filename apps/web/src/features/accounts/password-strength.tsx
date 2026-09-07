// A client-side strength meter for `/register`'s password field (TECH-SPEC §2.1: "password
// (argon2id, >=12 chars, breach-list check, no composition rules)"). The server owns every real
// rule -- length and the breach list -- this component invents nothing the server would reject or
// accept differently; it only turns the *shape* of what someone already typed into an immediate,
// wordless signal so they do not learn "too weak" for the first time from a failed submit. Four
// bands, `Progress`'s existing `tone` values (`packages/ui/src/primitives/progress.tsx`), never a
// raw colour.
import * as React from 'react'
import { useT } from '@devon/i18n'
import { Progress } from '@devon/ui'

export type PasswordStrength = 'weak' | 'fair' | 'good' | 'strong'

const TONE: Record<PasswordStrength, 'destructive' | 'warning' | 'primary' | 'success'> = {
  weak: 'destructive',
  fair: 'warning',
  good: 'primary',
  strong: 'success',
}

const LABEL_KEY: Record<PasswordStrength, string> = {
  weak: 'accounts.register.passwordStrength.weak',
  fair: 'accounts.register.passwordStrength.fair',
  good: 'accounts.register.passwordStrength.good',
  strong: 'accounts.register.passwordStrength.strong',
}

/** A small, transparent point count -- length past the server's own 12-char floor, plus one point
 * per character class present -- mapped to four bands. Never claims to model actual entropy or the
 * server's breach-list check; it is a nudge, not a verdict. */
export function passwordStrength(password: string): PasswordStrength | null {
  if (password.length === 0) return null
  let score = 0
  if (password.length >= 12) score += 1
  if (password.length >= 16) score += 1
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score += 1
  if (/[0-9]/.test(password)) score += 1
  if (/[^a-zA-Z0-9]/.test(password)) score += 1
  if (score <= 1) return 'weak'
  if (score === 2) return 'fair'
  if (score === 3) return 'good'
  return 'strong'
}

const STRENGTH_PERCENT: Record<PasswordStrength, number> = {
  weak: 25,
  fair: 50,
  good: 75,
  strong: 100,
}

export function PasswordStrengthMeter({ password }: { password: string }) {
  const t = useT()
  const strength = passwordStrength(password)
  if (strength === null) return null

  return (
    <div className="flex flex-col gap-1.5" aria-live="polite">
      <Progress
        value={STRENGTH_PERCENT[strength]}
        tone={TONE[strength]}
        size="sm"
        label={t('accounts.register.passwordStrength.label')}
      />
      <span className="text-caption text-muted-foreground">{t(LABEL_KEY[strength])}</span>
    </div>
  )
}
