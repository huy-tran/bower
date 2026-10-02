import { randomBytes } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ElementHandle, Page } from 'puppeteer'
import { FFMPEG, runFfmpeg } from './ffmpeg'
import { ensureSignedIn, open, projectApp, resolveTarget, SHOT_SIZES, withProfile } from './shots'
import { describeStep, installFinder, parseSteps, runSteps, StepError, type Step } from './steps'
import { projectDir, slugify } from './store'

// Flow recordings: the same steps as a screenshot, played like a person would (an eased mouse glide to each
// target, a visible cursor with a click ripple, typing at a human pace, a beat after each step), recorded with
// Chrome's screencast and turned into a clip a scene can play frame-exactly (see runtime.ts, data-ve-clip):
// an MP4 at the project's frame rate with a keyframe on every frame, colour-tagged so it looks like the app. Next to it go a poster image and the
// times each step happened, so Claude can time narration and callouts to them.
const clipsDir = (pid: string) => join(projectDir(pid), 'assets', 'recordings')
const MAX_WIDTH = 1440
const MAX_SECONDS = 90

export interface FlowMarker { t: number, step: number, label: string }
export interface Recording { name: string, path: string, url: string, poster: string, posterUrl: string, width: number, height: number, fps: number, duration: number, frames: number, bytes: number, page: string, markers: FlowMarker[], at: string }

