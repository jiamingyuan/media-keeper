import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

const workspace = fileURLToPath(new URL('./', import.meta.url))
const manifest = JSON.parse(readFileSync(new URL('./acomet/acomet.module.json', import.meta.url), 'utf8'))
function origin(value: string) {
  const url = new URL(value)
  if (url.origin !== value || (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname)))) throw new Error('Acomet requires an HTTPS origin or local loopback origin')
  return value
}
export default defineConfig(({ mode }) => {
  const env = { ...loadEnv(mode, workspace, 'VITE_'), ...process.env }
  const backend = origin(env.VITE_BACKEND_ORIGIN ?? manifest.backend.origin)
  const host = origin(env.VITE_ACOMET_HOST_ORIGIN ?? 'http://127.0.0.1:4310')
  if (host.startsWith('https:') && !backend.startsWith('https:')) throw new Error('A production Acomet host requires an HTTPS backend')
  return {
    root: fileURLToPath(new URL('./acomet', import.meta.url)), base: '/',
    plugins: [react(), {
      name: 'acomet-manifest',
      generateBundle() { this.emitFile({ type: 'asset', fileName: 'acomet.module.json', source: JSON.stringify({ ...manifest, backend: { origin: backend } }, null, 2) + '\n' }) },
    }],
    resolve: { alias: { '/src': fileURLToPath(new URL('./src', import.meta.url)) } },
    define: { 'import.meta.env.VITE_BACKEND_ORIGIN': JSON.stringify(backend), 'import.meta.env.VITE_ACOMET_HOST_ORIGIN': JSON.stringify(host) },
    build: { outDir: fileURLToPath(new URL('./dist-acomet', import.meta.url)), emptyOutDir: true, assetsInlineLimit: 0 },
    server: { host: 'localhost', port: 5174, strictPort: true, fs: { allow: [fileURLToPath(new URL('../../', import.meta.url))] } },
    preview: { host: 'localhost', port: 5174, strictPort: true },
  }
})
