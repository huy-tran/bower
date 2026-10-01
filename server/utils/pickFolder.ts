import { execFile } from 'node:child_process'
import { promises as fs } from 'node:fs'

// Opens the operating system's folder chooser on the machine running Bower (the user's own) and
// returns the chosen path, or null when the dialog is cancelled. A browser cannot reveal absolute
// paths, so this is the only way to offer "Browse..." for a local repo.
const TIMEOUT_MS = 5 * 60 * 1000
let busy = false

function run(cmd: string, args: string[], env: Record<string, string> = {}) {
  return new Promise<{ code: number, stdout: string }>((resolve, reject) => {
    execFile(cmd, args, { timeout: TIMEOUT_MS, windowsHide: true, maxBuffer: 1 << 20, env: { ...process.env, ...env } }, (err: any, stdout) => {
      if (err && typeof err.code !== 'number') return reject(err) // not found, killed, timed out
      resolve({ code: err?.code ?? 0, stdout: String(stdout) })
    })
  })
}

// The script is a fixed string: user-supplied values reach it only through environment variables,
// never by interpolation, so they cannot inject PowerShell.
const WINDOWS_SCRIPT = `
  [Console]::OutputEncoding = [Text.Encoding]::UTF8
  Add-Type -AssemblyName System.Windows.Forms
  $owner = New-Object System.Windows.Forms.Form
  $owner.TopMost = $true
  $d = New-Object System.Windows.Forms.FolderBrowserDialog
  $d.Description = $env:BOWER_PICK_TITLE
  $d.ShowNewFolderButton = $false
  try { $d.UseDescriptionForTitle = $true } catch {}
  if ($env:BOWER_PICK_INITIAL) { $d.SelectedPath = $env:BOWER_PICK_INITIAL }
  if ($d.ShowDialog($owner) -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::Out.Write($d.SelectedPath) }
`
const WINDOWS_ARGS = ['-NoProfile', '-NonInteractive', '-Sta', '-EncodedCommand', Buffer.from(WINDOWS_SCRIPT, 'utf16le').toString('base64')]

async function windows(title: string, initial?: string) {
  const { stdout } = await run('powershell.exe', WINDOWS_ARGS, { BOWER_PICK_TITLE: title, BOWER_PICK_INITIAL: initial ?? '' })
  return stdout.trim() || null
}

async function mac(title: string, initial?: string) {
  const start = initial ? ` default location (POSIX file ${JSON.stringify(initial)})` : ''
  const { code, stdout } = await run('osascript', ['-e', `POSIX path of (choose folder with prompt ${JSON.stringify(title)}${start})`])
  if (code !== 0) return null // cancelled
  return stdout.trim().replace(/\/$/, '') || null
}

async function linux(title: string, initial?: string) {
  try {
    const { code, stdout } = await run('zenity', ['--file-selection', '--directory', `--title=${title}`, ...(initial ? [`--filename=${initial.replace(/\/?$/, '/')}`] : [])])
    return code === 0 ? stdout.trim() || null : null
  } catch {
    const { code, stdout } = await run('kdialog', ['--getexistingdirectory', initial || process.env.HOME || '/', '--title', title])
    return code === 0 ? stdout.trim() || null : null
  }
}

export async function pickFolder(title = 'Choose a folder', initial?: string) {
  if (busy) throw createError({ statusCode: 409, message: 'A folder chooser is already open on this computer' })
  busy = true
  try {
    title = title.replace(/[^\p{L}\p{N}\p{P}\p{Zs}]/gu, '').slice(0, 120) || 'Choose a folder' // printable text only
    if (initial && !(await fs.stat(initial).catch(() => null))?.isDirectory()) initial = undefined
    const pick = process.platform === 'win32' ? windows : process.platform === 'darwin' ? mac : linux
    return await pick(title, initial)
  } catch (e: any) {
    throw createError({ statusCode: 501, message: `Could not open a folder chooser on this computer (${e?.code || e?.message || e}). Paste the path instead.` })
  } finally {
    busy = false
  }
}
