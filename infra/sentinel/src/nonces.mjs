// Persisted nonce store (design.md §1.9: "nonce unseen (retention 300s)"). Traffic on this endpoint
// is operator-triggered and effectively never concurrent, so a small synchronous file is simpler to
// reason about correctly than a database or an in-memory structure that loses state on restart --
// and losing nonce history on restart is exactly the replay window risk (m) warns about.
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

export class NonceStore {
  #path
  #retentionMs

  constructor(path, retentionMs) {
    this.#path = path
    this.#retentionMs = retentionMs
    mkdirSync(dirname(path), { recursive: true })
  }

  #read(now) {
    if (!existsSync(this.#path)) return []
    const raw = readFileSync(this.#path, 'utf8').trim()
    if (!raw) return []
    const entries = []
    for (const line of raw.split('\n')) {
      if (!line) continue
      try {
        const e = JSON.parse(line)
        if (now - e.seenAt < this.#retentionMs) entries.push(e)
      } catch {
        // A corrupted line is dropped rather than crashing the sentinel over a log-file glitch.
      }
    }
    return entries
  }

  #write(entries) {
    const body = entries.map((e) => JSON.stringify(e)).join('\n')
    writeFileSync(this.#path, body.length ? body + '\n' : '')
  }

  /**
   * Returns true and records the nonce if it has not been seen within the retention window;
   * returns false (a replay) without altering the store's meaning if it has.
   */
  checkAndRecord(nonce, now = Date.now()) {
    const entries = this.#read(now)
    if (entries.some((e) => e.nonce === nonce)) {
      this.#write(entries) // still prunes expired entries on the way out
      return false
    }
    entries.push({ nonce, seenAt: now })
    this.#write(entries)
    return true
  }
}
