import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// An independent build prevents private routes, schemas and locale catalogues entering this page.
export default defineConfig({
  root: fileURLToPath(new URL('./public-dashboard', import.meta.url)),
  base: '/view/',
  publicDir: false,
  plugins: [react(), tailwindcss()],
  build: { outDir: '../../dist/view', emptyOutDir: true, sourcemap: false },
})
