import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { PNG } from 'pngjs'
import { withBrowser } from './browser'
import { loadProject, projectDir, sceneViews, type SceneView } from './store'

// Frame snapshots (for Claude to look at its own work) and the seam checker (how much the picture jumps at a cut).
// Chrome only paints the foreground tab, so all capture work goes through one queue on one page at a time.
let queue: Promise<unknown> = Promise.resolve()
function serial<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(fn, fn)
  queue = run.catch(() => {})
  return run
}

async function capture(origin: string, pid: string, shots: { scene: SceneView, t: number }[], width: number, height: number) {
  return serial(() => withBrowser(async (b) => {
    const page = await b.newPage()
    try {
      await page.setViewport({ width, height, deviceScaleFactor: 1 })
      const out: Buffer[] = []
      let loaded = ''
      for (const s of shots) {
        const url = `${origin}/api/projects/${pid}/scenes/${s.scene.id}/frame?v=${Math.round(s.scene.mtime)}`
        if (loaded !== url) {
          await page.goto(url, { waitUntil: 'networkidle0', timeout: 60_000 })
          loaded = url
        }
        await page.evaluate(t => (window as any).__seek(t), s.t)
        out.push(Buffer.from(await page.screenshot({ type: 'png' })))
      }
      return out
    } finally {
      await page.close().catch(() => {})
    }
  }))
}

const size = (w: number, h: number, target: number) => ({ width: target, height: Math.round(target * h / w / 2) * 2 })

export async function snapScene(origin: string, pid: string, sid: string, times?: number[]) {
  const p = await loadProject(pid)
  const s = (await sceneViews(p)).find(x => x.id === sid)
  if (!s) throw createError({ statusCode: 404, message: 'Scene not found' })
  const frame = 1000 / (p.fps || 30)
  const ts = (times?.length ? times : [0, 0.25, 0.5, 0.75, 1].map(f => f * s.duration))
    .map(t => Math.round(Math.min(Math.max(0, t), s.duration - frame)))
    .slice(0, 12)
  const { width, height } = size(p.width, p.height, p.width >= p.height ? 960 : 540)
  const bufs = await capture(origin, pid, ts.map(t => ({ scene: s, t })), width, height)
  const dir = join(projectDir(pid), 'snapshots', sid)
  await fs.rm(dir, { recursive: true, force: true })
  await fs.mkdir(dir, { recursive: true })
  return Promise.all(bufs.map(async (buf, i) => {
    const name = `${String(ts[i]).padStart(5, '0')}ms.png`
    await fs.writeFile(join(dir, name), buf)
    return { t: ts[i]!, path: `snapshots/${sid}/${name}`, url: `/api/projects/${pid}/files/snapshots/${sid}/${name}` }
  }))
}

export interface Seam {
  from: string
  to: string
  fromTitle: string
  toTitle: string
  diff: number
  path: string
  url: string
  transition: { type: string, duration: number } | null
}

const seamCache = new Map<string, Seam>()

// Percentage of pixels that visibly change across each cut, plus a side-by-side image: last frame | first frame | difference.
export async function checkSeams(origin: string, pid: string, sceneId?: string): Promise<Seam[]> {
  const p = await loadProject(pid)
  const views = await sceneViews(p)
  const frame = 1000 / (p.fps || 30)
  const { width, height } = size(p.width, p.height, p.width >= p.height ? 480 : 270)
  const pairs = views.slice(1).map((b, i) => [views[i]!, b] as const)
    .filter(([a, b]) => !sceneId || a.id === sceneId || b.id === sceneId)

  const out: Seam[] = []
  // A cached result only counts if its comparison image is still on disk.
  const cached = async (a: SceneView, b: SceneView) => {
    const hit = seamCache.get(`${pid}:${a.id}:${a.mtime}:${a.duration}:${b.id}:${b.mtime}:${b.transition?.type ?? ''}`)
    return !!hit && !!(await fs.stat(join(projectDir(pid), hit.path)).catch(() => null))
  }
  const hits = await Promise.all(pairs.map(([a, b]) => cached(a, b)))
  const todo = pairs.filter((_, i) => !hits[i])
  const shots = await capture(origin, pid, todo.flatMap(([a, b]) => [{ scene: a, t: Math.max(0, a.duration - frame) }, { scene: b, t: 0 }]), width, height)
  const dir = join(projectDir(pid), 'snapshots', 'seams')
  await fs.mkdir(dir, { recursive: true })

  for (let i = 0; i < todo.length; i++) {
    const [a, b] = todo[i]!
    const A = PNG.sync.read(shots[i * 2]!), B = PNG.sync.read(shots[i * 2 + 1]!)
    const D = new PNG({ width: width * 3 + 8, height })
    D.data.fill(255)
    let changed = 0
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const k = (y * width + x) * 4
        const delta = Math.max(Math.abs(A.data[k]! - B.data[k]!), Math.abs(A.data[k + 1]! - B.data[k + 1]!), Math.abs(A.data[k + 2]! - B.data[k + 2]!))
        if (delta > 24) changed++
        const put = (ox: number, r: number, g: number, bl: number) => {
          const o = (y * D.width + ox + x) * 4
          D.data[o] = r; D.data[o + 1] = g; D.data[o + 2] = bl; D.data[o + 3] = 255
        }
        put(0, A.data[k]!, A.data[k + 1]!, A.data[k + 2]!)
        put(width + 4, B.data[k]!, B.data[k + 1]!, B.data[k + 2]!)
        const grey = 255 - Math.round((255 - (A.data[k]! + B.data[k]!) / 2) * 0.15)
        if (delta > 24) put(width * 2 + 8, 235, 64, 52)
        else put(width * 2 + 8, grey, grey, grey)
      }
    }
    const name = `${a.id}__${b.id}.png`
    await fs.writeFile(join(dir, name), PNG.sync.write(D))
    seamCache.set(`${pid}:${a.id}:${a.mtime}:${a.duration}:${b.id}:${b.mtime}:${b.transition?.type ?? ''}`, {
      from: a.id, to: b.id, fromTitle: a.title, toTitle: b.title,
      diff: Math.round(changed / (width * height) * 10000) / 100,
      path: `snapshots/seams/${name}`,
      url: `/api/projects/${pid}/files/snapshots/seams/${name}?v=${Math.round(Math.max(a.mtime, b.mtime))}`,
      transition: b.transition
    })
  }
  for (const [a, b] of pairs) {
    const s = seamCache.get(`${pid}:${a.id}:${a.mtime}:${a.duration}:${b.id}:${b.mtime}:${b.transition?.type ?? ''}`)
    if (s) out.push({ ...s, fromTitle: a.title, toTitle: b.title })
  }
  return out
}
