import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { addVersion, createProject, loadProject, projectDir, readScene, saveProject, type Project } from './store'

// Copy a project's scenes, audio, assets and brand files into a new project. Versions start fresh;
// renders and chats stay behind.
export async function duplicateProject(pid: string, opts: { name?: string, width?: number, height?: number } = {}) {
  const src = await loadProject(pid)
  const width = opts.width ?? src.width, height = opts.height ?? src.height
  const p = await createProject(opts.name || `${src.name} copy`, [], { width, height })
  for (const dir of ['audio', 'assets', 'brand']) {
    await fs.cp(join(projectDir(pid), dir), join(projectDir(p.id), dir), { recursive: true }).catch(() => {})
  }
  await fs.mkdir(join(projectDir(p.id), 'scenes'), { recursive: true })
  for (const s of src.scenes) {
    const html = await readScene(pid, s.id)
    await fs.writeFile(join(projectDir(p.id), 'scenes', `${s.id}.html`), html)
    await addVersion(p.id, s.id, html, `Copied from ${src.name}`)
  }
  const next: Project = {
    ...src,
    id: p.id,
    name: p.name,
    width,
    height,
    published: null,
    createdAt: p.createdAt
  }
  await saveProject(next)
  return next
}
