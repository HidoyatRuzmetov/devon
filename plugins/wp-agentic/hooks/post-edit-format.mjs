#!/usr/bin/env node
// PostToolUse on Edit/Write/MultiEdit: format the touched code file with the repo's prettier if present.
// Never fails, never blocks. Skips markdown/docs so authored formatting survives.
import { existsSync, readFileSync } from 'node:fs'
import { join, resolve, extname } from 'node:path'
import { spawnSync } from 'node:child_process'
import { readInput, projectRoot } from './_io.mjs'

const input = await readInput()

// Plugin copy: if the project wires its own agentic/hooks in .claude/settings.json, defer to them.
{ const __r = projectRoot(input); try { const __s = readFileSync(join(__r, '.claude', 'settings.json'), 'utf8'); if (__s.includes('agentic/hooks/')) process.exit(0) } catch {} }
const ti = input.tool_input || {}
const target = ti.file_path || ti.path
if (!target) process.exit(0)
const root = projectRoot(input)
const abs = resolve(root, target)
if (!['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json', '.css', '.scss', '.yml', '.yaml'].includes(extname(abs))) process.exit(0)
if (/[\\/](agentic|\.claude|docs)[\\/]/.test(abs)) process.exit(0)
const bin = join(root, 'node_modules', '.bin', process.platform === 'win32' ? 'prettier.cmd' : 'prettier')
if (!existsSync(bin)) process.exit(0)
spawnSync(bin, ['--write', '--log-level', 'silent', abs], { cwd: root, stdio: 'ignore', shell: process.platform === 'win32', timeout: 20000 })
process.exit(0)
