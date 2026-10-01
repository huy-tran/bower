import { promises as fs } from 'node:fs'
import { join } from 'node:path'

export default defineEventHandler(async (event) => {
  const p = await loadProject(getRouterParam(event, 'pid')!)
  await fs.rm(join(projectDir(p.id), 'audio'), { recursive: true, force: true })
  p.audio = null
  await saveProject(p)
  return projectView(p.id)
})
