import { spawn } from 'node:child_process'
import { promises as fs } from 'node:fs'
import { cpus } from 'node:os'
import { join } from 'node:path'
import ffmpegPath from 'ffmpeg-static'
import puppeteer, { type Browser, type Page } from 'puppeteer'
import { CHROME_ARGS } from './browser'
import { audioMix } from './mix'
import { loadProject, projectDir, sceneViews } from './store'

export type RenderFormat = 'mp4' | 'gif' | 'mov'

export interface RenderOptions { fps?: number, sceneId?: string, scale?: number, format?: RenderFormat }

export interface RenderJob {
  id: string
  pid: string
  status: 'running' | 'encoding' | 'done' | 'error' | 'cancelled'
  frame: number
  total: number
  workers: number
  format: RenderFormat
  startedAt: number
  finishedAt?: number
  file?: string
  error?: string
  label: string
  cancel?: boolean
}

interface QueueEntry { id: string, pid: string, origin: string, opts: RenderOptions, label: string, format: RenderFormat, addedAt: number }

// One render at a time across every project (they are CPU-bound); the rest wait in a queue.
let running: RenderJob | null = null
const queue: QueueEntry[] = []
const recent = new Map<string, RenderJob[]>() // pid -> last finished jobs, newest first
const FFMPEG = ffmpegPath as unknown as string
const strip = (j: RenderJob) => { const { cancel, ...rest } = j; return rest }

export function getRenderStatus(pid: string) {
  const mine = running?.pid === pid ? strip(running) : null
  return {
    job: mine ?? (recent.get(pid)?.[0] ? strip(recent.get(pid)![0]!) : null),
    queue: queue.map((q, i) => ({ id: q.id, pid: q.pid, label: q.label, format: q.format, addedAt: q.addedAt, position: i + 1 })).filter(q => q.pid === pid),
    recent: (recent.get(pid) ?? []).map(strip),
    busyElsewhere: !!running && running.pid !== pid ? { label: running.label, frame: running.frame, total: running.total } : null
  }
}

export function cancelRender(pid: string, id?: string) {
  if (id) {
    const i = queue.findIndex(q => q.id === id && q.pid === pid)
    if (i >= 0) queue.splice(i, 1)
    if (running?.id === id && running.pid === pid) running.cancel = true
    return
  }
  if (running?.pid === pid && (running.status === 'running' || running.status === 'encoding')) running.cancel = true
}

export async function enqueueRender(pid: string, origin: string, opts: RenderOptions) {
  const p = await loadProject(pid)
  const all = await sceneViews(p)
  const scenes = opts.sceneId ? all.filter(s => s.id === opts.sceneId) : all
  if (!scenes.length) throw createError({ statusCode: 400, message: 'Nothing to render' })
  const format: RenderFormat = opts.format === 'gif' || opts.format === 'mov' ? opts.format : 'mp4'
  const entry: QueueEntry = { id: `r-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`, pid, origin, opts, label: opts.sceneId ? scenes[0]!.title : p.name, format, addedAt: Date.now() }
  queue.push(entry)
  pump()
  return getRenderStatus(pid)
}

function pump() {
  if (running && (running.status === 'running' || running.status === 'encoding')) return
  const next = queue.shift()
  if (!next) return
  runRender(next).catch(() => {})
}

export async function listRenders(pid: string) {
  const dir = join(projectDir(pid), 'renders')
  try {
    const files = (await fs.readdir(dir)).filter(f => /\.(mp4|gif|mov)$/.test(f))
    const stats = await Promise.all(files.map(async (name) => {
      const s = await fs.stat(join(dir, name))
      return { name, size: s.size, at: s.mtime.toISOString() }
    }))
    return stats.sort((a, b) => b.at.localeCompare(a.at))
  } catch {
    return []
  }
}

