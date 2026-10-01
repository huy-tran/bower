import { promises as fs } from 'node:fs'
import { join } from 'node:path'

export default defineEventHandler(async (event) => {
  const p = await loadProject(getRouterParam(event, 'pid')!)
  const dir = join(projectDir(p.id), 'audio')
  for (const f of await fs.readdir(dir).catch(() => [])) if (f.startsWith('track.')) await fs.rm(join(dir, f), { force: true })
  p.audio = null
  await saveProject(p)
  return projectView(p.id)
})
