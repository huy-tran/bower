import { execFileSync, spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { createWriteStream, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { homedir } from 'node:os'
import { delimiter, join } from 'node:path'
import { app, BrowserWindow, dialog, ipcMain, Menu, session, shell } from 'electron'
import updater from 'electron-updater'

// Bower's desktop shell. Packaged, it starts the bundled Nuxt server on a localhost port
// (run by Electron's own Node) and opens a window on it. In development (`npm run dev:desktop`)
// it only opens a window on the `nuxt dev` server.
const DEV_URL = process.env.BOWER_DEV_URL || 'http://localhost:3000'
// Only this app's window (via a cookie), its Chrome and Claude's helper get the token; the server
// refuses everything else (server/middleware/token.ts). New on every launch.
const TOKEN = randomBytes(32).toString('hex')
let server = null
let quitting = false

// A separate data folder (and with it a separate single-instance lock), e.g. to test a build
// next to the installed app.
if (process.env.BOWER_USER_DATA) app.setPath('userData', process.env.BOWER_USER_DATA)
const primary = app.requestSingleInstanceLock()
if (!primary) app.quit()

// Resolves to the port it could listen on (0 picks any free one), or null when that port is taken.
function tryPort(port) {
  return new Promise((resolve) => {
    const s = createServer()
    s.unref()
    s.on('error', () => resolve(null))
    s.listen(port, '127.0.0.1', () => {
      const { port } = s.address()
      s.close(() => resolve(port))
    })
  })
}

// The page's browser data (last project, chat model, the downloaded voice and caption models) is
// kept per origin, port included, so the server keeps the same port across launches: the one used
// last time, or a free one (remembered from then on) if another program has taken it.
const DEFAULT_PORT = 47821
async function stablePort() {
  const file = join(app.getPath('userData'), 'port.json')
  let saved = DEFAULT_PORT
  try { saved = JSON.parse(readFileSync(file, 'utf8')).port || DEFAULT_PORT } catch {}
  const port = await tryPort(saved) ?? await tryPort(0)
  if (port !== saved) {
    try {
      mkdirSync(app.getPath('userData'), { recursive: true })
      writeFileSync(file, JSON.stringify({ port }))
    } catch {}
  }
  return port
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
  const port = await stablePort()
  const url = `http://127.0.0.1:${port}`
  const path = shellPath()
  const env = {
    ...process.env,
    ELECTRON_RUN_AS_NODE: '1',
    NODE_ENV: 'production',
    NITRO_HOST: '127.0.0.1',
    NITRO_PORT: String(port),
    BOWER_STORAGE: join(app.getPath('userData'), 'storage', 'projects'),
    BOWER_TOKEN: TOKEN,
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
      if ((await fetch(url, { headers: { 'x-bower-token': TOKEN } })).ok) {
        await session.defaultSession.cookies.set({ url, name: 'bower_token', value: TOKEN, httpOnly: true, sameSite: 'strict' })
        return url
      }
    } catch {}
    await new Promise(r => setTimeout(r, 100))
  }
  throw new Error('The server did not start within 30 seconds')
}

// No native menu bar or title bar: the page draws its own top strip (app/pages/index.vue) and, on Windows and Linux,
// the system's minimise, maximise and close buttons are drawn over its top-right corner in the page's colours
// (bower:title-bar). On a Mac the traffic lights sit inset in the same strip. The strip height must match the page.
const TITLE_BAR_HEIGHT = 36
const MAC = process.platform === 'darwin'
const windowChrome = MAC
  ? { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 14, y: 11 } }
  : { titleBarStyle: 'hidden', titleBarOverlay: { color: '#f4f1ea', symbolColor: '#57534e', height: TITLE_BAR_HEIGHT } }

function createWindow(url) {
  // BOWER_TEST_OFFSCREEN opens the window off screen and without focus, so tests can capture it (PrintWindow)
  // without it appearing over anything.
  const offscreen = process.env.BOWER_TEST_OFFSCREEN === '1'
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    ...(offscreen && { x: -4000, y: 0 }),
    title: 'Bower',
    backgroundColor: '#f4f1ea',
    ...windowChrome,
    show: false,
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false, preload: join(import.meta.dirname, 'preload.cjs') }
  })
  const origin = appOrigin = new URL(url).origin
  const own =(u) => { try { return new URL(u).origin === origin } catch { return false } }

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
  win.once('ready-to-show', () => offscreen ? win.showInactive() : win.show())
  // Without a menu, Electron's own shortcuts go too; keep the developer tools reachable for support.
  win.webContents.on('before-input-event', (e, input) => {
    if (input.type === 'keyDown' && (input.key === 'F12' || (input.control && input.shift && input.key.toLowerCase() === 'i'))) {
      win.webContents.toggleDevTools()
      e.preventDefault()
    }
  })
  win.loadURL(url)
  return win
}

