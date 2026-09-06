// Generic, symmetric apply/revert helpers for gate-mutation modules (EPIC-000.10).
//
// The whole harness stands or falls on revert being exact: a mutation module must leave the tree
// byte-identical to how it found it. These two helpers are the only way mutation modules touch the
// filesystem, so "did the revert work" is answerable by inspecting two functions, not eleven.
import { existsSync, mkdirSync, readFileSync, rmdirSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

/**
 * Read `relPath`, apply `transform(originalText) -> nextText`, write the result, and return a
 * revert function that restores the original bytes exactly. Throws if `transform` is a no-op --
 * a mutation that changes nothing would make the gate-mutation harness lie about what it tested.
 */
export function mutateFile(root, relPath, transform) {
  const abs = join(root, relPath)
  if (!existsSync(abs)) throw new Error(`mutateFile: ${relPath} does not exist`)
  const original = readFileSync(abs, 'utf8')
  const next = transform(original)
  if (typeof next !== 'string') throw new Error(`mutateFile: transform for ${relPath} did not return a string`)
  if (next === original) throw new Error(`mutateFile: transform for ${relPath} made no change`)
  writeFileSync(abs, next)
  let reverted = false
  return function revert() {
    if (reverted) return
    writeFileSync(abs, original)
    reverted = true
  }
}

/**
 * Create a brand-new file at `relPath` (must not already exist) with `content`, and return a revert
 * function that deletes it. Also removes any directories that this call created and that are empty
 * after the delete, so a mutation never leaves an untracked empty directory behind.
 */
export function createFile(root, relPath, content) {
  const abs = join(root, relPath)
  if (existsSync(abs)) throw new Error(`createFile: ${relPath} already exists -- refusing to overwrite`)
  const createdDirs = []
  let dir = dirname(abs)
  while (!existsSync(dir)) {
    createdDirs.push(dir)
    dir = dirname(dir)
  }
  mkdirSync(dirname(abs), { recursive: true })
  writeFileSync(abs, content)
  let reverted = false
  return function revert() {
    if (reverted) return
    unlinkSync(abs)
    // Remove only the directories this call created, deepest first, and only if now empty.
    for (const d of createdDirs) {
      try {
        rmdirSync(d)
      } catch {
        // Not empty (something else landed there, or a parent was already removed) -- leave it.
      }
    }
    reverted = true
  }
}

/** JSON-aware convenience wrapper over `mutateFile`: deletes a dotted key path from a JSON file. */
export function deleteJsonKeyPath(root, relPath, dottedKeyPath) {
  return mutateFile(root, relPath, (text) => {
    const obj = JSON.parse(text)
    const parts = dottedKeyPath.split('.')
    let node = obj
    for (let i = 0; i < parts.length - 1; i++) {
      node = node?.[parts[i]]
      if (node === undefined) throw new Error(`deleteJsonKeyPath: ${dottedKeyPath} not found in ${relPath}`)
    }
    const lastKey = parts[parts.length - 1]
    if (!(lastKey in node)) throw new Error(`deleteJsonKeyPath: ${dottedKeyPath} not found in ${relPath}`)
    delete node[lastKey]
    return JSON.stringify(obj, null, 2) + '\n'
  })
}

/** JSON-aware convenience wrapper over `mutateFile`: overwrites the value at a dotted key path. */
export function setJsonKeyPath(root, relPath, dottedKeyPath, value) {
  return mutateFile(root, relPath, (text) => {
    const obj = JSON.parse(text)
    const parts = dottedKeyPath.split('.')
    let node = obj
    for (let i = 0; i < parts.length - 1; i++) {
      node = node?.[parts[i]]
      if (node === undefined) throw new Error(`setJsonKeyPath: ${dottedKeyPath} not found in ${relPath}`)
    }
    const lastKey = parts[parts.length - 1]
    if (!(lastKey in node)) throw new Error(`setJsonKeyPath: ${dottedKeyPath} not found in ${relPath}`)
    node[lastKey] = value
    return JSON.stringify(obj, null, 2) + '\n'
  })
}
