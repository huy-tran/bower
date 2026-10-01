import { cpSync, existsSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

// Stages what electron-builder ships (see electron-builder.yml):
// - app/: the Electron main process bundled into one file with its dependencies (electron-updater),
//   so the app archive needs no node_modules, plus the preload script
// - server/: the Nuxt server build, with symlinks resolved (Nitro links some packages by absolute
//   path, which would break on another machine)
// - chrome/: the Chrome that Puppeteer renders with
const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const out = join(root, '.desktop-stage')
const output = join(root, '.output')
const chrome = join(root, '.cache', 'puppeteer', 'chrome')

if (!existsSync(join(output, 'server', 'index.mjs'))) throw new Error('No server build: run `nuxt build` first')
if (!existsSync(chrome)) throw new Error('No Chrome in .cache/puppeteer: run `npx puppeteer browsers install`')

rmSync(out, { recursive: true, force: true })
await build({
  entryPoints: [join(root, 'electron', 'main.mjs')],
  outfile: join(out, 'app', 'main.cjs'),
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  external: ['electron'],
  define: { 'import.meta.dirname': '__dirname' },
  logLevel: 'warning'
})
cpSync(join(root, 'electron', 'preload.cjs'), join(out, 'app', 'preload.cjs'))
cpSync(output, join(out, 'server'), { recursive: true, dereference: true })
cpSync(chrome, join(out, 'chrome'), { recursive: true, verbatimSymlinks: true })
console.log(`Staged the app, server and Chrome in ${out}`)
