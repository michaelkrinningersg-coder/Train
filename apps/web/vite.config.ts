import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { seedData } from './vite-plugin-seed.js'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, '..', '..')

export default defineConfig({
  plugins: [react(), seedData(resolve(repoRoot, 'data', 'seed'))],
  server: {
    port: 5173,
    host: true,
  },
  optimizeDeps: {
    // Workspace-Pakete liegen als TypeScript-Quelle vor und werden von Vite
    // direkt transpiliert, nicht vorgebuendelt.
    exclude: ['@game/domain', '@game/geo'],
  },
  build: {
    target: 'es2022',
    sourcemap: true,
  },
})
