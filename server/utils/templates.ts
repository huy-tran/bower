import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { TEMPLATES } from './paths'
import { snapScene } from './snapshots'
import { addVersion, assertId, loadProject, newSceneId, projectDir, projectView, readScene, sceneMeta, sceneViews, slugify, writeScene } from './store'

// Reusable scenes shared across projects: lower thirds, title cards, feature callouts, end cards.
// Each lives in storage/templates/<id>/ with its HTML, a thumbnail and a little metadata.
export interface SceneTemplate {
  id: string
  name: string
  description: string
  width: number
  height: number
  duration: number
  from: { project: string, scene: string }
  createdAt: string
}

const dir = (id: string) => join(TEMPLATES, assertId(id))
const metaFile = (id: string) => join(dir(id), 'template.json')
export const templateThumb = (id: string) => join(dir(id), 'thumb.png')

async function readJson<T>(file: string, fallback: T): Promise<T> {
  try { return JSON.parse(await fs.readFile(file, 'utf8')) } catch { return fallback }
}

export async function listTemplates(): Promise<SceneTemplate[]> {
  const names = await fs.readdir(TEMPLATES).catch(() => [] as string[])
  const out: SceneTemplate[] = []
  for (const n of names) {
    const t = await readJson<SceneTemplate | null>(join(TEMPLATES, n, 'template.json'), null)
    if (t) out.push(t)
  }
  return out.sort((a, b) => a.name.localeCompare(b.name))
}

export async function loadTemplate(id: string) {
  const t = await readJson<SceneTemplate | null>(metaFile(id), null)
  if (!t) throw createError({ statusCode: 404, message: 'Template not found' })
  return t
}

// Save a project scene as a template, with a thumbnail rendered by the editor.
export async function saveTemplate(origin: string, pid: string, sid: string, name: string, description = '') {
  const p = await loadProject(pid)
  const s = (await sceneViews(p)).find(x => x.id === sid)
  if (!s) throw createError({ statusCode: 404, message: 'Scene not found' })
  const clean = name.trim().slice(0, 80)
  if (!clean) throw createError({ statusCode: 422, message: 'Give the template a name' })
  const html = await readScene(pid, sid)
  let id = slugify(clean).slice(0, 40) || 'template'
  while (await fs.stat(dir(id)).catch(() => null)) id = `${slugify(clean).slice(0, 40)}-${randomBytes(2).toString('hex')}`
  await fs.mkdir(dir(id), { recursive: true })
  await fs.writeFile(join(dir(id), 'scene.html'), html)
  const t: SceneTemplate = {
    id, name: clean, description: description.trim().slice(0, 500), width: p.width, height: p.height, duration: sceneMeta(html).duration,
    from: { project: p.name, scene: s.title }, createdAt: new Date().toISOString()
  }
  await fs.writeFile(metaFile(id), JSON.stringify(t, null, 2))
  // Thumbnail: a frame from a little way in, where the scene has usually arrived.
  try {
    const [shot] = await snapScene(origin, pid, sid, [Math.round(s.duration * 0.4)])
    if (shot) await fs.copyFile(join(projectDir(pid), shot.path), templateThumb(id))
  } catch {}
  return t
}

export async function removeTemplate(id: string) {
  await fs.rm(dir(id), { recursive: true, force: true })
  return listTemplates()
}

// Insert a template into a project as a new scene. The HTML is copied as is; the caller may ask Claude to
// adapt it when the stage size or brand differ.
export async function insertTemplate(pid: string, id: string, afterId?: string) {
  const t = await loadTemplate(id)
  const html = await fs.readFile(join(dir(id), 'scene.html'), 'utf8')
  const p = await loadProject(pid)
  const sid = newSceneId(t.name)
  await writeScene(pid, sid, html)
  await addVersion(pid, sid, html, `From template ${t.name}`)
  const i = afterId ? p.scenes.findIndex(s => s.id === afterId) : -1
  p.scenes.splice(i >= 0 ? i + 1 : p.scenes.length, 0, { id: sid, title: t.name })
  await (await import('./store')).saveProject(p)
  const sizeDiffers = t.width !== p.width || t.height !== p.height
  return { id: sid, template: t, sizeDiffers, project: await projectView(pid) }
}
