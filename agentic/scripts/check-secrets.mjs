#!/usr/bin/env node
// Secrets gate: scans tracked + untracked (non-ignored) files for credential patterns. Exit 1 on hits.
import { execSync } from 'node:child_process'
import { readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const list = () => { try { return execSync('git ls-files --cached --others --exclude-standard', { cwd: root, encoding: 'utf8' }).split(/\r?\n/).filter(Boolean) } catch { return [] } }
const skip = /(^|\/)(node_modules|dist|coverage|\.git)\/|\.(png|jpg|jpeg|gif|webp|svg|ico|woff2?|ttf|pdf|zip|lock)$|(^|\/)\.env\.example$|(^|\/)pnpm-lock\.yaml$|^docs\/01-research\//
const patterns = [
  ['private key', /-----BEGIN (RSA|EC|OPENSSH|PGP|DSA)? ?PRIVATE KEY-----/],
  ['AWS access key', /\bAKIA[0-9A-Z]{16}\b/],
  ['Telegram bot token', /\b\d{8,10}:[A-Za-z0-9_-]{35}\b/],
  ['Anthropic key', /\bsk-ant-[A-Za-z0-9_-]{20,}\b/],
  ['OpenAI-style key', /\bsk-[A-Za-z0-9]{32,}\b/],
  ['Slack token', /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/],
  ['GitHub token', /\bgh[pousr]_[A-Za-z0-9]{36,}\b/],
  ['JWT literal', /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/],
  ['password assignment', /(password|passwd|secret|api[_-]?key|token)\s*[:=]\s*['"][^'"\s]{8,}['"]/i],
  ['connection string with password', /(postgres|mysql|redis|amqp):\/\/[^:\s]+:[^@\s]{4,}@/i],
]
const allow = /(example|placeholder|changeme|your[_-]?|xxx|<[^>]+>|\$\{|process\.env|dummy|sample)/i
let hits = 0
for (const f of list()) {
  if (skip.test(f)) continue
  let s; try { if (statSync(join(root, f)).size > 2_000_000) continue; s = readFileSync(join(root, f), 'utf8') } catch { continue }
  const lines = s.split(/\r?\n/)
  lines.forEach((line, i) => { for (const [name, re] of patterns) { if (re.test(line) && !allow.test(line)) { hits++; console.log(`[secrets] ${name}: ${f}:${i + 1}: ${line.trim().slice(0, 80)}`) } } })
}
console.log(`[secrets] hits=${hits}`)
process.exit(hits ? 1 : 0)
