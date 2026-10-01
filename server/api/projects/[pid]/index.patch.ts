import type { AudioInfo } from '../../../utils/store'

export default defineEventHandler(async (event) => {
  const p = await loadProject(getRouterParam(event, 'pid')!)
  const body = await readBody<{ name?: string, artDirection?: string, fps?: number, audio?: Partial<AudioInfo> }>(event)
  if (typeof body.name === 'string' && body.name.trim()) p.name = body.name.trim()
  if (typeof body.artDirection === 'string') p.artDirection = body.artDirection
  if (body.fps) p.fps = Math.min(60, Math.max(12, Number(body.fps)))
  if (body.audio && p.audio) {
    const a = body.audio
    const nums = (l: unknown) => Array.isArray(l) ? l.map(Number).filter(Number.isFinite) : undefined
    p.audio = {
      ...p.audio,
      ...(a.bpm !== undefined && { bpm: Number(a.bpm) }),
      ...(a.duration !== undefined && { duration: Number(a.duration) }),
      ...(a.startOffset !== undefined && { startOffset: Math.max(0, Number(a.startOffset) || 0) }),
      ...(nums(a.beats) && { beats: nums(a.beats)! }),
      ...(nums(a.downbeats) && { downbeats: nums(a.downbeats)! }),
      ...(nums(a.phrases) && { phrases: nums(a.phrases)! }),
      ...(nums(a.peaks) && { peaks: nums(a.peaks)! })
    }
  }
  await saveProject(p)
  return projectView(p.id)
})
