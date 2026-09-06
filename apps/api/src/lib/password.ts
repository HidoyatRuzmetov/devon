// Password hashing (TECH-SPEC §1: "node-argon2 ... argon2id"). `@node-rs/argon2` ships prebuilt
// napi-rs binaries with no install/build script, so it installs cleanly under the workspace's
// `allowBuilds` allow-list (pnpm-workspace.yaml, out of this item's TOUCHES) without needing that list
// widened -- the `argon2` package (node-gyp-build) would have required exactly that.
import { hash, verify } from '@node-rs/argon2'

export async function hashPassword(plain: string): Promise<string> {
  return hash(plain)
}

export async function verifyPassword(passwordHash: string, plain: string): Promise<boolean> {
  try {
    return await verify(passwordHash, plain)
  } catch {
    // A malformed/foreign hash must fail closed, never throw into a login handler (H1.x: no
    // information about *why* a login failed reaches the caller).
    return false
  }
}
