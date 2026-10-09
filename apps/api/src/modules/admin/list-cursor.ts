import { z } from 'zod'
const timestamp = z.iso.datetime({ offset: true })
const id = z.string().uuid()
export const adminListCursorSchema = z
  .string()
  .max(100)
  .refine((value) => {
    const parts = value.split('|')
    return (
      parts.length === 2 && timestamp.safeParse(parts[0]).success && id.safeParse(parts[1]).success
    )
  }, 'Invalid administrative list cursor')

/** Preserve the legacy timestamp|UUID contract, including old millisecond bookmarks. New
 * timestamps retain Postgres microseconds; parsing through Date would silently lose them. */
export function parseAdminListCursor(value: string) {
  if (!adminListCursorSchema.safeParse(value).success) {
    throw Object.assign(new Error('Invalid administrative list cursor'), { statusCode: 422 })
  }
  const [createdAt, rowId] = value.split('|')
  return { createdAt: createdAt!, id: rowId! }
}
