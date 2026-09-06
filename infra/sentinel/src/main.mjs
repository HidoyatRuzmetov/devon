#!/usr/bin/env node
// Process entrypoint, invoked by systemd (infra/sentinel/systemd/devon-sentinel.service). Not loaded
// by anything in apps/ or packages/ -- the sentinel is a host process, never a runtime dependency of
// the application (design.md §1.2).
import { loadConfig } from './config.mjs'
import { createSentinel } from './server.mjs'

const config = loadConfig()
const { server, logLine } = createSentinel(config)

server.listen({ host: config.host, port: config.port }, () => {
  const addr = server.address()
  console.log(`[sentinel] listening on ${addr.address}:${addr.port} (commands: ${config.allowedCommands.join(', ')})`)
  logLine(`start bind=${addr.address}:${addr.port}`)
})

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    logLine(`stop signal=${sig}`)
    server.close(() => process.exit(0))
  })
}
