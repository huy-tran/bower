// Keyframes made by hand (or by Claude) for the elements of a scene, kept in the meta block's "tracks":
//
//   "tracks": { "l3f2a": { "props": { "y": [[0, 60], [600, 0, "outExpo"]], "opacity": [[0, 0], [600, 1]], "color": "#2563eb" } } }
//
// Each key is an element's data-ve-id (or "css:<selector>" for an element the scene's script creates). A property is
// either one value or keyframes [ms, value, easing into this key]. The runtime applies them on top of whatever
// render(t) did: position, scale and rotation through the separate CSS translate / scale / rotate properties, which
// combine with the transform render(t) sets, and opacity multiplied with render(t)'s. Values are in CSS units
// (opacity 0..1, scale 1 = normal size); the inspector shows those two as percentages.
//
// sampleTrack and easeFn are copied into the scene runtime as source (runtime.ts), so they must stay self-contained.

export type TrackValue = number | string | boolean
export type TrackKey = [number, TrackValue, string?]
export type TrackProp = TrackValue | TrackKey[]
export interface LayerTrack { props: Record<string, TrackProp> }
export type Tracks = Record<string, LayerTrack>

export interface TrackPropDef {
  name: string
  label: string
  kind: 'number' | 'color' | 'boolean'
  group: 'transform' | 'style'
  unit?: string
  // The value when the property has no track (style properties read theirs from the element).
  def?: number | boolean
  min?: number
  max?: number
  step?: number
  // Shown in the inspector multiplied by this (opacity 0..1 shows as 0..100%); min, max, def and step are stored units.
  factor?: number
}

export const TRACK_PROPS: TrackPropDef[] = [
  { name: 'x', label: 'X', kind: 'number', group: 'transform', unit: 'px', def: 0, step: 1 },
  { name: 'y', label: 'Y', kind: 'number', group: 'transform', unit: 'px', def: 0, step: 1 },
  { name: 'scale', label: 'Scale', kind: 'number', group: 'transform', unit: '%', factor: 100, def: 1, min: 0, step: 0.01 },
  { name: 'rotate', label: 'Rotation', kind: 'number', group: 'transform', unit: '°', def: 0, step: 1 },
  { name: 'opacity', label: 'Opacity', kind: 'number', group: 'transform', unit: '%', factor: 100, def: 1, min: 0, max: 1, step: 0.01 },
  { name: 'blur', label: 'Blur', kind: 'number', group: 'transform', unit: 'px', def: 0, min: 0, step: 0.5 },
  { name: 'typed', label: 'Typed', kind: 'number', group: 'transform', unit: '%', factor: 100, def: 1, min: 0, max: 1, step: 0.01 },
  { name: 'color', label: 'Colour', kind: 'color', group: 'style' },
  { name: 'background', label: 'Background', kind: 'color', group: 'style' },
  { name: 'fontSize', label: 'Font size', kind: 'number', group: 'style', unit: 'px', min: 1, step: 1 },
  { name: 'letterSpacing', label: 'Letter spacing', kind: 'number', group: 'style', unit: 'em', step: 0.005 },
  { name: 'radius', label: 'Corner radius', kind: 'number', group: 'style', unit: 'px', min: 0, step: 1 },
  { name: 'hidden', label: 'Hidden', kind: 'boolean', group: 'style', def: false }
]

export const EASE_NAMES = ['linear', 'inQuad', 'outQuad', 'inOutQuad', 'inCubic', 'outCubic', 'inOutCubic', 'outQuart', 'inOutQuart', 'outQuint', 'inOutQuint', 'inExpo', 'outExpo', 'inOutExpo', 'outBack', 'inOutBack', 'spring']

// The easing named `name` ("outExpo"), or a cubic bezier written "cubic(x1,y1,x2,y2)" as in CSS. Self-contained.
export function easeFn(name: string | undefined): (p: number) => number {
  const n = name || 'inOutCubic'
  const m = /^cubic\(\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*\)$/.exec(n)
  if (m) {
    const x1 = +m[1]!, y1 = +m[2]!, x2 = +m[3]!, y2 = +m[4]!
    const bez = (a: number, b: number, s: number) => 3 * a * s * (1 - s) * (1 - s) + 3 * b * s * s * (1 - s) + s * s * s
    return (p: number) => {
      if (p <= 0) return 0
      if (p >= 1) return 1
      let lo = 0, hi = 1, s = p
      for (let i = 0; i < 40; i++) {
        s = (lo + hi) / 2
        if (bez(x1, x2, s) < p) lo = s
        else hi = s
      }
      return bez(y1, y2, s)
    }
  }
  const pow = Math.pow
  const t: Record<string, (p: number) => number> = {
    linear: p => p,
    inQuad: p => p * p,
    outQuad: p => 1 - (1 - p) * (1 - p),
    inOutQuad: p => p < 0.5 ? 2 * p * p : 1 - pow(-2 * p + 2, 2) / 2,
    inCubic: p => p * p * p,
    outCubic: p => 1 - pow(1 - p, 3),
    inOutCubic: p => p < 0.5 ? 4 * p * p * p : 1 - pow(-2 * p + 2, 3) / 2,
    outQuart: p => 1 - pow(1 - p, 4),
    inOutQuart: p => p < 0.5 ? 8 * p * p * p * p : 1 - pow(-2 * p + 2, 4) / 2,
    outQuint: p => 1 - pow(1 - p, 5),
    inOutQuint: p => p < 0.5 ? 16 * p * p * p * p * p : 1 - pow(-2 * p + 2, 5) / 2,
    outExpo: p => p === 1 ? 1 : 1 - pow(2, -10 * p),
    inExpo: p => p === 0 ? 0 : pow(2, 10 * p - 10),
    inOutExpo: p => p === 0 ? 0 : p === 1 ? 1 : p < 0.5 ? pow(2, 20 * p - 10) / 2 : (2 - pow(2, -20 * p + 10)) / 2,
    outBack: (p) => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * pow(p - 1, 3) + c1 * pow(p - 1, 2) },
    inOutBack: (p) => { const c2 = 1.70158 * 1.525; return p < 0.5 ? (pow(2 * p, 2) * ((c2 + 1) * 2 * p - c2)) / 2 : (pow(2 * p - 2, 2) * ((c2 + 1) * (p * 2 - 2) + c2) + 2) / 2 },
    spring: p => 1 - Math.cos(p * Math.PI * 4.5) * Math.exp(-p * 6)
  }
  return t[n] || t.inOutCubic!
}

