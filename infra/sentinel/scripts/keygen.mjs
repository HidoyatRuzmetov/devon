#!/usr/bin/env node
// Generates an ed25519 keypair for local development / testing. A production key is generated the
// same way, on the operator's own machine (or, from EPIC-013, the super admin console) -- it is
// never produced by, or committed to, this repository (ADR-011).
import { generateKeyPairSync } from 'node:crypto'

const { publicKey, privateKey } = generateKeyPairSync('ed25519')
const pub = publicKey.export({ format: 'jwk' })
const priv = privateKey.export({ format: 'jwk' })

console.log('# --- public: add to /etc/devon/sentinel.conf (mode 0600, owner root) -------------')
console.log(`public_key=${pub.x}`)
console.log('')
console.log('# --- private: keep on the signing machine ONLY. Never commit, never .env, never here. ---')
console.log(`private_key=${priv.d}`)
console.log(`# public_key repeated for convenience when pairing the two: ${pub.x}`)
