import { promises as fs } from 'node:fs'
import { extname, join } from 'node:path'
import { randomBytes } from 'node:crypto'
import type { Clip } from '../../../../utils/store'

const AUDIO_EXT = ['.mp3', '.wav', '.m4a', '.aac', '.ogg', '.flac', '.webm']

// Add a sound effect or voice-over clip at a point on the video timeline.
// With `sceneId` (generated narration) the clip is pinned to that scene's start and replaces the scene's previous one.
export default defineEventHandler(async (event) => {
  const p = await loadProject(getRouterParam(event, 'pid')!)
  const parts = await readMultipartFormData(event)
  const file = parts?.find(x => x.name === 'file' && x.filename)
  if (!file) throw createError({ statusCode: 422, message: 'No audio file' })
  const field = (n: string) => parts?.find(x => x.name === n)?.data.toString()
  const json = (n: string) => { try { return JSON.parse(field(n) || 'null') } catch { return null } }
  const ext = extname(file.filename!).toLowerCase()
  if (!AUDIO_EXT.includes(ext)) throw createError({ statusCode: 422, message: 'Unsupported audio type' })

  let start = Math.max(0, Math.round(Number(field('start')) || 0))
  let kind: Clip['kind'] = field('kind') === 'voice' ? 'voice' : 'sfx'
  const sceneId = field('sceneId') || null
  let source: Clip['source'] = null
  if (sceneId) {
    const scene = (await sceneViews(p)).find(s => s.id === sceneId)
    if (!scene) throw createError({ statusCode: 404, message: 'Scene not found' })
    for (const old of p.clips.filter(c => c.sceneId === sceneId)) await fs.rm(join(projectDir(p.id), 'audio', old.file), { force: true }).catch(() => {})
    p.clips = p.clips.filter(c => c.sceneId !== sceneId)
    start = scene.start
    kind = 'voice'
    const src = json('source')
    if (!src || typeof src.text !== 'string') throw createError({ statusCode: 422, message: 'A scene clip needs its source script' })
    source = { text: String(src.text).slice(0, 2000), voice: String(src.voice || ''), speed: Number(src.speed) || 1, ...(typeof src.spoken === 'string' && { spoken: src.spoken.slice(0, 2000) }) }
  }
  const caps = json('captions')
  const captions = Array.isArray(caps)
    ? caps.map(x => ({ start: Math.round(Number(x.start) || 0), end: Math.round(Number(x.end) || 0), text: String(x.text ?? '').slice(0, 400) })).filter(x => x.end > x.start)
    : null

  const id = `clip-${randomBytes(3).toString('hex')}`
  const dir = join(projectDir(p.id), 'audio', 'clips')
  await fs.mkdir(dir, { recursive: true })
  await fs.writeFile(join(dir, `${id}${ext}`), file.data)
  p.clips.push({
    id,
    kind,
    file: `clips/${id}${ext}`,
    name: file.filename!.replace(/\.[^.]+$/, '').slice(0, 120),
    start,
    duration: Math.max(0, Math.round(Number(field('duration')) || 0)),
    gain: 1,
    captions,
    sceneId,
    source
  })
  await saveProject(p)
  return { id, project: await projectView(p.id) }
})
