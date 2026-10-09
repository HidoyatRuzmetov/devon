import { z } from 'zod'

const timestamp = z.iso.datetime({ offset: true })
const cursor = z.object({ version: z.literal(1), at: timestamp, id: z.string().uuid() }).strict()

/** Old callers may still supply the former ISO timestamp cursor. Keep its strictly-before
 * semantics; newly issued cursors include the tie-breaker and exact database microseconds. */
export function decodeRunCursor(value: string): { at: string; id: string | null } | null {
  if (timestamp.safeParse(value).success) return { at: value, id: null }
  try {
    const parsed = cursor.safeParse(JSON.parse(Buffer.from(value, 'base64url').toString('utf8')))
    return parsed.success ? { at: parsed.data.at, id: parsed.data.id } : null
  } catch {
    return null
  }
}

export function encodeRunCursor(at: string, id: string): string {
  return Buffer.from(JSON.stringify({ version: 1, at, id })).toString('base64url')
}

export const runCursorSchema = z
  .string()
  .max(400)
  .refine((value) => decodeRunCursor(value) !== null, {
    message: 'invalid_cursor',
  })
