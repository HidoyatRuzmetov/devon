// H23.1: "robots.txt disallows the app." This is a self-hosted internal department tool with no
// public content anywhere in it (every screen either requires a session or is a bare entry point
// with nothing worth a search engine indexing) -- `Disallow: /` for every crawler is the whole
// policy. A small Vite plugin rather than a second `publicDir` entry: `vite.config.ts`'s one
// `publicDir` (`packages/ui/public`) holds fonts shared with Storybook, a different concern than this
// app's own crawl policy, and Vite does not support more than one `publicDir`.
import type { Plugin } from 'vite'

const ROBOTS_TXT = 'User-agent: *\nDisallow: /\n'

export function robotsTxtPlugin(): Plugin {
  return {
    name: 'devon-robots-txt',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url !== '/robots.txt') {
          next()
          return
        }
        res.setHeader('Content-Type', 'text/plain; charset=utf-8')
        res.end(ROBOTS_TXT)
      })
    },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'robots.txt', source: ROBOTS_TXT })
    },
  }
}
