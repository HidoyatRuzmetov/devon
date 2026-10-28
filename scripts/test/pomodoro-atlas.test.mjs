import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

test('all 360 generated frames have transparent boundaries and current playback coordinates', () => {
  const report = JSON.parse(
    execFileSync(
      process.execPath,
      [fileURLToPath(new URL('../../tools/assets/pomodoro-atlas.mjs', import.meta.url)), '--check'],
      { encoding: 'utf8', timeout: 30_000 },
    ),
  )
  assert.equal(report.length, 15)
  for (const sheet of report) {
    assert.equal(sheet.frames, 24, sheet.name)
    assert.equal(sheet.cutPixels, 0, sheet.name)
  }
})
