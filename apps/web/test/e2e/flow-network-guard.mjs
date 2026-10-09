// API-process-only transport guard. Real internal calls remain real; an excluded or unrelated
// service fails before a TCP connection is created, including fetch, HTTPS, web-push and pg.
import net from 'node:net'
import dns from 'node:dns'
import { syncBuiltinESMExports } from 'node:module'

const loopback = new Set(['127.0.0.1', 'localhost', '::1', '[::1]'])

export function assertAllowedFlowConnection(host, port, allowedPorts) {
  if (
    typeof host !== 'string' ||
    !loopback.has(host.toLowerCase()) ||
    !Number.isInteger(Number(port)) ||
    !allowedPorts.has(Number(port))
  ) {
    const error = new Error(`Local QA API blocked an unowned network endpoint: ${host}:${port}`)
    error.code = 'ERR_QA_NETWORK_DENIED'
    throw error
  }
}

if (process.env['FLOW_NETWORK_GUARD'] === '1') {
  const values = JSON.parse(process.env['FLOW_ALLOWED_TCP_PORTS'] ?? '[]')
  if (
    !Array.isArray(values) ||
    values.length === 0 ||
    values.some((port) => !Number.isInteger(port) || port < 1024 || port > 65535)
  )
    throw new Error('Local QA API requires an explicit list of owned TCP ports')
  const allowedPorts = new Set(values)
  // Link unfurling resolves its URL before opening HTTP. Reject explicit foreign DNS lookups too,
  // so even an excluded preview cannot send a hostname to an external resolver.
  const lookup = dns.lookup
  const promiseLookup = dns.promises.lookup
  const assertLocalLookup = (host) => {
    if (!loopback.has(String(host).toLowerCase())) {
      const error = new Error(`Local QA API blocked an external DNS lookup: ${host}`)
      error.code = 'ERR_QA_NETWORK_DENIED'
      throw error
    }
  }
  dns.lookup = (...args) => {
    assertLocalLookup(args[0])
    return Reflect.apply(lookup, dns, args)
  }
  dns.promises.lookup = (...args) => {
    assertLocalLookup(args[0])
    return Reflect.apply(promiseLookup, dns.promises, args)
  }
  const denyDnsQuery = () => {
    const error = new Error('Local QA API blocked a DNS resolver query')
    error.code = 'ERR_QA_NETWORK_DENIED'
    throw error
  }
  for (const key of Object.keys(dns)) {
    if (key.startsWith('resolve') || key === 'reverse') dns[key] = denyDnsQuery
  }
  for (const key of Object.keys(dns.promises)) {
    if (key.startsWith('resolve') || key === 'reverse') dns.promises[key] = denyDnsQuery
  }
  for (const prototype of [dns.Resolver.prototype, dns.promises.Resolver.prototype]) {
    for (const key of Object.getOwnPropertyNames(prototype)) {
      if (key.startsWith('resolve') || key === 'reverse') prototype[key] = denyDnsQuery
    }
  }
  syncBuiltinESMExports()
  const connect = net.Socket.prototype.connect
  net.Socket.prototype.connect = function guardedFlowConnect(...supplied) {
    // Node's net.createConnection normalises its arguments into [options, callback] before
    // calling Socket.connect. Direct callers may still use connect(port, host, callback).
    const args = Array.isArray(supplied[0]) ? supplied[0] : supplied
    const first = args[0]
    const options =
      first && typeof first === 'object'
        ? first
        : { port: first, host: typeof args[1] === 'string' ? args[1] : 'localhost' }
    assertAllowedFlowConnection(options.host ?? 'localhost', options.port, allowedPorts)
    return Reflect.apply(connect, this, supplied)
  }
}
