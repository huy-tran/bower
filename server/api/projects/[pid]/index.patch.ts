import { promises as fs } from 'node:fs'
import { basename, resolve } from 'node:path'
import { APP_MODES, type AppMode, type AudioInfo, type CaptionSettings, type Clip, type Codebase } from '../../../utils/store'

const nums = (l: unknown) => Array.isArray(l) ? l.map(Number).filter(Number.isFinite) : undefined
const clamp = (v: unknown, lo: number, hi: number, fallback: number) => {
  const n = Number(v)
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback
}

export default defineEventHandler(async (event) => {
  const p = await loadProject(getRouterParam(event, 'pid')!)
  const body = await readBody<{
    name?: string
    artDirection?: string
    fps?: number
    audio?: Partial<AudioInfo>
    clips?: Partial<Clip>[]
    captions?: Partial<CaptionSettings>
    brandKitId?: string | null
    visualChecks?: boolean
    codebases?: Partial<Codebase>[]
    app?: { url?: string, notes?: string, mode?: AppMode } | null
    narrator?: { voice?: string, speed?: number, shortlist?: string[], pronunciations?: { term?: string, sayAs?: string }[] }
    folder?: string
  }>(event)

  if (body.app !== undefined) {
    const url = String(body.app?.url ?? '').trim()
    if (!url) {
      p.app = null
    } else {
      let parsed: URL
      try { parsed = new URL(url) } catch { throw createError({ statusCode: 422, message: 'The app address must be a full URL, like http://localhost:8000' }) }
      if (!/^https?:$/.test(parsed.protocol)) throw createError({ statusCode: 422, message: 'The app address must start with http:// or https://' })
      // A newly linked app defaults to real screenshots; one linked before the setting existed stays on "auto".
      const mode = APP_MODES.includes(body.app?.mode as AppMode) ? body.app!.mode! : p.app?.mode ?? (p.app ? 'auto' : 'shots')
      p.app = { url: parsed.toString().replace(/\/$/, ''), notes: String(body.app?.notes ?? p.app?.notes ?? '').slice(0, 2000), mode }
    }
  }

  if (typeof body.folder === 'string') p.folder = normalizeFolder(body.folder)

  if (body.narrator) {
    const voice = String(body.narrator.voice ?? p.narrator.voice)
    if (!VOICE_IDS.includes(voice)) throw createError({ statusCode: 422, message: 'Unknown narrator voice' })
    const shortlist = Array.isArray(body.narrator.shortlist)
      ? [...new Set(body.narrator.shortlist.map(String).filter(v => VOICE_IDS.includes(v)))]
      : p.narrator.shortlist
    const pronunciations = Array.isArray(body.narrator.pronunciations)
      ? body.narrator.pronunciations.map(x => ({ term: String(x?.term ?? '').trim().slice(0, 60), sayAs: String(x?.sayAs ?? '').trim().slice(0, 80) })).filter(x => x.term).slice(0, 100)
      : p.narrator.pronunciations
    p.narrator = { voice, speed: clamp(body.narrator.speed ?? p.narrator.speed, 0.7, 1.3, 1), shortlist, pronunciations }
  }

  if (typeof body.name === 'string' && body.name.trim()) p.name = body.name.trim()
  if (typeof body.artDirection === 'string') p.artDirection = body.artDirection
  if (body.fps) p.fps = clamp(body.fps, 12, 60, 30)
  if (typeof body.visualChecks === 'boolean') p.visualChecks = body.visualChecks
  // The whole list is replaced; every path must be a folder on this machine.
  if (Array.isArray(body.codebases)) {
    const next: Codebase[] = []
    for (const c of body.codebases.slice(0, 8)) {
      const path = String(c?.path ?? '').trim()
      if (!path) continue
      const abs = resolve(path)
      const st = await fs.stat(abs).catch(() => null)
      if (!st?.isDirectory()) throw createError({ statusCode: 422, message: `"${path}" is not a folder on this machine` })
      if (next.some(x => x.path.toLowerCase() === abs.toLowerCase())) continue
      const label = String(c?.label ?? '').trim().slice(0, 40) || basename(abs)
      next.push({ label, path: abs, notes: String(c?.notes ?? '').slice(0, 2000) })
    }
    p.codebases = next
  }
  const brandChanged = body.brandKitId !== undefined && (body.brandKitId || null) !== p.brandKitId
  if (brandChanged) {
    if (body.brandKitId) await loadKit(assertId(body.brandKitId))
    p.brandKitId = body.brandKitId || null
    await syncBrand(p)
  }

  if (body.audio && p.audio) {
    const a = body.audio
    p.audio = {
      ...p.audio,
      ...(a.bpm !== undefined && { bpm: Number(a.bpm) }),
      ...(a.duration !== undefined && { duration: Number(a.duration) }),
      ...(a.startOffset !== undefined && { startOffset: Math.max(0, Number(a.startOffset) || 0) }),
      ...(a.gain !== undefined && { gain: clamp(a.gain, 0, 1, 1) }),
      ...(a.fadeIn !== undefined && { fadeIn: clamp(a.fadeIn, 0, 20000, 0) }),
      ...(a.fadeOut !== undefined && { fadeOut: clamp(a.fadeOut, 0, 20000, 0) }),
      ...(a.duck !== undefined && { duck: clamp(a.duck, 0, 1, 1) }),
      ...(nums(a.beats) && { beats: nums(a.beats)! }),
      ...(nums(a.downbeats) && { downbeats: nums(a.downbeats)! }),
      ...(nums(a.phrases) && { phrases: nums(a.phrases)! }),
      ...(nums(a.peaks) && { peaks: nums(a.peaks)! }),
      ...(Array.isArray(a.sections) && {
        sections: a.sections.map(s => ({ start: Number(s.start), end: Number(s.end), label: String(s.label).slice(0, 24), energy: Number(s.energy) || 0 }))
      })
    }
  }

  // Clip edits: only known clips can change, and only their timing, level, kind, name and captions.
  if (Array.isArray(body.clips)) {
    const byId = new Map(p.clips.map(c => [c.id, c]))
    p.clips = body.clips.filter(c => c.id && byId.has(c.id)).map((c) => {
      const cur = byId.get(c.id!)!
      return {
        ...cur,
        ...(c.name !== undefined && { name: String(c.name).slice(0, 120) }),
        ...(c.kind && { kind: c.kind === 'voice' ? 'voice' as const : 'sfx' as const }),
        ...(c.start !== undefined && { start: Math.max(0, Math.round(Number(c.start) || 0)) }),
        ...(c.duration !== undefined && { duration: Math.max(0, Math.round(Number(c.duration) || 0)) }),
        ...(c.gain !== undefined && { gain: clamp(c.gain, 0, 1.5, 1) }),
        ...(c.captions !== undefined && {
          captions: Array.isArray(c.captions)
            ? c.captions.map(x => ({ start: Math.round(Number(x.start) || 0), end: Math.round(Number(x.end) || 0), text: String(x.text ?? '').slice(0, 400) })).filter(x => x.end > x.start)
            : null
        })
      }
    })
  }

  if (body.captions) {
    p.captions = {
      burnIn: body.captions.burnIn ?? p.captions.burnIn,
      position: body.captions.position === 'top' ? 'top' : body.captions.position === 'bottom' ? 'bottom' : p.captions.position,
      size: body.captions.size !== undefined ? clamp(body.captions.size, 16, 120, 44) : p.captions.size
    }
  }

  await saveProject(p)
  return projectView(p.id)
})
