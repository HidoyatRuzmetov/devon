import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Locale } from '@devon/i18n'

/** Read maintained locale modules, rather than guessing translated control names in browser tests. */
export function visualLabel(module: string, locale: Locale, key: string): string {
  const path = join(
    import.meta.dirname,
    '../../../../packages/i18n/messages/modules',
    module,
    `${locale}.json`,
  )
  let value: unknown = JSON.parse(readFileSync(path, 'utf8'))
  for (const segment of key.split('.')) value = (value as Record<string, unknown>)[segment]
  if (typeof value !== 'string')
    throw new Error(`Missing maintained QA label: ${module}/${locale}/${key}`)
  return value
}