// Only Bower's own pages may use what preload.cjs offers.
let appOrigin = null
const fromApp = e => new URL(e.senderFrame.url).origin === appOrigin

// The page reports its background and text colours (light or dark theme), and the window buttons follow them.
ipcMain.handle('bower:title-bar', (e, { color, symbolColor } = {}) => {
  if (!fromApp(e) || MAC) return
  const win = BrowserWindow.fromWebContents(e.sender)
  const hex = v => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) ? v : undefined
  if (win && hex(color)) win.setTitleBarOverlay({ color: hex(color), symbolColor: hex(symbolColor) ?? '#57534e', height: TITLE_BAR_HEIGHT })
})

// Native folder chooser for "Browse..." (linked codebases).
ipcMain.handle('bower:pick-folder', async (e, { title, initial } = {}) => {
  if (!fromApp(e)) return null
  const win = BrowserWindow.fromWebContents(e.sender)
  const r = await dialog.showOpenDialog(win, {
    title: typeof title === 'string' ? title.slice(0, 120) : 'Choose a folder',
    defaultPath: typeof initial === 'string' && existsSync(initial) ? initial : undefined,
    properties: ['openDirectory']
  })
  return r.canceled ? null : r.filePaths[0] ?? null
})

// Updates come from the GitHub releases (electron-builder.yml, publish). A new version downloads in
// the background; a dialog then offers to restart into it (app/components/DesktopUpdate.vue),
// and otherwise it installs when Bower quits.
let update = null // { version, state: 'downloading' | 'ready', notes }
const sendUpdate = () => BrowserWindow.getAllWindows().forEach(w => w.webContents.send('bower:update', update))

// The release notes arrive as the GitHub release page's HTML (from CHANGELOG.md, see the release workflow). The
// dialog shows them as plain text: no markup from outside reaches the window.
function notesText(raw) {
  const html = Array.isArray(raw) ? raw.map(n => n.note || '').join('\n') : String(raw || '')
  return html
    .replace(/<li[^>]*>/gi, '\n- ').replace(/<\/(p|h\d|ul|ol|div)>/gi, '\n').replace(/<br\s*\/?>/gi, '\n').replace(/<h\d[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, '\'').replace(/&nbsp;/g, ' ')
    .replace(/[ \t]+\n/g, '\n').replace(/\n\s*\n- /g, '\n- ').replace(/\n{3,}/g, '\n\n').trim()
    .slice(0, 6000)
}

function checkForUpdates() {
  const log = createWriteStream(join(app.getPath('logs'), 'updater.log'), { flags: 'a' })
  const write = level => (...a) => log.write(`${new Date().toISOString()} ${level} ${a.join(' ')}\n`)
  const { autoUpdater } = updater
  autoUpdater.logger = { info: write('info'), warn: write('warn'), error: write('error'), debug: () => {} }
  // A copy with its own data folder (BOWER_USER_DATA, used for testing) shares the installed app's
  // ID, so installing on quit would replace the real installation. Such copies only install on click.
  autoUpdater.autoInstallOnAppQuit = !process.env.BOWER_USER_DATA
  autoUpdater.on('update-available', (info) => { update = { version: info.version, state: 'downloading', notes: notesText(info.releaseNotes) }; sendUpdate() })
  autoUpdater.on('update-downloaded', (info) => { update = { version: info.version, state: 'ready', notes: notesText(info.releaseNotes) }; sendUpdate() })
  autoUpdater.on('error', () => { if (update?.state === 'downloading') { update = null; sendUpdate() } })
  const check = () => { if (update?.state !== 'ready') autoUpdater.checkForUpdates().catch(e => write('error')(e?.message ?? e)) }
  check()
  setInterval(check, 60 * 60 * 1000).unref()
}

ipcMain.handle('bower:update-state', e => fromApp(e) ? update : null)
ipcMain.handle('bower:install-update', (e) => {
  if (!fromApp(e) || update?.state !== 'ready') return
  quitting = true
  server?.kill()
  updater.autoUpdater.quitAndInstall(true, true) // silent install, then start the new version
})

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
  if (!primary) return // another Bower is open; the second-instance event focuses it
  // No File / Edit / View / Window bar. Copy, paste, undo and select-all still work in text fields (Chromium
  // handles them itself); a Mac keeps its standard menu, which lives in the system menu bar.
  if (!MAC) Menu.setApplicationMenu(null)
  try {
    createWindow(app.isPackaged ? await startServer() : DEV_URL)
    if (app.isPackaged) checkForUpdates()
  } catch (e) {
    dialog.showErrorBox('Bower could not start', `${e.message}\n\nDetails are in:\n${join(app.getPath('logs'), 'server.log')}`)
    app.quit()
  }
})
