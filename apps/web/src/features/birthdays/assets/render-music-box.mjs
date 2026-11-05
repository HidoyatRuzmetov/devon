// Original synthesized instrumental performance. No samples or third-party sound recording.
// Tune reference/legal status: https://www.wipo.int/en/web/wipo-magazine/articles/in-the-courts-court-confirms-legal-status-of-happy-birthday-to-you-55581
// Reproduce WAV with Node, then encode: ffmpeg -i happy-birthday-music-box.wav -codec:a libmp3lame -b:a 128k happy-birthday-music-box.mp3
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const phrases = [
  [
    [67, 0.5],
    [67, 0.5],
    [69, 1],
    [67, 1],
    [72, 1],
    [71, 2],
  ],
  [
    [67, 0.5],
    [67, 0.5],
    [69, 1],
    [67, 1],
    [74, 1],
    [72, 2],
  ],
  [
    [67, 0.5],
    [67, 0.5],
    [79, 1],
    [76, 1],
    [72, 1],
    [71, 1],
    [69, 1],
  ],
  [
    [77, 0.5],
    [77, 0.5],
    [76, 1],
    [72, 1],
    [74, 1],
    [72, 2],
  ],
]
const rate = 44100,
  beat = 0.75,
  duration = 24
const samples = new Float64Array(rate * duration)
function bell(midi, start, level) {
  const hz = 440 * 2 ** ((midi - 69) / 12)
  const partials = [
    [1, 1, 1.25],
    [2.001, 0.32, 0.7],
    [2.997, 0.12, 0.38],
    [4.011, 0.045, 0.24],
    [5.98, 0.018, 0.13],
  ]
  const begin = Math.round(start * rate)
  for (let n = 0; n < rate * 3 && begin + n < samples.length; n++) {
    const t = n / rate,
      attack = Math.min(1, t / 0.006)
    let value = 0
    for (const [multiple, amount, decay] of partials)
      value += Math.sin(2 * Math.PI * hz * multiple * t) * amount * Math.exp(-t / decay)
    samples[begin + n] += value * attack * level
  }
}
let cursor = 0.65
for (let phrase = 0; phrase < phrases.length; phrase++) {
  for (const [note, length] of phrases[phrase]) {
    bell(note, cursor, 0.36)
    cursor += length * beat
  }
  // Sparse, soft tonic/dominant support; a music box rather than a ringtone.
  cursor += 0.35
}
for (const [note, time] of [
  [48, 0.65],
  [55, 5.5],
  [48, 10.4],
  [53, 15.9],
  [48, 19.8],
])
  bell(note, time, 0.06)
const stereo = [new Float64Array(samples.length), new Float64Array(samples.length)]
for (let i = 0; i < samples.length; i++) {
  for (let c = 0; c < 2; c++) {
    let value = samples[i]
    for (const [delay, gain] of [
      [0.071 + c * 0.012, 0.1],
      [0.149 + c * 0.009, 0.065],
      [0.251 + c * 0.011, 0.035],
    ]) {
      const offset = i - Math.round(delay * rate)
      if (offset >= 0) value += samples[offset] * gain
    }
    const fade = Math.min(1, (duration - i / rate) / 1.5)
    stereo[c][i] = value * fade
  }
}
let peak = 0
for (const channel of stereo) for (const value of channel) peak = Math.max(peak, Math.abs(value))
const bytes = samples.length * 4,
  buffer = Buffer.alloc(44 + bytes)
buffer.write('RIFF', 0)
buffer.writeUInt32LE(36 + bytes, 4)
buffer.write('WAVEfmt ', 8)
buffer.writeUInt32LE(16, 16)
buffer.writeUInt16LE(1, 20)
buffer.writeUInt16LE(2, 22)
buffer.writeUInt32LE(rate, 24)
buffer.writeUInt32LE(rate * 4, 28)
buffer.writeUInt16LE(4, 32)
buffer.writeUInt16LE(16, 34)
buffer.write('data', 36)
buffer.writeUInt32LE(bytes, 40)
for (let i = 0; i < samples.length; i++)
  for (let c = 0; c < 2; c++)
    buffer.writeInt16LE(Math.round((stereo[c][i] / peak) * 0.32 * 32767), 44 + (i * 2 + c) * 2)
writeFileSync(fileURLToPath(new URL('./happy-birthday-music-box.wav', import.meta.url)), buffer)
process.stdout.write(`Rendered ${duration}s original stereo music box; peak -9.9 dBFS.\n`)
