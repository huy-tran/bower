import { promises as fs } from 'node:fs'
import { extname, join } from 'node:path'

export default defineEventHandler(async (event) => {
  const p = await loadProject(getRouterParam(event, 'pid')!)
  const parts = await readMultipartFormData(event)
  const file = parts?.find(x => x.name === 'file' && x.filename)
  if (!file) throw createError({ statusCode: 422, message: 'No audio file' })
  const ext = extname(file.filename!).toLowerCase()
  if (!['.mp3', '.wav', '.m4a', '.aac', '.ogg', '.flac'].includes(ext)) throw createError({ statusCode: 422, message: 'Unsupported audio type' })
  const dir = join(projectDir(p.id), 'audio')
  await fs.rm(dir, { recursive: true, force: true })
  await fs.mkdir(dir, { recursive: true })
  const stored = `track${ext}`
  await fs.writeFile(join(dir, stored), file.data)
  p.audio = { file: stored, name: file.filename!, startOffset: 0, beats: [], downbeats: [], phrases: [] }
  await saveProject(p)
  return projectView(p.id)
})
