import { promises as fs, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { randomBytes } from 'node:crypto'
import { writeClaudeMd } from './claudeMd'

export const STORAGE = resolve(process.env.STORYBOARD_STORAGE || 'storage/projects')

export interface AudioInfo {
  file: string
  name: string
  duration?: number
  bpm?: number
  startOffset: number
  beats: number[]
  downbeats: number[]
  phrases: number[]
  peaks?: number[]
}

export interface Project {
  id: string
  name: string
  artDirection: string
  width: number
  height: number
  fps: number
  scenes: { id: string, title: string }[]
  audio: AudioInfo | null
  createdAt: string
}

export interface SceneView {
  id: string
  title: string
  file: string
  path: string
  duration: number
  start: number
  mtime: number
}

export interface Version { n: number, at: string, label: string }
export interface VersionIndex { current: number, items: Version[] }

export interface ChatMessage { role: 'user' | 'assistant' | 'error', text: string, at: string, durationMs?: number, costUsd?: number }
export interface Chat { sessionId: string | null, messages: ChatMessage[] }

const ID = /^[a-z0-9][a-z0-9-]{0,80}$/

export function assertId(id: string | undefined): string {
  if (!id || !ID.test(id)) throw createError({ statusCode: 400, message: `Invalid id: ${id}` })
  return id
}

export function slugify(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'untitled'
}

export const projectDir = (pid: string) => join(STORAGE, assertId(pid))
export const sceneFile = (pid: string, sid: string) => join(projectDir(pid), 'scenes', `${assertId(sid)}.html`)
const metaDir = (pid: string) => join(projectDir(pid), '.storyboard')

async function readJson<T>(file: string, fallback: T): Promise<T> {
  try { return JSON.parse(await fs.readFile(file, 'utf8')) } catch { return fallback }
}

async function writeJson(file: string, data: unknown) {
  await fs.mkdir(join(file, '..'), { recursive: true })
  await fs.writeFile(file, JSON.stringify(data, null, 2))
}

export async function listProjects() {
  await fs.mkdir(STORAGE, { recursive: true })
  const dirs = await fs.readdir(STORAGE, { withFileTypes: true })
  const out: { id: string, name: string, createdAt: string }[] = []
  for (const d of dirs) {
    if (!d.isDirectory() || !ID.test(d.name)) continue
    const p = await readJson<Project | null>(join(STORAGE, d.name, 'project.json'), null)
    if (p) out.push({ id: p.id, name: p.name, createdAt: p.createdAt })
  }
  return out.sort((a, b) => a.createdAt.localeCompare(b.createdAt))
}

export async function loadProject(pid: string): Promise<Project> {
  const p = await readJson<Project | null>(join(projectDir(pid), 'project.json'), null)
  if (!p) throw createError({ statusCode: 404, message: 'Project not found' })
  return { width: 1920, height: 1080, fps: 30, artDirection: '', audio: null, ...p, id: pid }
}

export async function saveProject(p: Project) {
  await writeJson(join(projectDir(p.id), 'project.json'), p)
  await writeClaudeMd(p)
}

// Scene duration lives in the scene file's <script type="application/json" id="meta"> block.
const META_RE = /<script[^>]*id=["']meta["'][^>]*>([\s\S]*?)<\/script>/i

export function sceneMeta(html: string): { duration: number } {
  const m = html.match(META_RE)
  try {
    const d = m ? JSON.parse(m[1]!) : {}
    return { duration: Math.max(100, Number(d.duration) || 3000) }
  } catch {
    return { duration: 3000 }
  }
}

export function withDuration(html: string, duration: number) {
  const meta = `<script type="application/json" id="meta">${JSON.stringify({ duration: Math.round(duration) })}</script>`
  return META_RE.test(html) ? html.replace(META_RE, meta) : `${meta}\n${html}`
}

export async function readScene(pid: string, sid: string) {
  try { return await fs.readFile(sceneFile(pid, sid), 'utf8') } catch { throw createError({ statusCode: 404, message: 'Scene not found' }) }
}

export async function writeScene(pid: string, sid: string, html: string) {
  await fs.mkdir(join(projectDir(pid), 'scenes'), { recursive: true })
  await fs.writeFile(sceneFile(pid, sid), html)
}

export async function sceneViews(p: Project): Promise<SceneView[]> {
  let start = 0
  const out: SceneView[] = []
  for (const s of p.scenes) {
    const path = sceneFile(p.id, s.id)
    let duration = 3000, mtime = 0
    try {
      const [html, stat] = await Promise.all([fs.readFile(path, 'utf8'), fs.stat(path)])
      duration = sceneMeta(html).duration
      mtime = stat.mtimeMs
    } catch {}
    out.push({ id: s.id, title: s.title, file: `scenes/${s.id}.html`, path, duration, start, mtime })
    start += duration
  }
  return out
}

export async function projectView(pid: string) {
  const p = await loadProject(pid)
  const scenes = await sceneViews(p)
  const versions = Object.fromEntries(await Promise.all(scenes.map(async s => [s.id, (await getVersions(pid, s.id)).items.length])))
  return { ...p, path: projectDir(pid), scenes, versions, duration: scenes.reduce((a, s) => a + s.duration, 0) }
}

export function newSceneId(title: string) {
  return `${slugify(title).slice(0, 30)}-${randomBytes(2).toString('hex')}`
}

export function blankScene(title: string, duration = 3000) {
  return `<script type="application/json" id="meta">{"duration": ${duration}}</script>
<style>
  .headline {
    position: absolute; inset: 0; display: grid; place-items: center;
    font: 700 132px/1 Inter, system-ui, sans-serif; letter-spacing: -0.05em; color: #0a0a0a;
  }
</style>
<div class="headline">${title.replace(/</g, '&lt;')}</div>
<script>
  const headline = VE.$('.headline')

  VE.scene({
    render(t) {
      const p = VE.progress(t, 150, 700, 'outExpo')
      headline.style.opacity = p
      headline.style.transform = \`translateY(\${(1 - p) * 40}px)\`
    }
  })
</script>
`
}

export async function createProject(name: string, scenes?: { title: string, html: string }[]) {
  let id = slugify(name)
  while (existsSync(join(STORAGE, id))) id = `${slugify(name)}-${randomBytes(2).toString('hex')}`
  const p: Project = {
    id, name, artDirection: '', width: 1920, height: 1080, fps: 30, scenes: [], audio: null, createdAt: new Date().toISOString()
  }
  for (const s of scenes ?? [{ title: 'Intro', html: blankScene(name) }]) {
    const sid = newSceneId(s.title)
    p.scenes.push({ id: sid, title: s.title })
    await fs.mkdir(join(STORAGE, id, 'scenes'), { recursive: true })
    await fs.writeFile(join(STORAGE, id, 'scenes', `${sid}.html`), s.html)
    await addVersion(id, sid, s.html, 'Created')
  }
  await saveProject(p)
  return p
}

// Versions: every change to a scene file is snapshotted so it can be undone or restored.
const versionIndexFile = (pid: string, sid: string) => join(metaDir(pid), 'versions', assertId(sid), 'index.json')
const versionFile = (pid: string, sid: string, n: number) => join(metaDir(pid), 'versions', assertId(sid), `${n}.html`)

export async function getVersions(pid: string, sid: string): Promise<VersionIndex> {
  return readJson(versionIndexFile(pid, sid), { current: 0, items: [] })
}

export async function addVersion(pid: string, sid: string, html: string, label: string) {
  const idx = await getVersions(pid, sid)
  const n = (idx.items.at(-1)?.n ?? 0) + 1
  await fs.mkdir(join(metaDir(pid), 'versions', sid), { recursive: true })
  await fs.writeFile(versionFile(pid, sid, n), html)
  idx.items.push({ n, at: new Date().toISOString(), label: label.slice(0, 140) })
  idx.current = n
  await writeJson(versionIndexFile(pid, sid), idx)
  return idx
}

export async function restoreVersion(pid: string, sid: string, n: number) {
  const idx = await getVersions(pid, sid)
  if (!idx.items.some(v => v.n === n)) throw createError({ statusCode: 404, message: 'Version not found' })
  await writeScene(pid, sid, await fs.readFile(versionFile(pid, sid, n), 'utf8'))
  idx.current = n
  await writeJson(versionIndexFile(pid, sid), idx)
  return idx
}

export async function removeSceneData(pid: string, sid: string) {
  await fs.rm(sceneFile(pid, sid), { force: true })
  await fs.rm(join(metaDir(pid), 'versions', sid), { recursive: true, force: true })
  await fs.rm(chatFile(pid, sid), { force: true })
}

// Chats: 'project' is the whole-project thread, anything else is a scene id.
const chatFile = (pid: string, key: string) => join(metaDir(pid), 'chats', `${assertId(key)}.json`)

export async function getChat(pid: string, key: string): Promise<Chat> {
  return readJson(chatFile(pid, key), { sessionId: null, messages: [] })
}

export async function saveChat(pid: string, key: string, chat: Chat) {
  await writeJson(chatFile(pid, key), chat)
}

// Music timing relative to the video (track time minus the start offset).
export function videoBeats(p: Project) {
  const a = p.audio
  if (!a) return null
  const shift = (l: number[]) => l.map(t => t - (a.startOffset || 0)).filter(t => t >= 0)
  return { bpm: a.bpm ?? null, beats: shift(a.beats), downbeats: shift(a.downbeats), phrases: shift(a.phrases) }
}

export function sceneBeats(p: Project, start: number, duration: number) {
  const vb = videoBeats(p)
  const within = (l: number[]) => l.filter(t => t >= start && t <= start + duration).map(t => Math.round(t - start))
  return {
    bpm: vb?.bpm ?? null,
    beats: vb ? within(vb.beats) : [],
    downbeats: vb ? within(vb.downbeats) : [],
    phrases: vb ? within(vb.phrases) : []
  }
}
