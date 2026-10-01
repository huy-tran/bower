import { promises as fs } from 'node:fs'
import { resolve } from 'node:path'
import { randomBytes } from 'node:crypto'
import { STORAGE } from './paths'
import type { RenderFormat } from './render'

// Named render settings shared by every project on this machine. Built-in ones come first and cannot be deleted.
export interface RenderPreset { id: string, name: string, format: RenderFormat, fps: number, scale: number, builtIn?: boolean }

const FILE = resolve(STORAGE, '..', 'render-presets.json')
const BUILT_IN: RenderPreset[] = [
  { id: 'mp4-full', name: 'MP4, full quality', format: 'mp4', fps: 30, scale: 1, builtIn: true },
  { id: 'mp4-preview', name: 'Fast preview (half size)', format: 'mp4', fps: 24, scale: 0.5, builtIn: true },
  { id: 'gif', name: 'Animated GIF', format: 'gif', fps: 24, scale: 0.5, builtIn: true },
  { id: 'prores', name: 'ProRes 4444 with transparency', format: 'mov', fps: 30, scale: 1, builtIn: true }
]

async function readUser(): Promise<RenderPreset[]> {
  try { return (JSON.parse(await fs.readFile(FILE, 'utf8')).presets ?? []) } catch { return [] }
}
async function writeUser(presets: RenderPreset[]) {
  await fs.mkdir(resolve(FILE, '..'), { recursive: true })
  await fs.writeFile(FILE, JSON.stringify({ presets }, null, 2))
}

export async function listRenderPresets() {
  return [...BUILT_IN, ...await readUser()]
}

export async function createRenderPreset(p: Partial<RenderPreset>) {
  const name = String(p.name ?? '').trim().slice(0, 60)
  if (!name) throw createError({ statusCode: 422, message: 'Give the preset a name' })
  const preset: RenderPreset = {
    id: `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30) || 'preset'}-${randomBytes(2).toString('hex')}`,
    name,
    format: p.format === 'gif' || p.format === 'mov' ? p.format : 'mp4',
    fps: Math.min(60, Math.max(12, Math.round(Number(p.fps) || 30))),
    scale: p.scale === 0.5 ? 0.5 : 1
  }
  await writeUser([...await readUser(), preset])
  return listRenderPresets()
}

export async function removeRenderPreset(id: string) {
  await writeUser((await readUser()).filter(p => p.id !== id))
  return listRenderPresets()
}
