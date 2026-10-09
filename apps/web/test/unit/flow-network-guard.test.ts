import { describe, expect, it } from 'vitest'
import { createServer } from 'node:http'
import { spawn } from 'node:child_process'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const preload = pathToFileURL(join(import.meta.dirname, '../e2e/flow-network-guard.mjs')).href

function runChild(source: string, ports: number[]): Promise<{ code: number | null; text: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ['--import', preload, '--input-type=module', '-e', source],
      {
        env: {
          ...process.env,
          NODE_OPTIONS: '',
          FLOW_NETWORK_GUARD: '1',
          FLOW_ALLOWED_TCP_PORTS: JSON.stringify(ports),
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    )
    let text = ''
    child.stdout.on('data', (chunk: Buffer) => (text += chunk.toString()))
    child.stderr.on('data', (chunk: Buffer) => (text += chunk.toString()))
    child.on('error', reject)
    child.on('close', (code) => resolve({ code, text }))
  })
}

describe('local QA API network boundary', () => {
  it('permits a real owned loopback HTTP transport', async () => {
    const server = createServer((_request, response) => response.end('owned-local-service'))
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('No local test listener')
    try {
      const result = await runChild(
        `const r = await fetch('http://127.0.0.1:${address.port}'); console.log(await r.text())`,
        [address.port],
      )
      expect(result).toEqual({ code: 0, text: 'owned-local-service\n' })
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      )
    }
  })
  it('rejects external, disguised and unowned local targets before transport', async () => {
    const result = await runChild(
      `import net from 'node:net';
       import https from 'node:https';
       const attempts = [
         () => net.createConnection({host:'example.org',port:48943}),
         () => net.createConnection({host:'127.0.0.1.example.org',port:48943}),
         () => net.createConnection({host:'127.0.0.1',port:8787}),
         () => new net.Socket().connect(8787,'localhost'),
         () => https.get('https://example.org')
       ];
       for (const attempt of attempts) {
         try { attempt(); throw new Error('Forbidden transport was permitted'); }
         catch(e) { if(e.code!=='ERR_QA_NETWORK_DENIED') throw e; }
       }
       try { await fetch('http://127.0.0.1:8787'); throw new Error('Foreign local fetch permitted'); }
       catch(e) { if(e.cause?.code!=='ERR_QA_NETWORK_DENIED') throw e; }
       console.log('six attempts rejected before connection');`,
      [48943],
    )
    expect(result).toEqual({ code: 0, text: 'six attempts rejected before connection\n' })
  })
  it('fails closed when a child has no explicit owned ports', async () => {
    const result = await runChild('console.log("must not start")', [])
    expect(result.code).not.toBe(0)
    expect(result.text).toContain('requires an explicit list of owned TCP ports')
    expect(result.text).not.toContain('must not start\n')
  })
  it('rejects foreign DNS lookup and resolver APIs without asking a resolver', async () => {
    const result = await runChild(
      `import dns from 'node:dns';
       import {lookup} from 'node:dns/promises';
       if(lookup!==dns.promises.lookup) throw new Error('DNS ESM binding was not guarded');
       for(const method of [dns.resolve4,new dns.Resolver().resolve4,new dns.promises.Resolver().resolve4]) {
         if(method.name!=='denyDnsQuery') throw new Error('Resolver API was not guarded');
       }
       const attempts = [
         () => dns.lookup('example.org',()=>{}),
         () => lookup('example.org'),
         () => dns.resolve4('example.org',()=>{}),
         () => new dns.Resolver().resolve4('example.org',()=>{}),
         () => new dns.promises.Resolver().resolve4('example.org')
       ];
       for(const attempt of attempts) {
         try { await attempt(); throw new Error('Forbidden DNS query permitted'); }
         catch(e) { if(e.code!=='ERR_QA_NETWORK_DENIED') throw e; }
       }
       console.log('five DNS attempts rejected before resolver');`,
      [48943],
    )
    expect(result).toEqual({ code: 0, text: 'five DNS attempts rejected before resolver\n' })
  })
})
