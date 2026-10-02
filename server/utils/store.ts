import { promises as fs, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { randomBytes } from 'node:crypto'
import { writeClaudeMd } from './claudeMd'

import { getApp, migrateLegacyApp } from './apps'
import { STORAGE } from './paths'
import { readSettings } from './settings'

export interface Section { start: number, end: number, label: string, energy: number }

export interface AudioInfo {
  file: string
  name: string
  duration?: number
  bpm?: number
  startOffset: number
  beats: number[]
  downbeats: number[]
  phrases: number[]
  sections?: Section[]
  peaks?: number[]
  gain?: number
  fadeIn?: number
  fadeOut?: number
  // Music level (0..1) while a voice-over clip plays.
  duck?: number
}

// A sound effect or voice-over placed on the video timeline (start is video ms).
export interface Clip {
  id: string
  kind: 'sfx' | 'voice'
  file: string
  name: string
  start: number
  duration: number
  gain: number
  captions?: Caption[] | null
  // Set on voice clips generated from a scene's script: the clip follows that scene and is replaced when the script changes.
  sceneId?: string | null
  // `spoken` is the text after pronunciation fixes, which is what the audio actually says.
  source?: { text: string, voice: string, speed: number, spoken?: string } | null
}

export interface CaptionSettings { burnIn: boolean, position: 'bottom' | 'top', size: number }

// A scene's voice-over script, from the "voice" key of its meta block. The editor generates the speech.
export interface SceneVoice { text: string, voice?: string, speed?: number }
// `shortlist`: the voices the user picked while auditioning; shown first in the editor and suggested to Claude.
// `pronunciations`: words the voice gets wrong and how to say them ("GIF" -> "jif").
export interface Pronunciation { term: string, sayAs: string }
export interface Narrator { voice: string, speed: number, shortlist: string[], pronunciations: Pronunciation[] }
export const DEFAULT_NARRATOR: Narrator = { voice: 'af_heart', speed: 1, shortlist: [], pronunciations: [] }

export interface Project {
  id: string
  name: string
  artDirection: string
  width: number
  height: number
  fps: number
  scenes: { id: string, title: string, transition?: Transition | null }[]
  audio: AudioInfo | null
  clips: Clip[]
  captions: CaptionSettings
  brandKitId: string | null
  visualChecks: boolean
  // Local code repositories Claude may read (via `claude --add-dir`) to base scenes on the real product: this
  // project's own. Machine-specific, so they are not exported.
  codebases: Codebase[]
  // The running product, a shared app (apps.ts) filled in when the project loads; on disk only `appId` and
  // `appMode` are kept. Its repositories come along as `appCodebases` (read-only here, edited on the app).
  app: ProductApp | null
  appCodebases: Codebase[]
  narrator: Narrator
  // Virtual folder the project is filed under, like "Clients/Acme" ('' = top level). Storage on disk stays flat.
  folder: string
  createdAt: string
}

// "Clients / Acme /" -> "Clients/Acme". Segments are trimmed and capped; slashes inside a name are not allowed.
export function normalizeFolder(v: unknown) {
  return String(v ?? '').split('/').map(s => s.trim().replace(/\\/g, '').slice(0, 60)).filter(Boolean).join('/')
}

// A local repository Claude may read (via `claude --add-dir`), e.g. { label: 'API', path: 'C:\\Users\\me\\Herd\\acme-api' }.
export interface Codebase { label: string, path: string, notes: string }
// How Claude shows the app in scenes: real screenshots placed as images, screens rebuilt in HTML, or its own call.
// Projects that linked an app before this setting existed have no mode, which means "auto".
export type AppMode = 'shots' | 'rebuild' | 'auto'
export const APP_MODES: AppMode[] = ['shots', 'rebuild', 'auto']
export interface ProductApp { id: string, name: string, url: string, notes: string, mode: AppMode }

// Every repository Claude may read for this project: the app's, then the project's own.
export function allCodebases(p: Project) {
  const seen = new Set<string>()
  return [...p.appCodebases, ...p.codebases].filter(c => !seen.has(c.path.toLowerCase()) && seen.add(c.path.toLowerCase()))
}

export interface SceneView {
  id: string
  title: string
  file: string
  path: string
  duration: number
  start: number
  mtime: number
  transition: Transition | null
  voice: SceneVoice | null
  // What the scene should show, from the storyboard ("brief" in the meta block).
  brief: string
  // This scene's override of the project's app mode ("app" in the meta block), or null for the project default.
  app: AppMode | null
}

export interface Version { n: number, at: string, label: string }
export interface VersionIndex { current: number, items: Version[] }

export interface ChatMessage {
  role: 'user' | 'assistant' | 'error'
  text: string
  at: string
  durationMs?: number
  costUsd?: number
  attachments?: string[]
  model?: string
}
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
const metaDir = (pid: string) => join(projectDir(pid), '.bower')

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
  const out: { id: string, name: string, folder: string, createdAt: string }[] = []
  for (const d of dirs) {
    if (!d.isDirectory() || !ID.test(d.name)) continue
    const p = await readJson<Project | null>(join(STORAGE, d.name, 'project.json'), null)
    if (p) out.push({ id: p.id, name: p.name, folder: normalizeFolder(p.folder), createdAt: p.createdAt })
  }
  return out.sort((a, b) => a.createdAt.localeCompare(b.createdAt))
}

