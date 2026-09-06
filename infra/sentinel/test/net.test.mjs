import test from 'node:test'
import assert from 'node:assert/strict'
import { isLoopbackAddress } from '../src/net.mjs'

test('accepts every loopback address form', () => {
  for (const a of ['127.0.0.1', '127.0.0.2', '127.255.255.255', '::1', '::ffff:127.0.0.1']) {
    assert.equal(isLoopbackAddress(a), true, a)
  }
})

test('rejects non-loopback addresses, including a container-bridge-style address (AC-15 disproof)', () => {
  for (const a of ['172.17.0.2', '10.0.0.5', '192.168.1.10', '203.0.113.7', '::ffff:172.17.0.2', 'fe80::1', '8.8.8.8']) {
    assert.equal(isLoopbackAddress(a), false, a)
  }
})

test('rejects malformed / empty / non-string input', () => {
  for (const a of [undefined, null, '', 'not-an-ip', '999.999.999.999', 127001]) {
    assert.equal(isLoopbackAddress(a), false, String(a))
  }
})
