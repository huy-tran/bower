import { execFileSync, spawn } from 'node:child_process'
import { createWriteStream, existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { homedir } from 'node:os'
import { delimiter, join } from 'node:path'
import { app, BrowserWindow, dialog, shell } from 'electron'

// Bower's desktop shell. Packaged, it starts the bundled Nuxt server on a free localhost port
// (run by Electron's own Node) and opens a window on it. In development (`npm run dev:desktop`)
// it only opens a window on the `nuxt dev` server.
const DEV_URL = process.env.BOWER_DEV_URL || 'http://localhost:3000'
let server = null
let quitting = false

if (!app.requestSingleInstanceLock()) app.quit()

function freePort() {
  return new Promise((resolve, reject) => {
    const s = createServer()
    s.unref()
    s.on('error', reject)
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address()
      s.close(() => resolve(port))
    })
  })
}

// Apps opened from Finder or a desktop launcher do not get the terminal's PATH, so ask the login shell.
function shellPath() {
  if (process.platform === 'win32') return process.env.PATH
  try {
    return execFileSync(process.env.SHELL || '/bin/zsh', ['-ilc', 'printf %s "$PATH"'], { encoding: 'utf8', timeout: 5000 }).trim() || process.env.PATH
  } catch {
    return process.env.PATH
  }
}

function findOnPath(name, path) {
  const exts = process.platform === 'win32' ? ['.exe', ''] : ['']
  for (const dir of (path || '').split(delimiter).filter(Boolean)) {
    for (const ext of exts) if (existsSync(join(dir, name + ext))) return join(dir, name + ext)
  }
  return null
}

// The Claude Code CLI, wherever its installers usually put it. Left unset when missing: the
// editor's health check then tells the user to install it or log in.
function findClaude(path) {
  const exe = process.platform === 'win32' ? 'claude.exe' : 'claude'
  return findOnPath('claude', path) ?? [
    join(homedir(), '.local', 'bin', exe),
    join(homedir(), '.claude', 'local', exe),
    '/opt/homebrew/bin/claude',
    '/usr/local/bin/claude'
  ].find(p => existsSync(p)) ?? null
}

// Claude runs `node bower.mjs ...` for snapshots and screenshots. Users of the desktop app may not
// have Node, so a `node` shim that runs Electron as Node goes at the end of PATH (a real Node wins).
function nodeShim() {
  const dir = join(app.getPath('userData'), 'bin')
  mkdirSync(dir, { recursive: true })
  const exe = process.execPath
  writeFileSync(join(dir, 'node'), `#!/bin/sh\nELECTRON_RUN_AS_NODE=1 exec "${exe.replaceAll('\\', '/')}" "$@"\n`, { mode: 0o755 })
  if (process.platform === 'win32') writeFileSync(join(dir, 'node.cmd'), `@echo off\r\nset ELECTRON_RUN_AS_NODE=1\r\n"${exe}" %*\r\n`)
  return dir
}

function bundledChrome() {
  const root = join(process.resourcesPath, 'chrome')
  const rel = {
    win32: ['chrome-win64', 'chrome.exe'],
    darwin: [process.arch === 'arm64' ? 'chrome-mac-arm64' : 'chrome-mac-x64', 'Google Chrome for Testing.app', 'Contents', 'MacOS', 'Google Chrome for Testing'],
    linux: ['chrome-linux64', 'chrome']
  }[process.platform]
  for (const v of existsSync(root) ? readdirSync(root) : []) {
    const p = join(root, v, ...rel)
    if (existsSync(p)) return p
  }
  return null
}

async function startServer() {
  const port = await freePort()
  const url = `http://127.0.0.1:${port}`
  const path = shellPath()
  const env = {
    ...process.env,
    ELECTRON_RUN_AS_NODE: '1',
    NODE_ENV: 'production',
    NITRO_HOST: '127.0.0.1',
    NITRO_PORT: String(port),
    BOWER_STORAGE: join(app.getPath('userData'), 'storage', 'projects'),
    PATH: [path, nodeShim()].join(delimiter)
  }
  const claude = process.env.CLAUDE_BIN || findClaude(path)
  if (claude) env.CLAUDE_BIN = claude
  const chrome = bundledChrome()
  if (chrome) env.PUPPETEER_EXECUTABLE_PATH = chrome

  const logs = app.getPath('logs')
  mkdirSync(logs, { recursive: true })
  const log = createWriteStream(join(logs, 'server.log'), { flags: 'a' })
  log.write(`\n--- ${new Date().toISOString()} starting on ${url} (claude: ${claude ?? 'not found'}, chrome: ${chrome ?? 'not found'})\n`)

  server = spawn(process.execPath, [join(process.resourcesPath, 'server', 'server', 'index.mjs')], { env, cwd: app.getPath('userData'), windowsHide: true })
  server.stdout.pipe(log)
  server.stderr.pipe(log)
  server.on('exit', (code) => {
    server = null
    if (quitting) return
    dialog.showErrorBox('Bower stopped', `The Bower server exited (code ${code}). Details are in:\n${join(logs, 'server.log')}`)
    app.quit()
  })

  for (let i = 0; i < 300; i++) {
    if (!server) throw new Error('The server exited while starting')
    try {
      if ((await fetch(url)).ok) return url
    } catch {}
    await new Promise(r => setTimeout(r, 100))
  }
  throw new Error('The server did not start within 30 seconds')
}

function createWindow(url) {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    title: 'Bower',
    backgroundColor: '#ffffff',
    show: false,
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false }
  })
  const origin = new URL(url).origin
  const own = (u) => { try { return new URL(u).origin === origin } catch { return false } }

  // Bower's own pages (player preview, scene frames) open in a new window, downloads are saved
  // without leaving a blank window behind, and anything else goes to the default browser.
  win.webContents.setWindowOpenHandler(({ url: u }) => {
    if (!own(u)) {
      shell.openExternal(u)
      return { action: 'deny' }
    }
    if (new URL(u).searchParams.has('download')) {
      win.webContents.downloadURL(u)
      return { action: 'deny' }
    }
    return { action: 'allow' }
  })
  win.webContents.on('will-navigate', (e, u) => {
    if (own(u)) return
    e.preventDefault()
    shell.openExternal(u)
  })
  win.once('ready-to-show', () => win.show())
  win.loadURL(url)
  return win
}

app.on('second-instance', () => {
  const [win] = BrowserWindow.getAllWindows()
  if (win) {
    if (win.isMinimized()) win.restore()
    win.focus()
  }
})

app.on('before-quit', () => {
  quitting = true
  server?.kill()
})

app.on('window-all-closed', () => app.quit())

app.whenReady().then(async () => {
  try {
    createWindow(app.isPackaged ? await startServer() : DEV_URL)
  } catch (e) {
    dialog.showErrorBox('Bower could not start', `${e.message}\n\nDetails are in:\n${join(app.getPath('logs'), 'server.log')}`)
    app.quit()
  }
})
