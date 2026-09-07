// A minimal PNG decoder for exactly one thing: reading a single pixel's RGBA out of a screenshot
// Buffer, so a visual-regression assertion ("this pixel must not equal the flat background colour")
// needs no image-diffing dependency. Handles what Playwright's `page.screenshot()` actually produces
// -- 8-bit depth, colour type 2 (RGB) or 6 (RGBA), no interlacing -- via Node's built-in `zlib`
// rather than a PNG library; anything else throws rather than silently misreading.
import { inflateSync } from 'node:zlib'

interface DecodedPng {
  width: number
  height: number
  channels: 3 | 4
  data: Buffer
}

function readChunks(png: Buffer): { type: string; data: Buffer }[] {
  const chunks: { type: string; data: Buffer }[] = []
  let offset = 8 // skip the 8-byte PNG signature
  while (offset < png.length) {
    const length = png.readUInt32BE(offset)
    const type = png.toString('ascii', offset + 4, offset + 8)
    const data = png.subarray(offset + 8, offset + 8 + length)
    chunks.push({ type, data })
    offset += 8 + length + 4 // length + type + data + CRC
  }
  return chunks
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c
  const pa = Math.abs(p - a)
  const pb = Math.abs(p - b)
  const pc = Math.abs(p - c)
  if (pa <= pb && pa <= pc) return a
  if (pb <= pc) return b
  return c
}

function unfilter(raw: Buffer, width: number, height: number, channels: number): Buffer {
  const stride = width * channels
  const out = Buffer.alloc(stride * height)
  let rawOffset = 0
  for (let y = 0; y < height; y++) {
    const filterType = raw[rawOffset]
    rawOffset += 1
    const rowStart = y * stride
    const prevRowStart = (y - 1) * stride
    for (let x = 0; x < stride; x++) {
      const raw_x = raw[rawOffset + x]!
      const a = x >= channels ? out[rowStart + x - channels]! : 0
      const b = y > 0 ? out[prevRowStart + x]! : 0
      const c = y > 0 && x >= channels ? out[prevRowStart + x - channels]! : 0
      let value: number
      switch (filterType) {
        case 0:
          value = raw_x
          break
        case 1:
          value = raw_x + a
          break
        case 2:
          value = raw_x + b
          break
        case 3:
          value = raw_x + Math.floor((a + b) / 2)
          break
        case 4:
          value = raw_x + paeth(a, b, c)
          break
        default:
          throw new Error(`[png-pixel] unsupported PNG filter type ${filterType}`)
      }
      out[rowStart + x] = value & 0xff
    }
    rawOffset += stride
  }
  return out
}

function decodePng(png: Buffer): DecodedPng {
  if (png.toString('hex', 0, 8) !== '89504e470d0a1a0a')
    throw new Error('[png-pixel] not a PNG file')
  const chunks = readChunks(png)
  const ihdr = chunks.find((c) => c.type === 'IHDR')
  if (!ihdr) throw new Error('[png-pixel] missing IHDR chunk')
  const width = ihdr.data.readUInt32BE(0)
  const height = ihdr.data.readUInt32BE(4)
  const bitDepth = ihdr.data.readUInt8(8)
  const colorType = ihdr.data.readUInt8(9)
  const interlace = ihdr.data.readUInt8(12)
  if (bitDepth !== 8 || interlace !== 0 || (colorType !== 2 && colorType !== 6)) {
    throw new Error(
      `[png-pixel] unsupported PNG (bitDepth=${bitDepth} colorType=${colorType} interlace=${interlace}) -- expected the plain 8-bit RGB(A) output Playwright's screenshot() produces`,
    )
  }
  const channels = colorType === 6 ? 4 : 3
  const idat = Buffer.concat(chunks.filter((c) => c.type === 'IDAT').map((c) => c.data))
  const raw = inflateSync(idat)
  const data = unfilter(raw, width, height, channels)
  return { width, height, channels, data }
}

export interface Rgba {
  r: number
  g: number
  b: number
  a: number
}

/** Reads one pixel out of a screenshot `Buffer` (as returned by Playwright's `page.screenshot()` or
 * `locator.screenshot()`) at `(x, y)` in that image's own pixel coordinates. */
export function readPixel(png: Buffer, x: number, y: number): Rgba {
  const decoded = decodePng(png)
  if (x < 0 || y < 0 || x >= decoded.width || y >= decoded.height) {
    throw new Error(
      `[png-pixel] (${x}, ${y}) is outside the ${decoded.width}x${decoded.height} image`,
    )
  }
  const offset = (y * decoded.width + x) * decoded.channels
  return {
    r: decoded.data[offset]!,
    g: decoded.data[offset + 1]!,
    b: decoded.data[offset + 2]!,
    a: decoded.channels === 4 ? decoded.data[offset + 3]! : 255,
  }
}
