import { promises as fs } from 'node:fs'
import { extname, join } from 'node:path'

const AUDIO_EXT = ['.mp3', '.wav', '.m4a', '.aac', '.ogg', '.flac']

// Music track. Sound clips live in audio/clips and are left alone.
export default defineEventHandler(async (event) => {
  const p = await loadProject(getRouterParam(event, 'pid')!)
  const parts = await readMultipartFormData(event)
  const file = parts?.find(x => x.name === 'file' && x.filename)
  if (!file) throw createError({ statusCode: 422, message: 'No audio file' })
  const ext = extname(file.filename!).toLowerCase()
  if (!AUDIO_EXT.includes(ext)) throw createError({ statusCode: 422, message: 'Unsupported audio type' })
  const dir = join(projectDir(p.id), 'audio')
  await fs.mkdir(dir, { recursive: true })
  for (const f of await fs.readdir(dir)) if (f.startsWith('track.')) await fs.rm(join(dir, f), { force: true })
  const stored = `track${ext}`
  await fs.writeFile(join(dir, stored), file.data)
  p.audio = { file: stored, name: file.filename!, startOffset: 0, beats: [], downbeats: [], phrases: [], gain: 1, fadeIn: 0, fadeOut: 1500, duck: 0.35 }
  await saveProject(p)
  return projectView(p.id)
})
