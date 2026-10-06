import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, rm, writeFile, utimes } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { probeBackups, probeStorage } from '../../src/modules/admin/health-probes.js'

const dirs: string[] = []
async function temp() {
  const dir = await mkdtemp(join(tmpdir(), 'devon-health-'))
  dirs.push(dir)
  return dir
}
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe('health reflects real storage and completed backups', () => {
  it('uses the upload directory without requiring DEVON_STORAGE_DIR', async () => {
    expect((await probeStorage({ STORAGE_LOCAL_DIR: await temp() })).status).toBe('ok')
  })
  it('does not confuse a log, directory, or empty dump with a successful backup', async () => {
    const dir = await temp()
    await writeFile(join(dir, 'manifest.log'), 'recent log')
    await writeFile(join(dir, 'devon-empty.dump'), '')
    await mkdir(join(dir, 'devon-directory.dump'))
    expect((await probeBackups({ BACKUP_DIR: dir })).status).toBe('degraded')
  })
  it('reports stale backups even when unrelated logs are fresh', async () => {
    const dir = await temp()
    const file = join(dir, 'devon-test.dump.gpg')
    await writeFile(file, 'encrypted fixture')
    const old = new Date(Date.now() - 72 * 3_600_000)
    await utimes(file, old, old)
    await writeFile(join(dir, 'manifest.log'), 'fresh log')
    expect((await probeBackups({ BACKUP_DIR: dir })).status).toBe('degraded')
  })
  it('reads sanitized success metadata without access to database dumps', async () => {
    const file = join(await temp(), 'latest.json')
    await writeFile(file, JSON.stringify({ completedAt: new Date().toISOString(), bytes: 123 }))
    expect((await probeBackups({ DEVON_BACKUP_STATUS_FILE: file })).status).toBe('ok')
    await writeFile(file, JSON.stringify({ completedAt: new Date().toISOString(), bytes: 0 }))
    expect((await probeBackups({ DEVON_BACKUP_STATUS_FILE: file })).status).toBe('degraded')
  })
})