export async function loadProject(pid: string): Promise<Project> {
  let p = await readJson<any>(join(projectDir(pid), 'project.json'), null)
  if (!p) throw createError({ statusCode: 404, message: 'Project not found' })
  // A project from before shared apps: link it to one first (see apps.ts).
  if (!p.appId && p.app?.url && await migrateLegacyApp(pid, p)) p = await readJson<any>(join(projectDir(pid), 'project.json'), p)
  const shared = p.appId ? await getApp(p.appId) : null
  const app: ProductApp | null = shared ? { id: shared.id, name: shared.name, url: shared.url, notes: shared.notes, mode: APP_MODES.includes(p.appMode) ? p.appMode : 'auto' } : null
  delete p.appId
  delete p.appMode
  return {
    width: 1920, height: 1080, fps: 30, artDirection: '', audio: null, clips: [], brandKitId: null, visualChecks: true,
    ...p,
    app,
    appCodebases: shared?.codebases ?? [],
    // Projects saved before multi-repo support had a single `codebase`.
    codebases: Array.isArray(p.codebases) ? p.codebases : (p as any).codebase?.path ? [{ label: 'Codebase', notes: '', ...(p as any).codebase }] : [],
    folder: normalizeFolder(p.folder),
    narrator: { ...DEFAULT_NARRATOR, ...p.narrator },
    captions: { burnIn: false, position: 'bottom', size: 44, ...p.captions },
    id: pid
  }
}

export async function saveProject(p: Project) {
  await syncVoiceClips(p)
  // The shared app is stored by reference: its id and how this project shows it.
  const { app, appCodebases, ...rest } = p
  await writeJson(join(projectDir(p.id), 'project.json'), { ...rest, appId: app?.id ?? null, appMode: app?.mode ?? null })
  await writeClaudeMd(p)
}

// Generated voice clips follow their scene: they start where the scene starts and go when the scene or its script goes.
// (A clip whose script has since changed stays until the editor regenerates it.)
async function syncVoiceClips(p: Project) {
  if (!p.clips.some(c => c.sceneId)) return
  const views = await sceneViews(p)
  const keep: Clip[] = []
  for (const c of p.clips) {
    if (!c.sceneId) { keep.push(c); continue }
    const s = views.find(v => v.id === c.sceneId)
    if (!s?.voice) {
      await fs.rm(join(projectDir(p.id), 'audio', c.file), { force: true }).catch(() => {})
      continue
    }
    keep.push(c.start === s.start ? c : { ...c, start: s.start })
  }
  p.clips = keep
}

