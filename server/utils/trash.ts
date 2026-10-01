import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { getVersions, loadProject, projectDir, saveProject, sceneFile, type Project } from './store'

// Deletes are soft: scenes move to <project>/.bower/trash, projects to storage/trash. Purged after 30 days.
import { PROJECT_TRASH, STORAGE } from './paths'
const KEEP_MS = 30 * 24 * 3600 * 1000

const sceneTrash = (pid: string) => join(projectDir(pid), '.bower', 'trash')

async function readJson<T>(file: string, fallback: T): Promise<T> {
  try { return JSON.parse(await fs.readFile(file, 'utf8')) } catch { return fallback }
}

const moveIfExists = async (from: string, to: string) => {
  try {
    await fs.mkdir(join(to, '..'), { recursive: true })
    await fs.rename(from, to)
  } catch {}
}

export interface TrashedScene { id: string, sceneId: string, title: string, index: number, deletedAt: string, versions: number }
export interface TrashedProject { id: string, projectId: string, name: string, deletedAt: string }

export async function trashScene(pid: string, sid: string) {
  const p = await loadProject(pid)
  const index = p.scenes.findIndex(s => s.id === sid)
  if (index < 0) throw createError({ statusCode: 404, message: 'Scene not found' })
  if (p.scenes.length <= 1) throw createError({ statusCode: 422, message: 'A project needs at least one scene' })
  const entry = p.scenes[index]!
  const id = `${Date.now()}-${sid}`
  const dir = join(sceneTrash(pid), id)
  await fs.mkdir(dir, { recursive: true })
  const meta: TrashedScene = { id, sceneId: sid, title: entry.title, index, deletedAt: new Date().toISOString(), versions: (await getVersions(pid, sid)).items.length }
  await fs.writeFile(join(dir, 'meta.json'), JSON.stringify({ ...meta, entry }, null, 2))
  await moveIfExists(sceneFile(pid, sid), join(dir, 'scene.html'))
  await moveIfExists(join(projectDir(pid), '.bower', 'versions', sid), join(dir, 'versions'))
  await moveIfExists(join(projectDir(pid), '.bower', 'chats', `${sid}.json`), join(dir, 'chat.json'))
  p.scenes.splice(index, 1)
  await saveProject(p)
}

export async function listTrashedScenes(pid: string): Promise<TrashedScene[]> {
  const out: TrashedScene[] = []
  for (const d of await fs.readdir(sceneTrash(pid)).catch(() => [])) {
    const m = await readJson<TrashedScene | null>(join(sceneTrash(pid), d, 'meta.json'), null)
    if (m) out.push({ id: m.id, sceneId: m.sceneId, title: m.title, index: m.index, deletedAt: m.deletedAt, versions: m.versions })
  }
  return out.sort((a, b) => b.deletedAt.localeCompare(a.deletedAt))
}

export async function restoreScene(pid: string, trashId: string) {
  const dir = join(sceneTrash(pid), assertTrashId(trashId))
  const m = await readJson<(TrashedScene & { entry: Project['scenes'][number] }) | null>(join(dir, 'meta.json'), null)
  if (!m) throw createError({ statusCode: 404, message: 'Not in the trash' })
  const p = await loadProject(pid)
  if (p.scenes.some(s => s.id === m.sceneId)) throw createError({ statusCode: 409, message: 'A scene with that id already exists' })
  await moveIfExists(join(dir, 'scene.html'), sceneFile(pid, m.sceneId))
  await moveIfExists(join(dir, 'versions'), join(projectDir(pid), '.bower', 'versions', m.sceneId))
  await moveIfExists(join(dir, 'chat.json'), join(projectDir(pid), '.bower', 'chats', `${m.sceneId}.json`))
  p.scenes.splice(Math.min(m.index, p.scenes.length), 0, m.entry)
  await saveProject(p)
  await fs.rm(dir, { recursive: true, force: true })
  return m.sceneId
}

export async function purgeScene(pid: string, trashId: string) {
  await fs.rm(join(sceneTrash(pid), assertTrashId(trashId)), { recursive: true, force: true })
}

export async function trashProject(pid: string) {
  const p = await loadProject(pid)
  const id = `${Date.now()}-${pid}`
  await fs.mkdir(PROJECT_TRASH, { recursive: true })
  await fs.rename(projectDir(pid), join(PROJECT_TRASH, id))
  await fs.writeFile(join(PROJECT_TRASH, id, '.trashed.json'), JSON.stringify({ id, projectId: pid, name: p.name, deletedAt: new Date().toISOString() }))
}

export async function listTrashedProjects(): Promise<TrashedProject[]> {
  const out: TrashedProject[] = []
  for (const d of await fs.readdir(PROJECT_TRASH).catch(() => [])) {
    const m = await readJson<TrashedProject | null>(join(PROJECT_TRASH, d, '.trashed.json'), null)
    if (m) out.push(m)
  }
  return out.sort((a, b) => b.deletedAt.localeCompare(a.deletedAt))
}

export async function restoreProject(trashId: string) {
  const dir = join(PROJECT_TRASH, assertTrashId(trashId))
  const m = await readJson<TrashedProject | null>(join(dir, '.trashed.json'), null)
  if (!m) throw createError({ statusCode: 404, message: 'Not in the trash' })
  let pid = m.projectId
  try { await fs.access(join(STORAGE, pid)); pid = `${pid}-restored-${Date.now().toString(36)}` } catch {}
  await fs.rm(join(dir, '.trashed.json'), { force: true })
  await fs.rename(dir, join(STORAGE, pid))
  if (pid !== m.projectId) {
    const p = await loadProject(pid)
    await saveProject({ ...p, id: pid })
  }
  return pid
}

export async function purgeProject(trashId: string) {
  await fs.rm(join(PROJECT_TRASH, assertTrashId(trashId)), { recursive: true, force: true })
}

function assertTrashId(id: string) {
  if (!/^\d+-[a-z0-9-]+$/.test(id)) throw createError({ statusCode: 400, message: 'Invalid trash id' })
  return id
}

// Called at startup: forget anything deleted more than 30 days ago.
export async function purgeOldTrash() {
  const cutoff = Date.now() - KEEP_MS
  const old = (name: string) => Number(name.split('-')[0]) < cutoff
  for (const d of await fs.readdir(PROJECT_TRASH).catch(() => [])) if (old(d)) await fs.rm(join(PROJECT_TRASH, d), { recursive: true, force: true })
  for (const pd of await fs.readdir(STORAGE).catch(() => [])) {
    const t = join(STORAGE, pd, '.bower', 'trash')
    for (const d of await fs.readdir(t).catch(() => [])) if (old(d)) await fs.rm(join(t, d), { recursive: true, force: true })
  }
}
