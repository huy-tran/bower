import { execFile } from 'node:child_process'
import { arch, platform, release } from 'node:os'
import { dirname } from 'node:path'
import ffmpegPath from 'ffmpeg-static'
import puppeteer from 'puppeteer'
import { findClaude, claudeVersion } from '../utils/claudeBin'
import { STORAGE } from '../utils/paths'

// For the About window: which Bower this is, and the tools it runs on this computer.
const run = (cmd: string, args: string[]) => new Promise<string>((resolve) => {
  execFile(cmd, args, { timeout: 10_000, windowsHide: true }, (err, stdout) => resolve(err ? '' : String(stdout)))
})

let cached: Record<string, unknown> | null = null

// Windows 11 still reports itself as 10.0; its build number (22000 and up) tells them apart.
function systemName() {
  const r = release()
  if (platform() === 'win32') {
    const build = Number(r.split('.')[2])
    return `Windows ${build >= 22000 ? 11 : 10} (build ${build})`
  }
  return `${({ darwin: 'macOS', linux: 'Linux' } as Record<string, string>)[platform()] ?? platform()} ${r}`
}

export default defineEventHandler(async () => {
  if (cached) return cached
  const pub = useRuntimeConfig().public as { version: string, builtAt?: string, commit?: string }
  const chromePath = await Promise.resolve().then(() => puppeteer.executablePath()).catch(() => '')
  const ffmpeg = ffmpegPath ? (await run(ffmpegPath as unknown as string, ['-version'])).split('\n')[0]?.match(/ffmpeg version (\S+)/)?.[1] ?? '' : ''
  const claude = await findClaude()
  cached = {
    version: pub.version,
    builtAt: pub.builtAt ?? null,
    commit: pub.commit || null,
    edition: process.versions.electron ? 'Desktop app' : import.meta.dev ? 'Development server' : 'Browser',
    platform: `${systemName()} (${arch()})`,
    runtime: process.versions.electron ? `Electron ${process.versions.electron}, Node ${process.versions.node}` : `Node ${process.versions.node}`,
    chrome: chromePath.match(/(\d+\.\d+\.\d+\.\d+)/)?.[1] ?? null,
    ffmpeg: ffmpeg || null,
    claude: claude ? { version: await claudeVersion(claude), path: claude.path } : null,
    dataFolder: dirname(STORAGE)
  }
  return cached
})
