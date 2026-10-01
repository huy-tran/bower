import { spawn } from 'node:child_process'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import ffmpegPath from 'ffmpeg-static'
import puppeteer, { type Browser } from 'puppeteer'
import { loadProject, projectDir, sceneViews } from './store'

export interface RenderJob {
  status: 'running' | 'done' | 'error' | 'cancelled'
  frame: number
  total: number
  startedAt: number
  finishedAt?: number
  file?: string
  error?: string
  label: string
  cancel?: boolean
}

const jobs = new Map<string, RenderJob>()

export function getRenderJob(pid: string) {
  const j = jobs.get(pid)
  if (!j) return null
  const { cancel, ...rest } = j
  return rest
}

export function cancelRender(pid: string) {
  const j = jobs.get(pid)
  if (j?.status === 'running') j.cancel = true
}

export async function listRenders(pid: string) {
  const dir = join(projectDir(pid), 'renders')
  try {
    const files = (await fs.readdir(dir)).filter(f => f.endsWith('.mp4'))
    const stats = await Promise.all(files.map(async (name) => {
      const s = await fs.stat(join(dir, name))
      return { name, size: s.size, at: s.mtime.toISOString() }
    }))
    return stats.sort((a, b) => b.at.localeCompare(a.at))
  } catch {
    return []
  }
}

export async function startRender(pid: string, origin: string, opts: { fps?: number, sceneId?: string, scale?: number }) {
  if (jobs.get(pid)?.status === 'running') throw createError({ statusCode: 409, message: 'A render is already running' })
  const p = await loadProject(pid)
  const all = await sceneViews(p)
  const scenes = opts.sceneId ? all.filter(s => s.id === opts.sceneId) : all
  if (!scenes.length) throw createError({ statusCode: 400, message: 'Nothing to render' })

  const fps = Math.min(60, Math.max(12, opts.fps || p.fps || 30))
  const scale = opts.scale === 0.5 ? 0.5 : 1
  const width = Math.round(p.width * scale / 2) * 2, height = Math.round(p.height * scale / 2) * 2
  const rangeStart = scenes[0]!.start
  const rangeEnd = scenes.at(-1)!.start + scenes.at(-1)!.duration
  const frameAt = (ms: number) => Math.round((ms - rangeStart) * fps / 1000)
  const total = frameAt(rangeEnd)

  const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19)
  const label = opts.sceneId ? scenes[0]!.title : p.name
  const name = `${stamp}-${opts.sceneId ? scenes[0]!.id : 'full'}.mp4`
  await fs.mkdir(join(projectDir(pid), 'renders'), { recursive: true })
  const out = join(projectDir(pid), 'renders', name)

  const job: RenderJob = { status: 'running', frame: 0, total, startedAt: Date.now(), label }
  jobs.set(pid, job)

  const audioArgs: string[] = []
  if (p.audio?.file) {
    const offset = (p.audio.startOffset || 0) + rangeStart
    audioArgs.push('-ss', (offset / 1000).toFixed(3), '-i', join(projectDir(pid), 'audio', p.audio.file))
  }

  const args = [
    '-y', '-loglevel', 'error',
    '-f', 'image2pipe', '-framerate', String(fps), '-c:v', 'mjpeg', '-i', '-',
    ...audioArgs,
    '-map', '0:v', ...(audioArgs.length ? ['-map', '1:a', '-c:a', 'aac', '-b:a', '192k', '-af', `afade=t=out:st=${Math.max(0, total / fps - 0.4).toFixed(3)}:d=0.4`] : []),
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '16', '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
    '-t', (total / fps).toFixed(3),
    out
  ]

  ;(async () => {
    let browser: Browser | null = null
    const ff = spawn(ffmpegPath as unknown as string, args, { stdio: ['pipe', 'ignore', 'pipe'], windowsHide: true })
    let ffErr = ''
    ff.stderr.on('data', (d) => { ffErr += d.toString() })
    const ffDone = new Promise<number>(res => ff.on('close', code => res(code ?? 1)))
    const write = (buf: Uint8Array) => new Promise<void>((res, rej) => {
      if (ff.stdin.destroyed) return rej(new Error(`ffmpeg exited: ${ffErr}`))
      ff.stdin.write(buf, err => err ? rej(err) : res())
    })

    try {
      browser = await puppeteer.launch({ headless: true, args: ['--hide-scrollbars', '--mute-audio', '--force-color-profile=srgb'] })
      const page = await browser.newPage()
      await page.setViewport({ width, height, deviceScaleFactor: 1 })
      const errors: string[] = []
      page.on('pageerror', e => errors.push(String(e)))

      for (const s of scenes) {
        await page.goto(`${origin}/api/projects/${pid}/scenes/${s.id}/frame?render=1&t=0`, { waitUntil: 'networkidle0' })
        await page.evaluate(() => document.fonts?.ready)
        const first = frameAt(s.start), last = frameAt(s.start + s.duration)
        for (let f = first; f < last; f++) {
          if (job.cancel) throw new Error('cancelled')
          const t = (f * 1000 / fps) + rangeStart - s.start
          await page.evaluate(t => (window as any).__seek(t), t)
          const buf = await page.screenshot({ type: 'jpeg', quality: 95, optimizeForSpeed: true })
          await write(buf)
          job.frame = f + 1
        }
        if (errors.length) throw new Error(`Scene "${s.title}" threw: ${errors[0]}`)
      }
      ff.stdin.end()
      const code = await ffDone
      if (code !== 0) throw new Error(`ffmpeg failed: ${ffErr.trim()}`)
      job.status = 'done'
      job.file = name
    } catch (e) {
      ff.stdin.destroy()
      ff.kill()
      await fs.rm(out, { force: true }).catch(() => {})
      const msg = (e as Error).message
      job.status = msg === 'cancelled' ? 'cancelled' : 'error'
      job.error = msg === 'cancelled' ? undefined : msg
    } finally {
      job.finishedAt = Date.now()
      await browser?.close().catch(() => {})
    }
  })()

  return getRenderJob(pid)
}
