import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  existsSync,
  lstatSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'

export function repositorySourcePath(root, name) {
  if (!name || name.includes('\0') || isAbsolute(name)) throw new Error('Unsafe source path')
  const path = resolve(root, name)
  const within = relative(resolve(root), path)
  if (!within || within === '..' || within.startsWith(`..${sep}`) || isAbsolute(within))
    throw new Error('Source path leaves the repository')
  let current = resolve(root)
  for (const segment of within.split(sep)) {
    current = join(current, segment)
    try {
      if (lstatSync(current).isSymbolicLink())
        throw new Error('Source links are not accepted in a candidate scan')
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
    }
  }
  return path
}

/** Scan the current candidate files, including unstaged changes and nonignored new source.
 * Tracked files remain included even if a later ignore rule matches them. Generated ignored
 * browser videos, dependency trees and credentials are not release source. */
export function stageRepositorySource(root) {
  const listed = spawnSync(
    'git',
    ['ls-files', '-z', '--cached', '--others', '--exclude-standard'],
    {
      cwd: root,
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
    },
  )
  if (listed.error) throw listed.error
  if (listed.status !== 0) throw new Error('Cannot enumerate the Git candidate source')
  const stage = mkdtempSync(join(tmpdir(), 'devon-security-source-'))
  function cleanup() {
    if (!resolve(stage).startsWith(resolve(tmpdir()) + sep + 'devon-security-source-'))
      throw new Error('Refusing cleanup outside the owned security source directory')
    rmSync(stage, { recursive: true, force: true })
  }
  try {
    const manifest = []
    for (const name of [...new Set(listed.stdout.split('\0').filter(Boolean))].sort()) {
      const original = repositorySourcePath(root, name)
      if (!existsSync(original)) continue // A deleted tracked file is absent from this candidate.
      if (!lstatSync(original).isFile()) throw new Error('Candidate source is not a regular file')
      const destination = repositorySourcePath(stage, name)
      const bytes = readFileSync(original)
      mkdirSync(dirname(destination), { recursive: true })
      writeFileSync(destination, bytes)
      manifest.push({ path: name, sha256: createHash('sha256').update(bytes).digest('hex') })
    }
    if (!manifest.length) throw new Error('Refusing a vacuous source security scan')
    return { directory: stage, manifest, cleanup }
  } catch (error) {
    cleanup()
    throw error
  }
}
