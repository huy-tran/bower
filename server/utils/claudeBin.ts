import { spawn, type ChildProcessWithoutNullStreams, type SpawnOptions } from 'node:child_process'
import { existsSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { delimiter, dirname, join } from 'node:path'
import { patchSettings, readSettings } from './settings'

// Where Claude Code lives differs per machine: the native installer, npm (global or a custom prefix), Homebrew,
// or somewhere the user chose. Every place that starts Claude goes through here. Order:
// 1. the path the user set in Bower (saved for this machine, all projects)
// 2. CLAUDE_BIN (the desktop app sets it when it finds Claude at start-up)
// 3. the PATH
// 4. the usual install folders
// npm installs a claude.cmd shim on Windows, which Node cannot start directly, so that is run as
// `node <cli.js>` with the Node running Bower (in the desktop app, Electron running as Node).
const WIN = process.platform === 'win32'

export interface ClaudeBin { cmd: string, pre: string[], path: string, source: 'setting' | 'env' | 'path' | 'folder' }

const isFile = (p: string) => { try { return statSync(p).isFile() } catch { return false } }

// A file path, or a folder that holds Claude Code: returns the program inside, or null.
function inspect(p: string): string | null {
  const t = p.trim().replace(/^"|"$/g, '')
  if (!t) return null
  if (isFile(t)) return t
  const names = WIN ? ['claude.exe', 'claude.cmd'] : ['claude']
  for (const n of names) if (isFile(join(t, n))) return join(t, n)
  for (const n of names) if (isFile(join(t, 'bin', n))) return join(t, 'bin', n)
  return null
}

function onPath(): string | null {
  const names = WIN ? ['claude.exe', 'claude.cmd'] : ['claude']
  for (const dir of (process.env.PATH || '').split(delimiter).filter(Boolean)) {
    for (const n of names) if (isFile(join(dir, n))) return join(dir, n)
  }
  return null
}

function usualFolders(): string | null {
  const home = homedir()
  const list = WIN
    ? [join(home, '.local', 'bin', 'claude.exe'), join(home, '.claude', 'local', 'claude.exe'), join(process.env.APPDATA || join(home, 'AppData', 'Roaming'), 'npm', 'claude.cmd'), join(process.env.LOCALAPPDATA || join(home, 'AppData', 'Local'), 'Programs', 'claude', 'claude.exe')]
    : [join(home, '.local', 'bin', 'claude'), join(home, '.claude', 'local', 'claude'), '/opt/homebrew/bin/claude', '/usr/local/bin/claude', join(home, '.npm-global', 'bin', 'claude'), join(home, '.volta', 'bin', 'claude')]
  return list.find(isFile) ?? null
}

// claude.cmd -> node <prefix>/node_modules/@anthropic-ai/claude-code/cli.js
function launcher(path: string, source: ClaudeBin['source']): ClaudeBin {
  if (WIN && /\.cmd$/i.test(path)) {
    const cli = join(dirname(path), 'node_modules', '@anthropic-ai', 'claude-code', 'cli.js')
    if (existsSync(cli)) return { cmd: process.execPath, pre: [cli], path, source }
  }
  return { cmd: path, pre: [], path, source }
}

let cache: { at: number, bin: ClaudeBin | null } | null = null

export async function findClaude(fresh = false): Promise<ClaudeBin | null> {
  if (!fresh && cache && Date.now() - cache.at < 30_000) return cache.bin
  const set = (await readSettings()).claudePath
  const fromSetting = set ? inspect(set) : null
  const env = process.env.CLAUDE_BIN && isFile(process.env.CLAUDE_BIN) ? process.env.CLAUDE_BIN : null
  const found = fromSetting ? launcher(fromSetting, 'setting')
    : env ? launcher(env, 'env')
      : onPath() ? launcher(onPath()!, 'path')
        : usualFolders() ? launcher(usualFolders()!, 'folder')
          : null
  cache = { at: Date.now(), bin: found }
  return found
}

export async function getClaudeSetting() {
  return (await readSettings()).claudePath ?? ''
}

// Saves the user's choice after checking that it really is Claude Code. An empty path goes back to automatic.
export async function setClaudePath(path: string) {
  const t = path.trim()
  if (!t) {
    await patchSettings({ claudePath: null })
    return findClaude(true)
  }
  const file = inspect(t)
  if (!file) throw createError({ statusCode: 422, message: `No Claude Code program at ${t}. Choose the folder that holds ${WIN ? 'claude.exe' : 'claude'}, or the program itself.` })
  const version = await claudeVersion(launcher(file, 'setting'))
  if (!version) throw createError({ statusCode: 422, message: `${file} did not answer like Claude Code (claude --version failed).` })
  await patchSettings({ claudePath: t })
  return findClaude(true)
}

export function claudeVersion(bin: ClaudeBin) {
  return new Promise<string | null>((resolveVersion) => {
    let out = ''
    const p = spawn(bin.cmd, [...bin.pre, '--version'], { windowsHide: true })
    p.stdout?.on('data', d => (out += d))
    p.on('error', () => resolveVersion(null))
    p.on('close', code => resolveVersion(code === 0 && out.trim() ? out.trim().split(/\s/)[0]! : null))
    setTimeout(() => { p.kill(); resolveVersion(null) }, 15_000)
  })
}

// Claude Code, or a plain-words error. Callers resolve it before starting a job, so a missing Claude never
// leaves a job stuck as "running".
export async function requireClaude() {
  const bin = await findClaude()
  if (!bin) throw createError({ statusCode: 503, message: 'Claude Code was not found on this computer. Install it, or point Bower at it in Settings, General.' })
  return bin
}

// Always piped stdio (the default), which is what every caller reads and writes.
export function spawnClaude(bin: ClaudeBin, args: string[], opts: Omit<SpawnOptions, 'stdio'> & { stdio?: ['pipe', 'pipe', 'pipe'] }) {
  return spawn(bin.cmd, [...bin.pre, ...args], { windowsHide: true, ...opts }) as ChildProcessWithoutNullStreams
}
