// Shared helpers for hooks. Hooks receive one JSON object on stdin (session_id, cwd, hook_event_name,
// tool_name, tool_input, ...). They exit 0 to allow, 2 to block (stderr is shown to the agent), and may
// print a JSON decision on stdout for Stop hooks. Hooks must never hang: every read has a timeout.
import { existsSync, readFileSync } from 'node:fs'
import { join, resolve, relative, isAbsolute } from 'node:path'
import { execSync } from 'node:child_process'

export async function readInput() {
  return new Promise((res) => {
    let data = ''
    const t = setTimeout(() => res(safeParse(data)), 3000)
    process.stdin.setEncoding('utf8')
    process.stdin.on('data', (c) => { data += c })
    process.stdin.on('end', () => { clearTimeout(t); res(safeParse(data)) })
    process.stdin.on('error', () => { clearTimeout(t); res(safeParse(data)) })
  })
}
function safeParse(s) { try { return JSON.parse(s || '{}') } catch { return {} } }

export function projectRoot(input) {
  const cwd = input?.cwd || process.env.CLAUDE_PROJECT_DIR || process.cwd()
  // walk up to the directory that has agentic/gates.json (worktrees included)
  let d = resolve(cwd)
  for (let i = 0; i < 6; i++) { if (existsSync(join(d, 'agentic', 'gates.json'))) return d; const p = resolve(d, '..'); if (p === d) break; d = p }
  return resolve(cwd)
}

export function loadGates(root) { try { return JSON.parse(readFileSync(join(root, 'agentic', 'gates.json'), 'utf8')) } catch { return null } }

export function rel(root, p) { const r = relative(root, resolve(root, p)).replace(/\\/g, '/'); return r }
export function isInside(root, p) { const r = relative(root, resolve(root, p)); return !!r && !r.startsWith('..') && !isAbsolute(r) || r === '' }

export const globToRe = (g) => new RegExp('^' + g.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*\/|\*\*|\*|\?/g, (m) => m === '**/' ? '(?:.*/)?' : m === '**' ? '.*' : m === '*' ? '[^/]*' : '.') + '$')
export const matchAny = (f, globs) => (globs || []).some(g => g.endsWith('/') ? f.startsWith(g) : globToRe(g).test(f))

export function isTracked(root, relPath) { try { execSync(`git ls-files --error-unmatch -- "${relPath}"`, { cwd: root, stdio: 'ignore' }); return true } catch { return false } }

export function block(msg) { process.stderr.write(msg + '\n'); process.exit(2) }
export function allow() { process.exit(0) }
