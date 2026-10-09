import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { setTimeout as pause } from 'node:timers/promises'
import { test } from 'node:test'
import { spawnManaged } from '../../apps/web/test/e2e/flow-process.ts'

async function running(pid, readStat = readFile) {
  try {
    const stat = await readStat(`/proc/${pid}/stat`, 'utf8')
    // A terminated child awaiting its container init's reaper is no longer a running server.
    return stat.slice(stat.lastIndexOf(')') + 2).split(' ')[0] !== 'Z'
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ESRCH') return false
    throw error
  }
}

test('process status handles disappeared Linux processes without hiding read failures', async () => {
  for (const code of ['ENOENT', 'ESRCH'])
    assert.equal(
      await running(123, async () => {
        throw Object.assign(new Error('fixture process disappeared'), { code })
      }),
      false,
    )
  assert.equal(await running(123, async () => '123 (fixture process) Z 1'), false)
  assert.equal(await running(123, async () => '123 (fixture process) S 1'), true)
  await assert.rejects(
    running(123, async () => {
      throw Object.assign(new Error('fixture access refused'), { code: 'EACCES' })
    }),
    { code: 'EACCES' },
  )
})

test(
  'Linux browser-test teardown stops the API launcher and its child server',
  { skip: process.platform !== 'linux' },
  async (t) => {
    const processTree = spawnManaged(
      process.execPath,
      [
        '-e',
        `
    const { spawn } = require('node:child_process');
      const server = spawn(process.execPath, ['-e', 'process.on("SIGTERM", () => {}); console.log("ready"); setInterval(() => {}, 1000)'], { stdio: ['ignore', 'pipe', 'ignore'] });
      server.stdout.once('data', () => console.log(JSON.stringify({ launcher: process.pid, server: server.pid })));
    setInterval(() => {}, 1000);
  `,
      ],
      { cwd: process.cwd(), env: process.env },
    )
    t.after(() => processTree.stop())
    for (let attempt = 0; attempt < 50 && processTree.lines.length === 0; attempt++)
      await pause(100)
    assert.ok(processTree.lines.length, 'launcher must start and report its child')
    const { launcher, server } = JSON.parse(processTree.lines[0])
    assert.ok(Number.isInteger(launcher) && Number.isInteger(server))
    assert.ok(await running(server), 'fixture server must really be running')
    await processTree.stop()
    for (let attempt = 0; attempt < 50 && (await running(server)); attempt++) await pause(100)
    assert.equal(await running(launcher), false, 'launcher must exit')
    assert.equal(
      await running(server),
      false,
      'child server must exit, releasing its port and database connections',
    )
  },
)
