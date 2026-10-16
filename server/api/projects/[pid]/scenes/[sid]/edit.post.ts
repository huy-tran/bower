import type { TimingStart } from '../../../../../utils/sceneSource'
import { cleanTrackProp, validTrackKey } from '#shared/utils/tracks'

// Every change made by hand in the editor goes through here: retyped text, scene settings (params), animation
// timings, the scene's length and the code editor. Changes collect in the scene's draft (drafts.ts) until the user
// saves them as one version labelled "By hand: ...". `base` is the hash of the source the editor worked from; an
// edit against an older one is refused.
type Body =
  | { op: 'text', base?: string, i: number, before: string, text: string }
  | { op: 'codeText', base?: string, before: string, text: string }
  | { op: 'params', base?: string, values: Record<string, unknown> }
  | { op: 'timing', base: string, offset: number, match: string, start: TimingStart, dur: number, ease: string | null }
  | { op: 'source', base: string, html: string }
  | { op: 'duration', base?: string, ms: number }
  // Keyframes or values for one element: `key` when it already has tracks, else `index` (an element of the markup,
  // which gets a data-ve-id) or `selector` (one the scene's script creates). A null property removes it.
  | { op: 'track', base?: string, key?: string, index?: number | null, selector?: string, props: Record<string, unknown>, label?: string }
  | { op: 'name', base?: string, index: number, name: string }

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
  const html = await editableSource(p.id, sid)
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
  } else if (body.op === 'track') {
    let src = html
    let key = typeof body.key === 'string' && validTrackKey(body.key) ? body.key : ''
    if (!key && Number.isInteger(body.index)) {
      key = elementAttr(src, body.index!, 'data-ve-id') ?? ''
      if (!key) {
        const taken = layerIds(src)
        do key = `l${Math.random().toString(36).slice(2, 7)}`; while (taken.has(key))
        src = setElementAttr(src, body.index!, 'data-ve-id', key)
      }
    }
    if (!key && typeof body.selector === 'string' && body.selector.trim()) key = `css:${body.selector.trim().slice(0, 300)}`
    if (!key || !validTrackKey(key)) throw createError({ statusCode: 422, message: 'Pick an element first.' })
    if (!body.props || typeof body.props !== 'object') throw createError({ statusCode: 422, message: 'Nothing to change.' })
    const tracks = sceneMeta(src).tracks
    const props = { ...tracks[key]?.props }
    for (const [name, v] of Object.entries(body.props)) {
      if (v === null) { delete props[name]; continue }
      const c = cleanTrackProp(name, v)
      if (c === undefined) throw createError({ statusCode: 422, message: `Not a valid value for ${name}.` })
      props[name] = c
    }
    if (Object.keys(props).length) tracks[key] = { props }
    else delete tracks[key]
    next = withMeta(src, { tracks: Object.keys(tracks).length ? tracks : null })
    const what = clip(String(body.label ?? '') || 'an element', 30)
    const changed = Object.entries(body.props).map(([n, v]) => v === null ? `no ${n}` : Array.isArray(v) ? `${n} keyframes` : n)
    label = `By hand: ${what} ${changed.join(', ')}`
  } else if (body.op === 'name') {
    const name = String(body.name ?? '').replace(/\s+/g, ' ').trim().slice(0, 60)
    next = setElementAttr(html, Number(body.index), 'data-ve-name', name || null)
    label = `By hand: layer named "${clip(name || 'unnamed')}"`
  } else {
    throw createError({ statusCode: 422, message: 'Unknown edit' })
  }

  if (next !== html) await addToDraft(p.id, sid, html, next, label)
  return { project: await projectView(p.id), hash: sourceHash(next) }
})
