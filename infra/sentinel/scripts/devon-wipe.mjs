#!/usr/bin/env node
// The host CLI (TECH-SPEC §11: "also available as a CLI on the host (`devon-wipe --confirm`) for the
// CTO"). Signs and sends exactly the same `wipe` command the super admin console sends over HTTP to
// the sentinel already running on this host -- one executor, two front doors, never a second copy of
// the destructive logic (that stays in src/wipe-executor.mjs, reached only through server.mjs).
//
// Usage:
//   node infra/sentinel/scripts/devon-wipe.mjs --confirm [--key-file /path/to/key] [--port 8787] [--actor name]
//
// The key file is a flat `key=value` list, the same shape keygen.mjs prints and sentinel.conf.example
// documents (`public_key=...` / `private_key=...`); SENTINEL_PRIVATE_KEY / SENTINEL_PUBLIC_KEY env
// vars work too, for a CI/ops-tooling context that already manages secrets that way. The private key
// itself is never read from this repo, an .env file, or a default path -- the operator names it
// explicitly, every time, so a stray "wipe" run against the wrong key file fails loudly (an unknown
// key is just another "bad_signature" from the sentinel's point of view) rather than silently.
import { readFileSync, existsSync } from 'node:fs'
import { privateKeyFromRaw } from '../src/keys.mjs'
import { buildSignedCommand, postCommand } from './client.mjs'

function parseArgs(argv) {
  const out = { confirm: false, port: 8787, keyFile: null, actor: null }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--confirm') out.confirm = true
    else if (arg === '--key-file') out.keyFile = argv[++i]
    else if (arg === '--port') out.port = Number(argv[++i])
    else if (arg === '--actor') out.actor = argv[++i]
    else if (arg === '--help' || arg === '-h') out.help = true
  }
  return out
}

function parseKeyFile(path) {
  const out = {}
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const t = line.trim()
    if (!t || t.startsWith('#')) continue
    const i = t.indexOf('=')
    if (i === -1) continue
    out[t.slice(0, i).trim()] = t.slice(i + 1).trim()
  }
  return out
}

function usage() {
  console.log(
    [
      'Usage: devon-wipe.mjs --confirm [--key-file <path>] [--port 8787] [--actor <name>]',
      '',
      'Sends a signed "wipe" command to the sentinel listening on 127.0.0.1 -- this permanently',
      'removes the project, its containers, images, volumes and directory from this host.',
      '',
      'Refuses to do anything without --confirm.',
    ].join('\n'),
  )
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    usage()
    return
  }
  if (!args.confirm) {
    usage()
    console.error('\nRefusing: pass --confirm to actually send the wipe command.')
    process.exitCode = 1
    return
  }

  let publicKeyX = process.env.SENTINEL_PUBLIC_KEY
  let privateKeyD = process.env.SENTINEL_PRIVATE_KEY
  if (args.keyFile) {
    if (!existsSync(args.keyFile)) {
      console.error(`Key file not found: ${args.keyFile}`)
      process.exitCode = 1
      return
    }
    const parsed = parseKeyFile(args.keyFile)
    publicKeyX = parsed.public_key || publicKeyX
    privateKeyD = parsed.private_key || privateKeyD
  }
  if (!publicKeyX || !privateKeyD) {
    console.error(
      'No signing key available. Pass --key-file <path to a keygen.mjs-format file> or set ' +
        'SENTINEL_PRIVATE_KEY / SENTINEL_PUBLIC_KEY.',
    )
    process.exitCode = 1
    return
  }

  const privateKey = privateKeyFromRaw(publicKeyX, privateKeyD)
  const command = buildSignedCommand(privateKey, 'wipe')
  const body = args.actor ? { ...command, actor: args.actor } : command

  console.log('Sending signed wipe command to 127.0.0.1:' + args.port + ' ...')
  const res = await postCommand({ port: args.port, body })
  console.log(`Response: ${res.status} ${JSON.stringify(res.body)}`)
  if (res.status !== 200 || !res.body?.ok) {
    process.exitCode = 1
  }
}

await main()