// Scene duration (and the optional voice-over script) live in the scene file's <script type="application/json" id="meta"> block.
const META_RE = /<script[^>]*id=["']meta["'][^>]*>([\s\S]*?)<\/script>/i
// Must match VOICES in app/utils/speech.ts.
export const VOICE_IDS = ['af_heart', 'af_sarah', 'bm_fable']
const VOICE_ID = { test: (v: string) => VOICE_IDS.includes(v) }

function parseVoice(v: unknown): SceneVoice | null {
  const o = typeof v === 'string' ? { text: v } : v && typeof v === 'object' ? v as Record<string, unknown> : null
  const text = String(o?.text ?? '').replace(/\s+/g, ' ').trim().slice(0, 2000)
  if (!text) return null
  const out: SceneVoice = { text }
  if (typeof o!.voice === 'string' && VOICE_ID.test(o!.voice)) out.voice = o!.voice
  const speed = Number(o!.speed)
  if (Number.isFinite(speed) && speed > 0) out.speed = Math.min(1.3, Math.max(0.7, Math.round(speed * 100) / 100))
  return out
}

export function sceneMeta(html: string): { duration: number, voice: SceneVoice | null, brief: string, app: AppMode | null } {
  const m = html.match(META_RE)
  try {
    const d = m ? JSON.parse(m[1]!) : {}
    const app = APP_MODES.includes(d.app) ? d.app as AppMode : null
    return { duration: Math.max(100, Number(d.duration) || 3000), voice: parseVoice(d.voice), brief: String(d.brief ?? '').trim().slice(0, 1000), app }
  } catch {
    return { duration: 3000, voice: null, brief: '', app: null }
  }
}

// Sets keys in the meta block, keeping the others; a null value removes the key.
export function withMeta(html: string, patch: Record<string, unknown>) {
  const m = html.match(META_RE)
  let rest: Record<string, unknown> = {}
  try { rest = m ? JSON.parse(m[1]!) : {} } catch {}
  const next = { ...rest, ...patch }
  for (const k of Object.keys(next)) if (next[k] === null || next[k] === undefined) delete next[k]
  const meta = `<script type="application/json" id="meta">${JSON.stringify(next)}</script>`
  return m ? html.replace(META_RE, meta) : `${meta}\n${html}`
}

export function withDuration(html: string, duration: number) {
  return withMeta(html, { duration: Math.round(duration) })
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
    let duration = 3000, mtime = 0, voice: SceneVoice | null = null, brief = '', app: AppMode | null = null
    try {
      const [html, stat] = await Promise.all([fs.readFile(path, 'utf8'), fs.stat(path)])
      ;({ duration, voice, brief, app } = sceneMeta(html))
      mtime = stat.mtimeMs
    } catch {}
    const transition = out.length && s.transition && s.transition.type !== 'cut' ? s.transition : null
    out.push({ id: s.id, title: s.title, file: `scenes/${s.id}.html`, path, duration, start, mtime, transition, voice, brief, app })
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

// A placeholder scene: the title, centred. `extra` adds keys to the meta block (a storyboard brief, a voice script).
export function blankScene(title: string, duration = 3000, extra: Record<string, unknown> = {}) {
  return `<script type="application/json" id="meta">${JSON.stringify({ duration, ...extra })}</script>
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

export async function createProject(name: string, scenes?: { title: string, html: string }[], size?: { width: number, height: number }, folder = '') {
  let id = slugify(name)
  while (existsSync(join(STORAGE, id))) id = `${slugify(name)}-${randomBytes(2).toString('hex')}`
  // New projects start from the defaults in Bower settings.
  const d = (await readSettings()).defaults
  const p: Project = {
    id, name, artDirection: '', width: size?.width ?? d.width, height: size?.height ?? d.height, fps: d.fps, scenes: [], audio: null,
    clips: [], captions: { burnIn: false, position: 'bottom', size: 44 }, brandKitId: null, visualChecks: d.visualChecks, codebases: [], app: null, appCodebases: [], narrator: { ...DEFAULT_NARRATOR, voice: d.voice },
    folder: normalizeFolder(folder), createdAt: new Date().toISOString()
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
  const shift = p.audio?.startOffset || 0
  const sections = (p.audio?.sections ?? [])
    .map(s => ({ ...s, start: s.start - shift, end: s.end - shift }))
    .filter(s => s.end > start && s.start < start + duration)
    .map(s => ({ label: s.label, energy: s.energy, start: Math.round(s.start - start), end: Math.round(s.end - start) }))
  return {
    bpm: vb?.bpm ?? null,
    beats: vb ? within(vb.beats) : [],
    downbeats: vb ? within(vb.downbeats) : [],
    phrases: vb ? within(vb.phrases) : [],
    sections
  }
}
