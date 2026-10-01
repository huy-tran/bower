import { cpSync, existsSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// Stages what electron-builder ships next to the app (see electron-builder.yml, extraResources):
// the Nuxt server build, with symlinks resolved (Nitro links some packages by absolute path,
// which would break on another machine), and the Chrome that Puppeteer renders with.
const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const out = join(root, 'dist-desktop', 'stage')
const output = join(root, '.output')
const chrome = join(root, '.cache', 'puppeteer', 'chrome')

if (!existsSync(join(output, 'server', 'index.mjs'))) throw new Error('No server build: run `nuxt build` first')
if (!existsSync(chrome)) throw new Error('No Chrome in .cache/puppeteer: run `npx puppeteer browsers install`')

rmSync(out, { recursive: true, force: true })
cpSync(output, join(out, 'server'), { recursive: true, dereference: true })
cpSync(chrome, join(out, 'chrome'), { recursive: true, verbatimSymlinks: true })
console.log(`Staged the server and Chrome in ${out}`)
