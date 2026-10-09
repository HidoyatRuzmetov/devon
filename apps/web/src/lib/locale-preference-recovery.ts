import { LOCALES, type Locale } from '@devon/i18n'

export const LOCALE_PREFERENCE_RECOVERY_KEY = ['locale-preference-recovery'] as const
const STORAGE_KEY = 'devon_unsaved_locale'

export type LocalePreferenceRecovery = {
  locale: Locale
  ownerUserId: string
  status: 'pending' | 'failed'
  showNotice: boolean
}

/** Store only the last owner's choice, never credentials or other session/profile fields. A
 * document lost before acknowledgement offers an explicit retry; it never sends a hidden write. */
export function readLocalePreferenceRecovery(): LocalePreferenceRecovery | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const value: unknown = JSON.parse(raw)
    if (!value || typeof value !== 'object') return null
    const receipt = value as Record<string, unknown>
    if (
      typeof receipt['ownerUserId'] !== 'string' ||
      !receipt['ownerUserId'] ||
      !(LOCALES as readonly unknown[]).includes(receipt['locale'])
    )
      return null
    return {
      locale: receipt['locale'] as Locale,
      ownerUserId: receipt['ownerUserId'],
      status: 'failed',
      showNotice: true,
    }
  } catch {
    return null
  }
}

export function persistLocalePreferenceRecovery(receipt: LocalePreferenceRecovery | null): void {
  try {
    if (receipt)
      window.localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ locale: receipt.locale, ownerUserId: receipt.ownerUserId }),
      )
    else window.localStorage.removeItem(STORAGE_KEY)
  } catch {
    // Storage-disabled browsers still show recovery for the current document.
  }
}
