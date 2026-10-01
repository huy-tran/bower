import { promises as fs } from 'node:fs'
import { resolve } from 'node:path'
import { STORAGE } from './paths'
import { listProjects, loadProject, normalizeFolder, saveProject } from './store'

// Folders are virtual: a project carries its folder path, and this registry remembers folders that are
// currently empty. Nothing moves on disk, so export, import and the trash are unaffected.
const FILE = resolve(STORAGE, '..', 'folders.json')

async function readRegistry(): Promise<string[]> {
  try { return (JSON.parse(await fs.readFile(FILE, 'utf8')).folders ?? []).map(normalizeFolder).filter(Boolean) } catch { return [] }
}
async function writeRegistry(folders: string[]) {
  await fs.mkdir(resolve(FILE, '..'), { recursive: true })
  await fs.writeFile(FILE, JSON.stringify({ folders: [...new Set(folders)].sort() }, null, 2))
}

// Every folder in use: the registry, each project's folder, and all their ancestors.
export async function listFolders() {
  const all = new Set<string>()
  const add = (path: string) => {
    const parts = path.split('/')
    for (let i = 1; i <= parts.length; i++) all.add(parts.slice(0, i).join('/'))
  }
  for (const f of await readRegistry()) add(f)
  for (const p of await listProjects()) if (p.folder) add(p.folder)
  return [...all].sort((a, b) => a.localeCompare(b))
}

const under = (path: string, prefix: string) => path === prefix || path.startsWith(prefix + '/')
const rebase = (path: string, from: string, to: string) => to + path.slice(from.length)

export async function createFolder(path: string) {
  const f = normalizeFolder(path)
  if (!f) throw createError({ statusCode: 422, message: 'Folder name is required' })
  await writeRegistry([...await readRegistry(), f])
  return listFolders()
}

// Rename the last segment; everything filed beneath follows.
export async function renameFolder(path: string, name: string) {
  const from = normalizeFolder(path)
  const seg = normalizeFolder(name)
  if (!from) throw createError({ statusCode: 404, message: 'Folder not found' })
  if (!seg || seg.includes('/')) throw createError({ statusCode: 422, message: 'Folder name is required and cannot contain /' })
  const parent = from.includes('/') ? from.slice(0, from.lastIndexOf('/')) : ''
  const to = parent ? `${parent}/${seg}` : seg
  if (to === from) return listFolders()
  if ((await listFolders()).some(f => under(f, to))) throw createError({ statusCode: 409, message: `A folder called "${seg}" already exists there` })
  await writeRegistry((await readRegistry()).map(f => under(f, from) ? rebase(f, from, to) : f).concat(to))
  for (const { id, folder } of await listProjects()) {
    if (!under(folder, from)) continue
    const p = await loadProject(id)
    p.folder = rebase(folder, from, to)
    await saveProject(p)
  }
  return listFolders()
}

// Delete a folder: whatever it held (projects and subfolders) moves up to its parent.
export async function deleteFolder(path: string) {
  const target = normalizeFolder(path)
  if (!target) throw createError({ statusCode: 404, message: 'Folder not found' })
  const parent = target.includes('/') ? target.slice(0, target.lastIndexOf('/')) : ''
  const lift = (f: string) => f === target ? parent : normalizeFolder(parent + f.slice(target.length))
  await writeRegistry((await readRegistry()).filter(f => f !== target).map(f => under(f, target) ? lift(f) : f).filter(Boolean))
  for (const { id, folder } of await listProjects()) {
    if (!under(folder, target)) continue
    const p = await loadProject(id)
    p.folder = lift(folder)
    await saveProject(p)
  }
  return listFolders()
}
