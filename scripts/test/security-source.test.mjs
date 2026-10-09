import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import test from 'node:test'
import { repositorySourcePath, stageRepositorySource } from '../../tools/security/source-stage.mjs'

function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'devon-source-stage-test-'))
  t.after(() => {
    assert.ok(resolve(directory).startsWith(resolve(tmpdir()) + sep + 'devon-source-stage-test-'))
    rmSync(directory, { recursive: true, force: true })
  })
  assert.equal(spawnSync('git', ['init', '--quiet'], { cwd: directory }).status, 0)
  return directory
}

test('source scan stages current tracked and new files, including tracked ignored files', (t) => {
  const directory = fixture(t)
  writeFileSync(join(directory, '.gitignore'), 'artifacts/\n.tmp/\n')
  mkdirSync(join(directory, 'artifacts'))
  mkdirSync(join(directory, '.tmp'))
  writeFileSync(join(directory, 'source.ts'), 'tracked before modification')
  writeFileSync(join(directory, 'deleted.ts'), 'will be deleted')
  writeFileSync(join(directory, 'artifacts/tracked.ts'), 'tracked ignored source must be scanned')
  assert.equal(
    spawnSync(
      'git',
      ['add', '-f', '.gitignore', 'source.ts', 'deleted.ts', 'artifacts/tracked.ts'],
      { cwd: directory },
    ).status,
    0,
  )
  writeFileSync(join(directory, 'source.ts'), 'actual current modified source')
  rmSync(join(directory, 'deleted.ts'))
  writeFileSync(join(directory, 'new.ts'), 'new candidate source')
  writeFileSync(join(directory, 'artifacts/generated.json'), 'ignored generated evidence')
  writeFileSync(join(directory, '.tmp/session.json'), 'ignored synthetic credentials')
  const staged = stageRepositorySource(directory)
  t.after(() => staged.cleanup())
  assert.deepEqual(
    staged.manifest.map((file) => file.path),
    ['.gitignore', 'artifacts/tracked.ts', 'new.ts', 'source.ts'],
  )
  assert.equal(
    readFileSync(join(staged.directory, 'source.ts'), 'utf8'),
    'actual current modified source',
  )
  assert.equal(
    staged.manifest.find((file) => file.path === 'source.ts').sha256,
    createHash('sha256').update('actual current modified source').digest('hex'),
  )
  assert.equal(existsSync(join(staged.directory, '.tmp/session.json')), false)
  staged.cleanup()
  assert.equal(existsSync(staged.directory), false)
})

test('source scan refuses traversal and links before reading linked bytes', (t) => {
  const directory = fixture(t)
  assert.throws(() => repositorySourcePath(directory, '../outside'), /leaves the repository/)
  assert.throws(
    () => repositorySourcePath(directory, resolve(directory, '..', 'outside')),
    /Unsafe/,
  )
  assert.throws(() => repositorySourcePath(directory, ''), /Unsafe/)
  mkdirSync(join(directory, 'original'))
  symlinkSync(join(directory, 'original'), join(directory, 'linked'), 'junction')
  assert.throws(() => repositorySourcePath(directory, 'linked/file.ts'), /Source links/)
})

test('source scan refuses a nonrepository or an empty candidate', (t) => {
  const directory = fixture(t)
  assert.throws(() => stageRepositorySource(directory), /vacuous/)
  mkdirSync(join(directory, 'unrelated'))
  const outside = mkdtempSync(join(tmpdir(), 'devon-source-stage-test-'))
  try {
    assert.throws(() => stageRepositorySource(outside), /enumerate/)
  } finally {
    assert.ok(resolve(outside).startsWith(resolve(tmpdir()) + sep + 'devon-source-stage-test-'))
    rmSync(outside, { recursive: true, force: true })
  }
})
