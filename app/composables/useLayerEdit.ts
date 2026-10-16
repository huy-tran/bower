import { TRACK_PROPS, easeFn, sampleTrack, type TrackKey, type TrackProp, type TrackValue, type Tracks } from '#shared/utils/tracks'
import type { MotionPath, TransformDelta, TransformKind, TransformPhase } from '~/utils/stageEdit'
import type { AnimPreset } from '~/utils/presets'
import type { Picked } from './useSceneEdit'

// The picked element as a layer, After Effects style: its values at the playhead, a stopwatch per property
// (one value, or keyframes), keyframes added where the playhead is, presets, and the transform box in the preview.
// Changes preview live while dragging or scrubbing and go into the scene's unsaved draft when let go.

// Where a drag started from, so each move is applied to the values before the drag.
let dragStart: Record<string, number> | null = null

export function useLayerEdit() {
  const ed = useEditor()
  const edit = useSceneEdit()
  const pid = computed(() => ed.project.value?.id ?? '')
  const sid = computed(() => ed.selected.value?.id ?? '')
  const frameMs = computed(() => 1000 / (ed.project.value?.fps || 30))
  // Keyframes go on whole frames.
  const now = computed(() => Math.round(Math.min(ed.time.value, ed.selected.value?.duration ?? ed.time.value) / frameMs.value) * frameMs.value)

  const picked = computed(() => edit.picked.value?.sceneId === sid.value ? edit.picked.value : null)
  const saved = computed<Tracks>(() => edit.source.value?.sceneId === sid.value ? edit.source.value.tracks ?? {} : {})
  const tracks = computed<Tracks>(() => edit.liveTracks.value ?? saved.value)

  // Where the picked element's keyframes live: its data-ve-id, or its selector when it has no id yet (one is added
  // when the change goes into the draft) or the scene's script creates it.
  const keyOf = (p: Picked) => p.veId ?? `css:${p.selector}`
  const key = computed(() => picked.value ? keyOf(picked.value) : null)
  const props = computed<Record<string, TrackProp>>(() => (key.value && tracks.value[key.value]?.props) || {})

  function fallback(name: string): TrackValue {
    const def = TRACK_PROPS.find(p => p.name === name)
    if (def?.def !== undefined) return def.def
    const st = picked.value?.styles as Record<string, TrackValue> | undefined
    return st?.[name] ?? (def?.kind === 'color' ? '#000000' : 0)
  }
  function valueAt(name: string, t = now.value): TrackValue {
    const p = props.value[name]
    return p === undefined ? fallback(name) : sampleTrack(p, t, easeFn)
  }
  const num = (name: string, t?: number) => Number(valueAt(name, t)) || 0
  const isKeyed = (name: string) => Array.isArray(props.value[name])
  const keysOf = (name: string) => (isKeyed(name) ? props.value[name] : []) as TrackKey[]
  const keyAtNow = (name: string) => keysOf(name).findIndex(k => Math.abs(k[0] - now.value) < frameMs.value / 2)

  // A property's new keyframes (or value) after setting `v` at the playhead: keyframed properties get a key there
  // (keeping that key's easing), others just take the value.
  function withValue(name: string, v: TrackValue): TrackProp {
    if (!isKeyed(name)) return v
    const keys = keysOf(name).map(k => [...k] as TrackKey)
    const i = keyAtNow(name)
    if (i >= 0) keys[i]![1] = v
    else keys.push([now.value, v])
    return keys.sort((a, b) => a[0] - b[0])
  }

  function preview(next: Record<string, TrackProp | null>) {
    const k = key.value
    if (!k) return
    const merged: Record<string, TrackProp> = { ...props.value }
    for (const [n, v] of Object.entries(next)) { if (v === null) delete merged[n]; else merged[n] = v }
    edit.previewTracks(sid.value, { ...tracks.value, [k]: { props: merged } })
  }

  async function commit(next: Record<string, TrackProp | null>) {
    const p = picked.value
    if (!p) return false
    return edit.apply(pid.value, sid.value, {
      op: 'track',
      key: p.veId ?? (p.index === null ? `css:${p.selector}` : undefined),
      index: p.veId ? undefined : p.index,
      props: next,
      label: p.name
    })
  }

  // One property changed from the inspector: live while scrubbing, into the draft when let go.
  function set(name: string, v: TrackValue, phase: 'live' | 'commit') {
    const next = { [name]: withValue(name, v) }
    return phase === 'live' ? preview(next) : commit(next)
  }

  // The stopwatch: start keyframing a property from its value now, or go back to one value (the one now).
  function toggleKeyed(name: string) {
    return commit({ [name]: isKeyed(name) ? valueAt(name) : [[now.value, valueAt(name)]] })
  }
  // The diamond: add a keyframe at the playhead with the value there, or remove the one that is there.
  function toggleKey(name: string) {
    const i = keyAtNow(name)
    if (i < 0) return commit({ [name]: withValue(name, valueAt(name)) })
    const keys = keysOf(name).filter((_, j) => j !== i)
    return commit({ [name]: keys.length ? keys : valueAt(name) })
  }
  const setKeys = (name: string, keys: TrackKey[]) => commit({ [name]: keys.length ? [...keys].sort((a, b) => a[0] - b[0]) : valueAt(name) })
  // Takes every keyframe and value off the layer.
  const reset = () => commit(Object.fromEntries(Object.keys(props.value).map(n => [n, null])))

  // Every keyframe time on the layer, for jumping between them.
  const keyTimes = computed(() => [...new Set(Object.keys(props.value).flatMap(n => keysOf(n).map(k => k[0])))].sort((a, b) => a - b))
  function jump(dir: -1 | 1) {
    const t = ed.time.value
    const to = dir < 0 ? [...keyTimes.value].reverse().find(k => k < t - 1) : keyTimes.value.find(k => k > t + 1)
    if (to !== undefined) { ed.pause(); ed.seek(to) }
  }

  // A preset at the playhead: its keyframes replace any the property has in that stretch of time.
  function applyPreset(preset: AnimPreset) {
    const t = now.value
    const d = preset.dur
    const restAt = preset.kind === 'in' ? t + d : t
    const made = preset.keys(t, d, name => num(name, restAt))
    const next: Record<string, TrackProp> = {}
    for (const [name, keys] of Object.entries(made)) {
      const kept = keysOf(name).filter(k => k[0] < t - 1 || k[0] > t + d + 1)
      next[name] = [...kept, ...keys].sort((a, b) => a[0] - b[0])
    }
    return commit(next)
  }

  // The transform box: move, scale or rotate from where the drag started.
  function transform(kind: TransformKind, phase: TransformPhase, d: TransformDelta) {
    if (phase === 'start') dragStart = { x: num('x'), y: num('y'), scale: num('scale'), rotate: num('rotate') }
    const s = dragStart
    if (!s) return
    const values: Record<string, number> = kind === 'move'
      ? { x: Math.round(s.x! + d.dx), y: Math.round(s.y! + d.dy) }
      : kind === 'scale' ? { scale: Math.round(s.scale! * d.factor * 1000) / 1000 } : { rotate: Math.round((s.rotate! + d.angle) * 10) / 10 }
    const next = Object.fromEntries(Object.entries(values).map(([n, v]) => [n, withValue(n, v)]))
    if (phase === 'end') {
      dragStart = null
      if (Object.entries(values).every(([n, v]) => v === s[n])) return preview({})
      return commit(next)
    }
    preview(next)
  }

  // The picked element's path over time, when its position has keyframes.
  function path(): MotionPath | null {
    if (!isKeyed('x') && !isKeyed('y')) return null
    const times = [...keysOf('x'), ...keysOf('y')].map(k => k[0])
    const from = Math.min(...times), to = Math.max(...times)
    const points: [number, number][] = []
    for (let i = 0; i <= 48; i++) {
      const t = from + (to - from) * i / 48
      points.push([num('x', t), num('y', t)])
    }
    const keys = [...new Set(times)].map(t => [num('x', t), num('y', t)] as [number, number])
    return { points, keys, now: [num('x', ed.time.value), num('y', ed.time.value)] }
  }

  return { picked, key, props, now, valueAt, isKeyed, keysOf, keyAtNow, keyTimes, set, toggleKeyed, toggleKey, setKeys, reset, jump, applyPreset, transform, path }
}
