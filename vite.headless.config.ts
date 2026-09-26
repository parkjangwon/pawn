import { resolve } from 'path'
import { defineConfig } from 'vite'

/**
 * Bundles the headless agent runner / eval CLI (src/headless/cli.ts) into a
 * single Node ESM file: `node out/headless/pawn-headless.mjs --help`.
 */
export default defineConfig({
  resolve: {
    alias: { '@': resolve(process.cwd(), 'src/renderer/src') }
  },
  build: {
    ssr: 'src/headless/cli.ts',
    outDir: 'out/headless',
    emptyOutDir: true,
    target: 'node20',
    minify: false,
    sourcemap: false,
    rollupOptions: {
      output: { entryFileNames: 'pawn-headless.mjs', format: 'es' }
    }
  },
  ssr: {
    // Bundle app code + pure-JS deps; keep native modules external.
    noExternal: true,
    external: ['better-sqlite3', 'electron', 'node-pty']
  }
})