// The cursor drawn into the recorded page: an arrow that follows the real mouse events, with a ripple on each
// press. Pointer events pass through it, so it never gets in the way of the page.
function cursorScript() {
  const install = () => {
    if (document.getElementById('bower-cursor')) return
    const host = document.createElement('div')
    host.id = 'bower-cursor'
    host.style.cssText = 'position:fixed;left:0;top:0;width:0;height:0;z-index:2147483647;pointer-events:none'
    const root = host.attachShadow({ mode: 'open' })
    root.innerHTML = `<style>
      .c{position:fixed;left:0;top:0;width:28px;height:28px;margin:-3px 0 0 -4px;filter:drop-shadow(0 2px 3px rgba(0,0,0,.35));transition:transform .08s}
      .c.down{transform:scale(.88)}
      .r{position:fixed;width:36px;height:36px;margin:-18px 0 0 -18px;border-radius:50%;border:3px solid rgba(59,130,246,.85);animation:r .5s ease-out forwards}
      @keyframes r{from{transform:scale(.3);opacity:1}to{transform:scale(1.4);opacity:0}}
    </style><svg class="c" viewBox="0 0 24 24"><path d="M4 2.5 4 19.2l4.3-4.1 2.8 6.4 3-1.3-2.8-6.3 6-.4z" fill="#111" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>`
    const c = root.querySelector('.c') as SVGElement
    const at = (w: any) => { c.style.left = `${w.__bowerX ?? -100}px`; c.style.top = `${w.__bowerY ?? -100}px` }
    addEventListener('mousemove', (e) => { (window as any).__bowerX = e.clientX; (window as any).__bowerY = e.clientY; at(window) }, true)
    addEventListener('mousedown', (e) => {
      c.classList.add('down')
      const r = document.createElement('div')
      r.className = 'r'
      r.style.left = `${e.clientX}px`
      r.style.top = `${e.clientY}px`
      root.appendChild(r)
      setTimeout(() => r.remove(), 600)
    }, true)
    addEventListener('mouseup', () => c.classList.remove('down'), true)
    at(window)
    document.documentElement.appendChild(host)
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install)
  else install()
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
const easeInOut = (x: number) => x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2

// Glides the mouse from where it is to the element, over a time that grows with the distance, then a short beat.
function humanMouse(page: Page, start: { x: number, y: number }) {
  const pos = { ...start }
  return {
    pos,
    async move(el: ElementHandle<Element>) {
      await el.scrollIntoView().catch(() => {})
      await sleep(150)
      const box = await el.boundingBox()
      if (!box) return
      const to = { x: box.x + box.width / 2, y: box.y + Math.min(box.height / 2, 18) }
      const dist = Math.hypot(to.x - pos.x, to.y - pos.y)
      const ms = Math.min(900, Math.max(350, 250 + dist * 0.6))
      const steps = Math.max(8, Math.round(ms / 16))
      const from = { ...pos }
      for (let k = 1; k <= steps; k++) {
        const e = easeInOut(k / steps)
        pos.x = from.x + (to.x - from.x) * e
        pos.y = from.y + (to.y - from.y) * e
        await page.mouse.move(pos.x, pos.y)
        await sleep(ms / steps)
      }
      await sleep(180)
    }
  }
}

// Frames in an MP4, counted by ffmpeg (there is no ffprobe in ffmpeg-static).
async function countFrames(file: string) {
  const log = await runFfmpeg(['-i', file, '-map', '0:v:0', '-f', 'null', '-'], false)
  return Number([...log.matchAll(/frame=\s*(\d+)/g)].pop()?.[1] ?? 0)
}

export interface RecordOptions { target: string, steps?: Step[] | string, size?: string, name?: string }

export async function recordFlow(pid: string, opts: RecordOptions): Promise<Recording> {
  const { p, app } = await projectApp(pid)
  const steps = parseSteps(opts.steps)
  if (!steps.length) throw createError({ statusCode: 422, message: 'A recording needs steps to play, like [{"click":"Export"},{"wait":"Export contacts"}]' })
  const preset = SHOT_SIZES[opts.size ?? ''] ?? SHOT_SIZES.desktop!
  const { width, height } = preset
  const fps = p.fps || 30
  const url = resolveTarget(app.url, opts.target || '/')
  await fs.mkdir(clipsDir(pid), { recursive: true })
  const raw = join(tmpdir(), `bower-flow-${randomBytes(4).toString('hex')}.webm`)

  return withProfile(app.id, async (browser) => {
    const page = await browser.newPage()
    await page.setViewport({ width, height, deviceScaleFactor: 1 })
    await installFinder(page)
    await page.evaluateOnNewDocument(`(${cursorScript.toString()})()`)
    await open(page, url)
    await ensureSignedIn(app.id, app.url, page, url)
    await sleep(500)

    const mouse = humanMouse(page, { x: width * 0.62, y: height * 0.7 })
    await page.mouse.move(mouse.pos.x, mouse.pos.y)
    const markers: FlowMarker[] = []
    // Chrome's screencast, high quality; converted to the clip format below.
    const recorder = await page.screencast({ path: raw as `${string}.webm`, ffmpegPath: FFMPEG, fps: Math.max(30, fps), quality: 12 })
    const t0 = Date.now()
    const limit = setTimeout(() => recorder.stop().catch(() => {}), MAX_SECONDS * 1000)
    try {
      await sleep(700)
      await runSteps(page, steps, {
        resolve: t => resolveTarget(app.url, t),
        navigated: u => ensureSignedIn(app.id, app.url, page, u),
        // A shot step in a recording is a moment to hold on.
        shot: async () => { await sleep(900) },
        human: { move: el => mouse.move(el), mark: (i, s) => markers.push({ t: Date.now() - t0, step: i + 1, label: describeStep(s) }), typeDelay: 70, pause: 450 }
      })
      await sleep(900)
    } catch (e) {
      clearTimeout(limit)
      await recorder.stop().catch(() => {})
      await fs.rm(raw, { force: true })
      if (e instanceof StepError) throw createError({ statusCode: 422, message: `${e.message.replace(/\.?$/, '.')} Nothing was saved; adjust the steps (try them with shot first) and record again.`, data: { step: e.index + 1 } })
      throw e
    }
    clearTimeout(limit)
    await recorder.stop()

    // The clip: constant frame rate, at most 1440 wide, every frame a keyframe (exact seeking), no audio.
    const base = slugify(opts.name || new URL(url).pathname.replace(/\/$/, '') || 'flow').slice(0, 40) || 'flow'
    const name = `${base}-${randomBytes(2).toString('hex')}`
    const mp4 = join(clipsDir(pid), `${name}.mp4`)
    try {
      // Tagged BT.709 so Chrome shows the app's real colours (untagged video drifts, #3b82f6 came out #4683f5).
      await runFfmpeg(['-i', raw, '-vf', `fps=${fps},scale='min(${MAX_WIDTH},iw)':-2:flags=lanczos:out_color_matrix=bt709:out_range=tv,format=yuv420p`, '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-g', '1', '-keyint_min', '1', '-bf', '0', '-movflags', '+faststart', '-an', mp4])
      await runFfmpeg(['-i', mp4, '-frames:v', '1', '-q:v', '3', join(clipsDir(pid), `${name}.jpg`)])
    } finally {
      await fs.rm(raw, { force: true })
    }
    const frames = await countFrames(mp4)
    const outWidth = Math.min(MAX_WIDTH, width)
    const rec: Recording = {
      name,
      path: `assets/recordings/${name}.mp4`,
      url: `/api/projects/${pid}/files/assets/recordings/${name}.mp4`,
      poster: `assets/recordings/${name}.jpg`,
      posterUrl: `/api/projects/${pid}/files/assets/recordings/${name}.jpg`,
      width: outWidth,
      height: Math.round(height * outWidth / width / 2) * 2,
      fps,
      duration: Math.round(frames / fps * 1000),
      frames,
      bytes: (await fs.stat(mp4)).size,
      page: page.url(),
      markers,
      at: new Date().toISOString()
    }
    await fs.writeFile(join(clipsDir(pid), `${name}.json`), JSON.stringify(rec, null, 2))
    return rec
  })
}

export async function listRecordings(pid: string): Promise<Recording[]> {
  const dir = clipsDir(pid)
  const names = (await fs.readdir(dir).catch(() => [] as string[])).filter(n => n.endsWith('.json'))
  const out = await Promise.all(names.map(async n => JSON.parse(await fs.readFile(join(dir, n), 'utf8').catch(() => 'null'))))
  return out.filter(Boolean).sort((a, b) => b.at.localeCompare(a.at))
}

export async function removeRecording(pid: string, name: string) {
  if (!/^[\w-]+$/.test(name)) throw createError({ statusCode: 404 })
  for (const ext of ['mp4', 'jpg', 'json']) await fs.rm(join(clipsDir(pid), `${name}.${ext}`), { force: true })
  return listRecordings(pid)
}
