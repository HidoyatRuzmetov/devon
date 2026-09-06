// Image validation and avatar variants (TECH-SPEC §2.1: "512 px WebP variants"; §6: "sharp
// thumbnails"; H6.1: "avatars 64/128/512"). Two independent checks stand between uploaded bytes and
// libvips: the declared MIME must be on the allow-list, and the first bytes must carry that format's
// magic number (H1.6: "MIME (sniffed)") -- so a renamed `.exe` or an SVG (which can carry script)
// never reaches the decoder at all. sharp then decodes with a pixel budget (a 30 000 x 30 000 PNG is a
// few kilobytes on disk and gigabytes in memory), auto-orients from EXIF, and writes WebP with NO
// metadata -- the original's EXIF (camera serial, GPS position) is stripped by construction.
import sharp from 'sharp'

export const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const
export type AllowedImageType = (typeof ALLOWED_IMAGE_TYPES)[number]

export const AVATAR_SIZES = [64, 128, 512] as const
export type AvatarSize = (typeof AVATAR_SIZES)[number]

/** Refuse anything past this many pixels before decoding it (5 MiB of JPEG is fine; a decompression
 * bomb is not). 40 megapixels comfortably covers any phone camera. */
export const MAX_INPUT_PIXELS = 40_000_000

export class InvalidImage extends Error {
  constructor(
    public readonly reason: 'not_an_image' | 'mime_mismatch' | 'too_many_pixels' | 'decode_failed',
  ) {
    super(`invalid image: ${reason}`)
    this.name = 'InvalidImage'
  }
}

export function isAllowedImageType(value: string): value is AllowedImageType {
  return (ALLOWED_IMAGE_TYPES as readonly string[]).includes(value)
}

/** Magic-number sniff for exactly the three allowed formats; anything else is `null`. */
export function sniffImageType(bytes: Buffer): AllowedImageType | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg'
  }
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return 'image/png'
  }
  if (
    bytes.length >= 12 &&
    bytes.toString('ascii', 0, 4) === 'RIFF' &&
    bytes.toString('ascii', 8, 12) === 'WEBP'
  ) {
    return 'image/webp'
  }
  return null
}

/** sharp is an `export =` module; its `Metadata` type is reached through the instance rather than a
 * namespace import so this file does not depend on esModuleInterop's namespace merging. */
type SharpMetadata = Awaited<ReturnType<ReturnType<typeof sharp>['metadata']>>

const SHARP_FORMAT_TO_MIME: Record<string, AllowedImageType> = {
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
}

/** Throws `InvalidImage` unless `bytes` sniff as `declaredType` AND libvips agrees on the format and
 * the pixel budget. Returns the decoded dimensions (post-EXIF-orientation is irrelevant for a square
 * crop, so the raw ones are returned). */
export async function validateImage(
  bytes: Buffer,
  declaredType: AllowedImageType,
): Promise<{ width: number; height: number; format: AllowedImageType }> {
  const sniffed = sniffImageType(bytes)
  if (!sniffed) throw new InvalidImage('not_an_image')
  if (sniffed !== declaredType) throw new InvalidImage('mime_mismatch')

  let meta: SharpMetadata
  try {
    meta = await sharp(bytes, { limitInputPixels: MAX_INPUT_PIXELS, animated: false }).metadata()
  } catch {
    throw new InvalidImage('decode_failed')
  }
  const format = meta.format ? SHARP_FORMAT_TO_MIME[meta.format] : undefined
  if (!format || format !== declaredType) throw new InvalidImage('mime_mismatch')
  if (!meta.width || !meta.height) throw new InvalidImage('decode_failed')
  if (meta.width * meta.height > MAX_INPUT_PIXELS) throw new InvalidImage('too_many_pixels')
  return { width: meta.width, height: meta.height, format }
}

/** Square, centre-of-attention cropped WebP at every `AVATAR_SIZES` entry, metadata stripped. */
export async function makeAvatarVariants(
  bytes: Buffer,
): Promise<ReadonlyArray<{ size: AvatarSize; webp: Buffer }>> {
  const base = sharp(bytes, { limitInputPixels: MAX_INPUT_PIXELS, animated: false }).rotate()
  try {
    return await Promise.all(
      AVATAR_SIZES.map(async (size) => ({
        size,
        webp: await base
          .clone()
          .resize(size, size, { fit: 'cover', position: 'attention', withoutEnlargement: false })
          .webp({ quality: 82, effort: 4 })
          .toBuffer(),
      })),
    )
  } catch {
    throw new InvalidImage('decode_failed')
  }
}
