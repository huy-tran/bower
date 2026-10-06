import { cleanRepos, createApp, getApp, updateApp } from '../../../utils/apps'
import { cleanModels } from '../../../utils/models'
import { readSettings } from '../../../utils/settings'
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
    // Replaces the per-task models; a task left out (or set to anything unknown) uses the Bower settings default.
    models?: Record<string, string | null>
    codebases?: Partial<Codebase>[]
    // The shared app this project is about (apps.ts), and how it shows it. `app` with an address links the app
    // with that address, creating it if needed (older editors, imports).
    appId?: string | null
    appMode?: AppMode
    app?: { url?: string, notes?: string, mode?: AppMode } | null
    narrator?: { voice?: string, speed?: number, shortlist?: string[], pronunciations?: { term?: string, sayAs?: string }[] }
    folder?: string
  }>(event)

  // Linking an app keeps this project's display mode, or starts from the default in Bower settings.
  const link = async (id: string) => {
    const shared = await getApp(id)
    if (!shared) throw createError({ statusCode: 404, message: 'App not found' })
    p.app = { id: shared.id, name: shared.name, url: shared.url, notes: shared.notes, mode: p.app?.mode ?? (await readSettings()).defaults.appMode }
    p.appCodebases = shared.codebases
  }
  if (body.appId !== undefined) {
    if (body.appId) await link(String(body.appId))
    else { p.app = null; p.appCodebases = [] }
  }
  if (body.app !== undefined) {
    const url = String(body.app?.url ?? '').trim()
    if (!url) { p.app = null; p.appCodebases = [] } else {
      const shared = await createApp({ url, notes: body.app?.notes })
      if (body.app?.notes !== undefined && shared.notes !== body.app.notes) await updateApp(shared.id, { notes: body.app.notes })
      await link(shared.id)
    }
  }
  const mode = body.appMode ?? body.app?.mode
  if (p.app && mode && APP_MODES.includes(mode)) p.app.mode = mode

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
  if (body.models !== undefined) p.models = cleanModels(body.models)
  // The whole list is replaced; every path must be a folder on this machine.
  if (Array.isArray(body.codebases)) p.codebases = await cleanRepos(body.codebases) as Codebase[]
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
