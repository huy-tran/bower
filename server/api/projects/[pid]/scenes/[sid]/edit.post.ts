import type { TimingStart } from '../../../../../utils/sceneSource'

// Every change made by hand in the editor goes through here: retyped text, scene settings (params), animation
// timings and the code editor. Each one is saved as a version labelled "By hand: ..." so Undo, History and Claude
// see it. `base` is the hash of the source the editor worked from; an edit against an older file is refused.
type Body =
  | { op: 'text', base?: string, i: number, before: string, text: string }
  | { op: 'codeText', base?: string, before: string, text: string }
  | { op: 'params', base?: string, values: Record<string, unknown> }
  | { op: 'timing', base: string, offset: number, match: string, start: TimingStart, dur: number, ease: string | null }
  | { op: 'source', base: string, html: string }
  | { op: 'duration', base?: string, ms: number }

const clip = (s: string, n = 40) => {
  const t = s.replace(/\s+/g, ' ').trim()
  return t.length > n ? `${t.slice(0, n)}…` : t
}

export default defineEventHandler(async (event) => {
  const p = await loadProject(getRouterParam(event, 'pid')!)
  const sid = assertId(getRouterParam(event, 'sid'))
  if (!p.scenes.some(s => s.id === sid)) throw createError({ statusCode: 404, message: 'Scene not found' })
  // Claude's run records versions by comparing files before and after, so a hand edit during a run would be
  // credited to Claude, or overwritten by it.
  if (getJob(p.id, sid)?.status === 'running' || getJob(p.id, 'project')?.status === 'running') {
    throw createError({ statusCode: 409, message: 'Claude is working on this scene. Edit it when it has finished.' })
  }
  const body = await readBody<Body>(event)
  const html = await readScene(p.id, sid)
  if (body.base && body.base !== sourceHash(html)) throw createError({ statusCode: 409, message: 'The scene changed since you opened it. Your view has been refreshed, so try again.' })

  let next: string
  let label: string
  if (body.op === 'text') {
    const text = String(body.text ?? '')
    if (!text.trim()) throw createError({ statusCode: 422, message: 'Text cannot be empty.' })
    next = setElementText(html, Number(body.i), String(body.before ?? ''), text)
    label = `By hand: text "${clip(text)}"`
  } else if (body.op === 'codeText') {
    const text = String(body.text ?? '')
    if (!text.trim()) throw createError({ statusCode: 422, message: 'Text cannot be empty.' })
    next = setCodeText(html, String(body.before ?? ''), text)
    label = `By hand: text "${clip(text)}"`
  } else if (body.op === 'params') {
    if (!body.values || typeof body.values !== 'object') throw createError({ statusCode: 422, message: 'No settings to change.' })
    next = withParamValues(html, body.values)
    const names = new Map(sceneMeta(html).params.map(x => [x.name, x.label]))
    label = `By hand: ${Object.entries(body.values).map(([k, v]) => `${names.get(k) ?? k} ${typeof v === 'string' ? `"${clip(v, 24)}"` : v}`).join(', ')}`
  } else if (body.op === 'timing') {
    if (!body.base) throw createError({ statusCode: 422, message: 'Missing base' })
    const dur = Number(body.dur)
    if (!Number.isFinite(dur) || dur < 0 || dur > 600_000) throw createError({ statusCode: 422, message: 'Invalid duration' })
    const s = body.start
    if (!s || !['at', 'end', 'stagger'].includes(s.kind) || !Number.isFinite(Number(s.ms)) || (s.kind === 'stagger' && (!Number.isFinite(Number(s.step)) || !/^[\w.]+$/.test(s.index)))) {
      throw createError({ statusCode: 422, message: 'Invalid start' })
    }
    const ease = body.ease && /^\w+$/.test(body.ease) ? body.ease : null
    next = setTiming(html, Number(body.offset), String(body.match), { start: s, dur, ease })
    const found = findTimings(html).timings.find(t => t.offset === Number(body.offset))
    label = `By hand: timing of ${clip(found?.label ?? 'an animation', 30)}`
  } else if (body.op === 'source') {
    if (typeof body.html !== 'string' || !body.html.trim() || body.html.length > 2_000_000) throw createError({ statusCode: 422, message: 'Scene source is required' })
    next = body.html
    label = 'By hand: code'
  } else if (body.op === 'duration') {
    const ms = Math.round(Number(body.ms))
    if (!Number.isFinite(ms) || ms < 100 || ms > 600_000) throw createError({ statusCode: 422, message: 'Invalid length' })
    next = withDuration(html, ms)
    label = `By hand: length ${(ms / 1000).toFixed(2)}s`
  } else {
    throw createError({ statusCode: 422, message: 'Unknown edit' })
  }

  if (next === html) return { project: await projectView(p.id), hash: sourceHash(html) }
  const idx = await getVersions(p.id, sid)
  if (!idx.items.length) await addVersion(p.id, sid, html, 'Before')
  await writeScene(p.id, sid, next)
  await addVersion(p.id, sid, next, label)
  // The voice clip and CLAUDE.md follow the scene (a changed duration moves the scenes after it).
  await saveProject(p)
  return { project: await projectView(p.id), hash: sourceHash(next) }
})
