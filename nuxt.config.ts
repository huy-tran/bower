import { execSync } from 'node:child_process'
import { version } from './package.json'

// Shown in the About window: when this build was made, and from which commit (when git is available).
const builtAt = new Date().toISOString()
let commit = ''
try { commit = execSync('git rev-parse --short HEAD', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() } catch {}

export default defineNuxtConfig({
  compatibilityDate: '2026-09-01',
  ssr: false,
  modules: ['@nuxt/ui'],
  css: ['~/assets/css/main.css'],
  devtools: { enabled: false },
  app: {
    head: {
      title: 'Bower',
      link: [{ rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' }]
    }
  },
  colorMode: { preference: 'light', fallback: 'light' },
  icon: { serverBundle: 'local' },
  // Shown in the About window.
  runtimeConfig: { public: { version, builtAt, commit } },
  // Bundled into the server build so the first-run example works wherever the server runs from.
  nitro: { serverAssets: [{ baseName: 'seed', dir: 'seed' }] }
})
