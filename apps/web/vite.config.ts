import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { federation } from '@module-federation/vite'

const base = process.env.MODULE_PUBLIC_URL ?? '/media-keeper/'
const prefix = new URL(base, 'http://localhost').pathname.replace(/\/$/, '')
const proxy = { [prefix + '/api']: {
  target: process.env.MEDIA_KEEPER_API_ORIGIN ?? 'http://127.0.0.1:3001',
  rewrite: (path: string) => path.slice(prefix.length),
} }
export default defineConfig({
  base,
  plugins: [react(), federation({
    name: 'media_keeper', filename: 'remoteEntry.js',
    exposes: { './DashboardModule': './src/DashboardModule.tsx' },
    shared: {
      react: { singleton: true, requiredVersion: '19.3.1' },
      'react-dom': { singleton: true, requiredVersion: '19.3.1' },
      'react/jsx-runtime': { singleton: true, requiredVersion: '19.3.1' },
    },
    manifest: true, bundleAllCSS: true, dts: false,
  })],
  build: { assetsInlineLimit: 0 },
  server: { host: '127.0.0.1', port: 8081, strictPort: true, proxy },
  preview: { host: '127.0.0.1', port: 8081, strictPort: true, proxy },
})