function ffmpeg(args: string[], stdin = false) {
  const proc = spawn(FFMPEG, ['-y', '-loglevel', 'error', ...args], { stdio: [stdin ? 'pipe' : 'ignore', 'ignore', 'pipe'], windowsHide: true })
  let err = ''
  proc.stderr!.on('data', (d) => { err += d.toString() })
  const done = new Promise<void>((res, rej) => proc.on('close', code => code === 0 ? res() : rej(new Error(`ffmpeg: ${err.trim() || `exit ${code}`}`))))
  return { proc, done }
}

async function runRender(entry: QueueEntry) {
  const { pid, origin, opts } = entry
  // Claim the slot at once so status polls see a render starting while the project loads.
  running = { id: entry.id, pid, status: 'running', frame: 0, total: 0, workers: 0, format: entry.format, startedAt: Date.now(), label: entry.label }
  const p = await loadProject(pid)
  const all = await sceneViews(p)
  const scenes = opts.sceneId ? all.filter(s => s.id === opts.sceneId) : all
  if (!scenes.length) throw createError({ statusCode: 400, message: 'Nothing to render' })

  const format: RenderFormat = opts.format === 'gif' || opts.format === 'mov' ? opts.format : 'mp4'
  const fps = Math.min(60, Math.max(12, opts.fps || p.fps || 30))
  const scale = opts.scale === 0.5 ? 0.5 : 1
  const width = Math.round(p.width * scale / 2) * 2, height = Math.round(p.height * scale / 2) * 2
  const videoTotal = all.reduce((a, s) => a + s.duration, 0)
  const rangeStart = scenes[0]!.start
  const rangeEnd = scenes.at(-1)!.start + scenes.at(-1)!.duration
  const total = Math.round((rangeEnd - rangeStart) * fps / 1000)
  const dur = total * 1000 / fps
  // A few workers pay off quickly; beyond ~6 the encoders and Chrome fight over the CPU.
  const workers = Math.max(1, Math.min(6, Math.floor(cpus().length / 3), Math.ceil(total / 45)))

  const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19)
  const label = opts.sceneId ? scenes[0]!.title : p.name
  const name = `${stamp}-${opts.sceneId ? scenes[0]!.id : 'full'}.${format}`
  const dir = join(projectDir(pid), 'renders')
  const tmp = join(dir, `.tmp-${stamp}`)
  await fs.mkdir(tmp, { recursive: true })
  const out = join(dir, name)

  const job: RenderJob = { id: entry.id, pid, status: 'running', frame: 0, total, workers, format, startedAt: Date.now(), label }
  if (running?.id === entry.id && running.cancel) job.cancel = true // cancelled while the project was still loading
  running = job
  const url = `${origin}/api/projects/${pid}/player?render=1${format === 'mov' ? '&transparent=1' : ''}`
  const segExt = format === 'mov' ? 'mov' : 'mp4'

  ;(async () => {
    // Chrome only paints the foreground tab, so every worker gets its own browser with a single page.
    const browsers: Browser[] = []
    const encoders: ReturnType<typeof ffmpeg>[] = []
    try {

      // Split the frames into contiguous chunks; each worker films and encodes its own segment.
      const per = Math.ceil(total / workers)
      const chunks = Array.from({ length: workers }, (_, i) => [i * per, Math.min(total, (i + 1) * per)] as const).filter(([a, b]) => b > a)
      let done = 0

      await Promise.all(chunks.map(async ([a, b], ci) => {
        const browser = await puppeteer.launch({ headless: true, args: CHROME_ARGS })
        browsers.push(browser)
        const page: Page = (await browser.pages())[0] ?? await browser.newPage()
        await page.setViewport({ width, height, deviceScaleFactor: 1 })
        const errors: string[] = []
        page.on('pageerror', e => errors.push(String(e)))
        await page.goto(url, { waitUntil: 'networkidle0', timeout: 120_000 })
        await page.evaluate(() => Promise.race([(window as any).__ready, new Promise(r => setTimeout(r, 30_000))]))
        await page.evaluate(() => document.fonts?.ready)

        const seg = join(tmp, `seg-${String(ci).padStart(3, '0')}.${segExt}`)
        const enc = ffmpeg(format === 'mov'
          ? ['-f', 'image2pipe', '-framerate', String(fps), '-c:v', 'png', '-i', '-', '-c:v', 'prores_ks', '-profile:v', '4', '-pix_fmt', 'yuva444p10le', '-vendor', 'apl0', seg]
          : ['-f', 'image2pipe', '-framerate', String(fps), '-c:v', 'mjpeg', '-i', '-', '-c:v', 'libx264', '-preset', 'medium', '-crf', format === 'gif' ? '12' : '16', '-pix_fmt', 'yuv420p', seg], true)
        encoders.push(enc)
        const write = (buf: Uint8Array) => new Promise<void>((res, rej) => {
          if (enc.proc.stdin!.destroyed) return rej(new Error('encoder stopped'))
          enc.proc.stdin!.write(buf, err => err ? rej(err) : res())
        })

        for (let f = a; f < b; f++) {
          if (job.cancel) throw new Error('cancelled')
          await page.evaluate(t => (window as any).__render(t), rangeStart + f * 1000 / fps)
          const buf = format === 'mov'
            ? await page.screenshot({ type: 'png', omitBackground: true })
            : await page.screenshot({ type: 'jpeg', quality: 95, optimizeForSpeed: true })
          await write(buf)
          job.frame = ++done
        }
        if (errors.length) throw new Error(`A scene threw while rendering: ${errors[0]}`)
        enc.proc.stdin!.end()
        await enc.done
        await browser.close()
      }))

      job.status = 'encoding'

      const segs = (await fs.readdir(tmp)).filter(f => f.startsWith('seg-')).sort()
      await fs.writeFile(join(tmp, 'list.txt'), segs.map(s => `file '${join(tmp, s).replace(/\\/g, '/').replace(/'/g, "'\\''")}'`).join('\n'))
      const joined = join(tmp, `joined.${segExt}`)
      await ffmpeg(['-f', 'concat', '-safe', '0', '-i', join(tmp, 'list.txt'), '-c', 'copy', joined]).done
      if (job.cancel) throw new Error('cancelled')

      if (format === 'gif') {
        const gfps = Math.min(fps, 24)
        const gw = Math.min(width, 960)
        await ffmpeg(['-i', joined, '-filter_complex', `fps=${gfps},scale=${gw}:-1:flags=lanczos,split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle`, '-loop', '0', out]).done
      } else {
        const mix = audioMix(p, projectDir(pid), rangeStart, dur, videoTotal)
        if (mix) {
          await ffmpeg([
            '-i', joined, ...mix.inputs, '-filter_complex', mix.filter, '-map', '0:v', '-map', '[aout]', '-c:v', 'copy',
            ...(format === 'mov' ? ['-c:a', 'pcm_s16le'] : ['-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart']),
            '-t', (dur / 1000).toFixed(3), out
          ]).done
        } else if (format === 'mp4') {
          await ffmpeg(['-i', joined, '-c', 'copy', '-movflags', '+faststart', out]).done
        } else {
          await fs.rename(joined, out)
        }
      }
      job.status = 'done'
      job.file = name
    } catch (e) {
      for (const enc of encoders) { enc.proc.stdin?.destroy(); enc.proc.kill() }
      await fs.rm(out, { force: true }).catch(() => {})
      const msg = (e as Error).message
      job.status = msg === 'cancelled' ? 'cancelled' : 'error'
      job.error = msg === 'cancelled' ? undefined : msg
    } finally {
      job.finishedAt = Date.now()
      await Promise.all(browsers.map(b => b.close().catch(() => {})))
      await fs.rm(tmp, { recursive: true, force: true }).catch(() => {})
      recent.set(pid, [job, ...(recent.get(pid) ?? [])].slice(0, 10))
      if (running === job) running = null
      pump()
    }
  })()
}