// The value of a property at time t: one value as it is, keyframes interpolated with the easing of the key being
// approached. Numbers and colours blend; anything else switches when the next key is reached. Self-contained.
export function sampleTrack(prop: TrackProp, t: number, ease: (name: string | undefined) => (p: number) => number): TrackValue {
  if (!Array.isArray(prop)) return prop
  const keys = prop
  if (!keys.length) return 0
  if (t <= keys[0]![0]) return keys[0]![1]
  for (let i = 1; i < keys.length; i++) {
    const b = keys[i]!
    if (t > b[0]) continue
    const a = keys[i - 1]!
    const p = ease(b[2])(b[0] === a[0] ? 1 : (t - a[0]) / (b[0] - a[0]))
    if (typeof a[1] === 'number' && typeof b[1] === 'number') return a[1] + (b[1] - a[1]) * p
    const rgb = (v: TrackValue) => {
      const s = String(v).trim()
      let m = /^#([0-9a-f]{3,8})$/i.exec(s)
      if (m) {
        let h = m[1]!
        if (h.length <= 4) h = h.split('').map(c => c + c).join('')
        return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16), h.length >= 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1]
      }
      m = /^rgba?\(([^)]+)\)$/i.exec(s)
      if (m) { const n = m[1]!.split(/[\s,/]+/).filter(Boolean).map(Number); return [n[0]!, n[1]!, n[2]!, n[3] ?? 1] }
      return null
    }
    const ca = rgb(a[1]), cb = rgb(b[1])
    if (ca && cb) {
      const c = ca.map((v, j) => v + (cb[j]! - v) * Math.min(1, Math.max(0, p)))
      return `rgba(${Math.round(c[0]!)}, ${Math.round(c[1]!)}, ${Math.round(c[2]!)}, ${Math.round(c[3]! * 1000) / 1000})`
    }
    return p >= 1 ? b[1] : a[1]
  }
  return keys[keys.length - 1]![1]
}

const KEY_RE = /^(?:[a-zA-Z][\w-]{0,40}|css:.{1,300})$/
const EASE_RE = /^cubic\(\s*-?[\d.]+\s*,\s*-?[\d.]+\s*,\s*-?[\d.]+\s*,\s*-?[\d.]+\s*\)$/
const COLOR_RE = /^(#[0-9a-f]{3,8}|rgba?\([\d\s.,/%]+\))$/i

export const validEase = (e: unknown) => typeof e === 'string' && (EASE_NAMES.includes(e) || EASE_RE.test(e))
export const validTrackKey = (k: string) => KEY_RE.test(k)

function cleanValue(def: TrackPropDef, v: unknown): TrackValue | undefined {
  if (def.kind === 'boolean') return typeof v === 'boolean' ? v : undefined
  if (def.kind === 'color') return typeof v === 'string' && COLOR_RE.test(v.trim()) ? v.trim() : undefined
  const n = Number(v)
  if (typeof v === 'boolean' || v === null || v === '' || !Number.isFinite(n)) return undefined
  let x = Math.max(-100000, Math.min(100000, n))
  if (def.min !== undefined) x = Math.max(def.min, x)
  if (def.max !== undefined) x = Math.min(def.max, x)
  return Math.round(x * 1000) / 1000
}

// One property, checked: a value of the right kind, or keyframes sorted by time. Undefined when unusable.
export function cleanTrackProp(name: string, v: unknown): TrackProp | undefined {
  const def = TRACK_PROPS.find(p => p.name === name)
  if (!def) return undefined
  if (!Array.isArray(v)) return cleanValue(def, v)
  const keys: TrackKey[] = []
  for (const k of v.slice(0, 200)) {
    if (!Array.isArray(k)) continue
    const ms = Number(k[0])
    const val = cleanValue(def, k[1])
    if (!Number.isFinite(ms) || ms < 0 || ms > 600000 || val === undefined) continue
    keys.push(validEase(k[2]) ? [Math.round(ms), val, k[2] as string] : [Math.round(ms), val])
  }
  if (!keys.length) return undefined
  keys.sort((a, b) => a[0] - b[0])
  return keys
}

export const layerProps = (layer: any): Record<string, unknown> => layer?.props && typeof layer.props === 'object' ? layer.props : layer ?? {}

export function cleanTracks(v: unknown): Tracks {
  const out: Tracks = {}
  if (!v || typeof v !== 'object' || Array.isArray(v)) return out
  for (const [key, layer] of Object.entries(v as Record<string, any>).slice(0, 200)) {
    if (!validTrackKey(key) || !layer || typeof layer !== 'object') continue
    const props: Record<string, TrackProp> = {}
    // { "props": {...} }, or the properties written straight in.
    for (const [name, p] of Object.entries(layerProps(layer))) {
      const c = cleanTrackProp(name, p)
      if (c !== undefined) props[name] = c
    }
    if (Object.keys(props).length) out[key] = { props }
  }
  return out
}
