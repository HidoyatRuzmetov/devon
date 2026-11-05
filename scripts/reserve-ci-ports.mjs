// Dedicated fixture ports overlap Linux's default automatic TCP/UDP port range. Reserve them
// before dependency downloads or browser traffic, without changing explicit bind behavior.
// https://docs.kernel.org/networking/ip-sysctl.html#ip-variables
import { execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

export const FIXTURE_PORTS = '48900-49100'
const key = 'net.ipv4.ip_local_reserved_ports'

export function portSet(value) {
  const ports = new Set()
  for (const item of value.trim() ? value.trim().split(',') : []) {
    if (!/^\d+(?:-\d+)?$/.test(item)) throw new Error('Invalid reserved-port range')
    const [start, end = start] = item.split('-').map(Number)
    if (start < 1 || end > 65535 || start > end) throw new Error('Invalid reserved-port bounds')
    for (let port = start; port <= end; port++) ports.add(port)
  }
  return ports
}

export function reserveFixturePorts(run) {
  const before = run('sysctl', ['-n', key]).trim()
  const required = `${before ? `${before},` : ''}${FIXTURE_PORTS}`
  const expected = portSet(required)
  run('sudo', ['-n', 'sysctl', '-q', '-w', `${key}=${required}`])
  const after = portSet(run('sysctl', ['-n', key]))
  if ([...expected].some((port) => !after.has(port)))
    throw new Error('Port reservation read-back lost existing or fixture reservations')
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  try {
    if (
      process.platform !== 'linux' ||
      process.env.GITHUB_ACTIONS !== 'true' ||
      process.env.RUNNER_ENVIRONMENT !== 'github-hosted'
    )
      throw new Error('Port reservation is restricted to the disposable Linux GitHub-hosted runner')
    reserveFixturePorts((command, args) =>
      execFileSync(command, args, { encoding: 'utf8', timeout: 5000, maxBuffer: 16 * 1024 }),
    )
    console.log(`[ci] Reserved fixture ports ${FIXTURE_PORTS}; existing reservations preserved`)
  } catch (error) {
    console.error(`[ci] Cannot reserve fixture ports: ${String(error.message).slice(0, 1000)}`)
    process.exitCode = 1
  }
}
