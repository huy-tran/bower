import { promises as fs } from 'node:fs'
import { join } from 'node:path'

export default defineEventHandler(async (event) => {
  const p = await loadProject(getRouterParam(event, 'pid')!)
  const cid = assertId(getRouterParam(event, 'cid'))
  const clip = p.clips.find(c => c.id === cid)
  if (!clip) throw createError({ statusCode: 404, message: 'Clip not found' })
  await fs.rm(join(projectDir(p.id), 'audio', clip.file), { force: true })
  p.clips = p.clips.filter(c => c.id !== cid)
  await saveProject(p)
  return projectView(p.id)
})
