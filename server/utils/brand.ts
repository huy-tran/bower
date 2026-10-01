import { promises as fs } from 'node:fs'
import { extname, join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { assertId, listProjects, loadProject, projectDir, saveProject, slugify, type Project } from './store'

// Brand kits are shared across projects. A project using a kit gets a copy in its own brand/ folder,
// so Claude can Read the logos, scenes can load them, and exported projects carry them along.
import { BRAND_KITS } from './paths'

export interface BrandColor { name: string, hex: string }
export interface BrandFile { name: string, label: string }
export interface BrandKit {
  id: string
  name: string
  colors: BrandColor[]
  fonts: { heading: string, body: string }
  notes: string
  files: BrandFile[]
  updatedAt: string
}

const kitDir = (id: string) => join(BRAND_KITS, assertId(id))
const IMAGE_EXT = ['.png', '.jpg', '.jpeg', '.svg', '.webp', '.gif']

export async function listKits(): Promise<BrandKit[]> {
  const out: BrandKit[] = []
  for (const d of await fs.readdir(BRAND_KITS).catch(() => [])) {
    try { out.push(JSON.parse(await fs.readFile(join(BRAND_KITS, d, 'kit.json'), 'utf8'))) } catch {}
  }
  return out.sort((a, b) => a.name.localeCompare(b.name))
}

export async function loadKit(id: string): Promise<BrandKit> {
  try { return JSON.parse(await fs.readFile(join(kitDir(id), 'kit.json'), 'utf8')) } catch {
    throw createError({ statusCode: 404, message: 'Brand kit not found' })
  }
}

async function writeKit(k: BrandKit) {
  k.updatedAt = new Date().toISOString()
  await fs.mkdir(join(kitDir(k.id), 'files'), { recursive: true })
  await fs.writeFile(join(kitDir(k.id), 'kit.json'), JSON.stringify(k, null, 2))
  // Keep every project that uses this kit in step.
  for (const { id } of await listProjects()) {
    const p = await loadProject(id).catch(() => null)
    if (p?.brandKitId === k.id) await syncBrand(p)
  }
  return k
}

export async function createKit(name: string) {
  const id = `${slugify(name).slice(0, 30)}-${randomBytes(2).toString('hex')}`
  return writeKit({ id, name, colors: [], fonts: { heading: 'Inter', body: 'Inter' }, notes: '', files: [], updatedAt: '' })
}

export async function updateKit(id: string, patch: Partial<BrandKit>) {
  const k = await loadKit(id)
  if (typeof patch.name === 'string' && patch.name.trim()) k.name = patch.name.trim().slice(0, 80)
  if (Array.isArray(patch.colors)) {
    k.colors = patch.colors
      .filter(c => /^#[0-9a-f]{3,8}$/i.test(String(c.hex)))
      .map(c => ({ name: String(c.name || '').slice(0, 40), hex: String(c.hex).toLowerCase() }))
      .slice(0, 24)
  }
  if (patch.fonts) {
    const clean = (f: unknown, d: string) => String(f || d).replace(/[^\w \-]/g, '').slice(0, 60) || d
    k.fonts = { heading: clean(patch.fonts.heading, k.fonts.heading), body: clean(patch.fonts.body, k.fonts.body) }
  }
  if (typeof patch.notes === 'string') k.notes = patch.notes.slice(0, 4000)
  if (Array.isArray(patch.files)) {
    const labels = new Map(patch.files.map(f => [f.name, String(f.label || '').slice(0, 60)]))
    k.files = k.files.filter(f => labels.has(f.name)).map(f => ({ ...f, label: labels.get(f.name) || f.label }))
  }
  return writeKit(k)
}

export async function addKitFile(id: string, filename: string, data: Buffer) {
  const k = await loadKit(id)
  const ext = extname(filename).toLowerCase()
  if (!IMAGE_EXT.includes(ext)) throw createError({ statusCode: 422, message: 'Logos must be PNG, JPG, SVG, WebP or GIF' })
  const name = `${slugify(filename.replace(/\.[^.]+$/, '')).slice(0, 40)}-${randomBytes(2).toString('hex')}${ext}`
  await fs.writeFile(join(kitDir(id), 'files', name), data)
  k.files.push({ name, label: filename.replace(/\.[^.]+$/, '').slice(0, 60) })
  return writeKit(k)
}

export async function removeKitFile(id: string, name: string) {
  const k = await loadKit(id)
  if (!/^[\w.-]+$/.test(name)) throw createError({ statusCode: 400 })
  await fs.rm(join(kitDir(id), 'files', name), { force: true })
  k.files = k.files.filter(f => f.name !== name)
  return writeKit(k)
}

export async function deleteKit(id: string) {
  for (const { id: pid } of await listProjects()) {
    const p = await loadProject(pid).catch(() => null)
    if (p?.brandKitId === id) {
      p.brandKitId = null
      await syncBrand(p)
      await saveProject(p)
    }
  }
  await fs.rm(kitDir(id), { recursive: true, force: true })
}

export const kitFilePath = (id: string, name: string) => join(kitDir(id), 'files', name)

// Copy the project's kit into <project>/brand. Removes it when the project has no kit.
export async function syncBrand(p: Project) {
  const dest = join(projectDir(p.id), 'brand')
  if (!p.brandKitId) {
    await fs.rm(dest, { recursive: true, force: true })
    return
  }
  const k = await loadKit(p.brandKitId).catch(() => null)
  if (!k) return
  await fs.rm(dest, { recursive: true, force: true })
  await fs.mkdir(dest, { recursive: true })
  for (const f of k.files) await fs.copyFile(kitFilePath(k.id, f.name), join(dest, f.name)).catch(() => {})
  await fs.writeFile(join(dest, 'kit.json'), JSON.stringify(k, null, 2))
}

// The kit a project is using, read from its own copy (works for imported projects too).
export async function projectBrand(pid: string): Promise<BrandKit | null> {
  try { return JSON.parse(await fs.readFile(join(projectDir(pid), 'brand', 'kit.json'), 'utf8')) } catch { return null }
}

export function googleFontsHref(fonts: string[]) {
  const families = [...new Set(fonts.filter(f => f && f !== 'Inter'))]
  if (!families.length) return null
  return `https://fonts.googleapis.com/css2?${families.map(f => `family=${encodeURIComponent(f).replace(/%20/g, '+')}:wght@300..900`).join('&')}&display=block`
}
