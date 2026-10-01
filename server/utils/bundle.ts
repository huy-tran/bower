import { promises as fs } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { unzipSync, zipSync, strToU8, strFromU8, type Zippable } from 'fflate'
import { addVersion, createProject, loadProject, projectDir, saveProject, type Project } from './store'

// Project bundles hold what a teammate needs to keep working: project.json, scenes, audio and assets.
// Renders, versions and chat history stay on the machine they were made on.
const INCLUDE = ['scenes', 'audio', 'assets', 'brand']

async function walk(dir: string): Promise<string[]> {
  const out: string[] = []
  for (const d of await fs.readdir(dir, { withFileTypes: true }).catch(() => [])) {
    const full = join(dir, d.name)
    if (d.isDirectory()) out.push(...await walk(full))
    else if (d.isFile()) out.push(full)
  }
  return out
}

export async function exportBundle(pid: string) {
  const p = await loadProject(pid)
  const root = projectDir(pid)
  const files: Zippable = {
    'project.json': strToU8(JSON.stringify({ ...p, codebases: [], format: 'bower-project@1' }, null, 2))
  }
  for (const d of INCLUDE) {
    for (const f of await walk(join(root, d))) {
      files[relative(root, f).split(sep).join('/')] = new Uint8Array(await fs.readFile(f))
    }
  }
  return zipSync(files, { level: 6 })
}

export async function importBundle(zip: Uint8Array) {
  let entries: Record<string, Uint8Array>
  try { entries = unzipSync(zip) } catch { throw createError({ statusCode: 422, message: 'That file is not a valid zip' }) }

  // Accept bundles zipped with or without a top-level folder.
  const manifest = Object.keys(entries).filter(k => k.endsWith('project.json')).sort((a, b) => a.length - b.length)[0]
  if (!manifest) throw createError({ statusCode: 422, message: 'No project.json in the bundle' })
  const prefix = manifest.slice(0, -'project.json'.length)

  let src: Project
  try { src = JSON.parse(strFromU8(entries[manifest]!)) } catch { throw createError({ statusCode: 422, message: 'project.json is not valid JSON' }) }
  if (!Array.isArray(src.scenes) || !src.scenes.length) throw createError({ statusCode: 422, message: 'The bundle has no scenes' })

  const scenes = src.scenes
    .filter(s => /^[a-z0-9][a-z0-9-]*$/.test(s.id) && entries[`${prefix}scenes/${s.id}.html`])
    .map(s => ({ id: s.id, title: String(s.title || s.id), transition: s.transition ?? null, html: strFromU8(entries[`${prefix}scenes/${s.id}.html`]!) }))
  if (!scenes.length) throw createError({ statusCode: 422, message: 'None of the scene files were found' })

  const p = await createProject(String(src.name || 'Imported project'), [])
  const root = projectDir(p.id)
  for (const [name, data] of Object.entries(entries)) {
    if (!name.startsWith(prefix) || name.endsWith('/')) continue
    const rel = name.slice(prefix.length)
    if (!/^(audio|assets|brand)\/[\w\-. /]+$/.test(rel) || rel.includes('..')) continue
    await fs.mkdir(join(root, rel, '..'), { recursive: true })
    await fs.writeFile(join(root, rel), data)
  }
  await fs.mkdir(join(root, 'scenes'), { recursive: true })
  for (const s of scenes) {
    await fs.writeFile(join(root, 'scenes', `${s.id}.html`), s.html)
    await addVersion(p.id, s.id, s.html, 'Imported')
  }

  const next: Project = {
    ...p,
    artDirection: String(src.artDirection || ''),
    width: Number(src.width) || 1920,
    height: Number(src.height) || 1080,
    fps: Number(src.fps) || 30,
    scenes: scenes.map(s => ({ id: s.id, title: s.title, transition: s.transition })),
    audio: src.audio?.file && entries[`${prefix}audio/${src.audio.file}`] ? src.audio : null,
    clips: (Array.isArray(src.clips) ? src.clips : []).filter(c => c?.file && entries[`${prefix}audio/${c.file}`]),
    captions: { ...p.captions, ...src.captions },
    visualChecks: src.visualChecks ?? true,
    // The kit itself is not shared, but its copy in brand/ still guides Claude.
    brandKitId: null
  }
  await saveProject(next)
  return next
}
