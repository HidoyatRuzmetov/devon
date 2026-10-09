import { existsSync, readdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'

const webRequire = createRequire(new URL('../../../apps/web/package.json', import.meta.url))

export function findPerformanceChromium(cache, platform = process.platform) {
  if (!cache) {
    const executable = webRequire('@playwright/test').chromium.executablePath()
    if (!existsSync(executable))
      throw new Error('Configured Playwright Chromium is missing; install the workspace browser')
    return executable
  }
  if (!existsSync(cache)) throw new Error('Explicit Playwright browser cache does not exist')
  const dirs = readdirSync(cache)
    .filter((name) => /^chromium-\d+$/.test(name))
    .sort((a, b) => Number(b.split('-')[1]) - Number(a.split('-')[1]))
  for (const directory of dirs) {
    const paths =
      platform === 'win32'
        ? [
            ['chrome-win64', 'chrome.exe'],
            ['chrome-win', 'chrome.exe'],
          ]
        : [
            ['chrome-linux64', 'chrome'],
            ['chrome-linux', 'chrome'],
          ]
    for (const path of paths) {
      const candidate = join(cache, directory, ...path)
      if (existsSync(candidate)) return candidate
    }
  }
  throw new Error('Chromium executable is missing from the explicit browser cache')
}
