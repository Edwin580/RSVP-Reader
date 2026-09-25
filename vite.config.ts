import react from '@vitejs/plugin-react'
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { defineConfig, type Plugin } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  // Relative asset paths so the build works under a GitHub Pages sub-path.
  base: './',
  plugins: [react(), serviceWorker()],
})

/**
 * Emits sw.js with the list of every built file and public/ file to cache
 * for offline use, and a version that changes whenever any of them does.
 */
function serviceWorker(): Plugin {
  return {
    name: 'service-worker',
    apply: 'build',
    generateBundle(_options, bundle) {
      const hash = createHash('sha256')
      const files = ['./']
      for (const [name, output] of Object.entries(bundle).sort(([a], [b]) => a.localeCompare(b))) {
        if (name.endsWith('.map')) continue
        if (name !== 'index.html') files.push(`./${name}`)
        hash.update(name).update(output.type === 'chunk' ? output.code : output.source)
      }
      for (const name of readdirSync('public').sort()) {
        files.push(`./${name}`)
        hash.update(name).update(readFileSync(`public/${name}`))
      }
      const source = readFileSync('service-worker/sw.js', 'utf8')
        .replace("'__VERSION__'", JSON.stringify(hash.digest('hex').slice(0, 12)))
        .replace('__PRECACHE__', JSON.stringify(files))
      this.emitFile({ type: 'asset', fileName: 'sw.js', source })
    },
  }
}
