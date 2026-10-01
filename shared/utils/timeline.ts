// Timeline maths shared by the editor, the exported web player and the renderer.
// `layersAt` is also shipped to the web player via Function.prototype.toString, so it must stay
// self-contained: no imports, no references to anything outside its own body, no inner functions.

export type TransitionType = 'cut' | 'crossfade' | 'push' | 'slide-up' | 'wipe' | 'zoom' | 'blur'

export interface Transition { type: TransitionType, duration: number }

export interface TimelineScene { id: string, start: number, duration: number, transition?: Transition | null }

export interface Layer {
  index: number
  t: number
  opacity: number
  transform: string
  clip: string
  filter: string
  z: number
}

export const TRANSITIONS: { value: TransitionType, label: string }[] = [
  { value: 'cut', label: 'Cut' },
  { value: 'crossfade', label: 'Crossfade' },
  { value: 'push', label: 'Push left' },
  { value: 'slide-up', label: 'Slide up' },
  { value: 'wipe', label: 'Wipe' },
  { value: 'zoom', label: 'Zoom through' },
  { value: 'blur', label: 'Blur dissolve' }
]

// Scenes on screen at global time g (ms). A transition into scene k is centred on its cut, so the
// total running time never changes: the outgoing scene holds its last frame, the incoming one its first.
export function layersAt(scenes: TimelineScene[], g: number): Layer[] {
  const n = scenes.length
  if (!n) return []
  let i = 0
  while (i < n - 1 && g >= scenes[i]!.start + scenes[i]!.duration) i++

  let k = -1
  let p = 0
  for (let c = Math.max(1, i); c <= Math.min(n - 1, i + 1); c++) {
    const tr = scenes[c]!.transition
    if (!tr || tr.type === 'cut' || !(tr.duration > 0)) continue
    const half = tr.duration / 2
    const at = scenes[c]!.start
    if (g >= at - half && g < at + half) {
      k = c
      p = (g - (at - half)) / tr.duration
      break
    }
  }

  const cur = scenes[i]!
  if (k < 0) {
    return [{ index: i, t: Math.max(0, Math.min(g - cur.start, cur.duration)), opacity: 1, transform: '', clip: '', filter: '', z: 1 }]
  }

  const e = p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2
  const A = scenes[k - 1]!
  const B = scenes[k]!
  const a: Layer = { index: k - 1, t: Math.max(0, Math.min(g - A.start, A.duration)), opacity: 1, transform: '', clip: '', filter: '', z: 1 }
  const b: Layer = { index: k, t: Math.max(0, Math.min(g - B.start, B.duration)), opacity: 1, transform: '', clip: '', filter: '', z: 2 }
  const type = B.transition!.type

  if (type === 'crossfade') {
    b.opacity = e
  } else if (type === 'push') {
    a.transform = `translateX(${-e * 100}%)`
    b.transform = `translateX(${(1 - e) * 100}%)`
  } else if (type === 'slide-up') {
    a.transform = `translateY(${-e * 30}%) scale(${1 - e * 0.06})`
    a.opacity = 1 - e * 0.6
    b.transform = `translateY(${(1 - e) * 100}%)`
  } else if (type === 'wipe') {
    b.clip = `inset(0 ${(1 - e) * 100}% 0 0)`
  } else if (type === 'zoom') {
    a.transform = `scale(${1 + e * 0.35})`
    a.opacity = 1 - e
    b.transform = `scale(${0.85 + e * 0.15})`
    b.opacity = e
  } else if (type === 'blur') {
    a.filter = `blur(${e * 24}px)`
    b.filter = `blur(${(1 - e) * 24}px)`
    b.opacity = e
  }
  return [a, b]
}

export interface GainAudio { gain?: number, fadeIn?: number, fadeOut?: number, duck?: number }
export interface GainClip { kind: 'sfx' | 'voice', start: number, duration: number }

export const DUCK_RAMP = 250

// Music level at video time t: base gain, fade in from 0, fade out to the end, and a smooth dip while any
// voice-over clip plays. Self-contained for the same reason as layersAt. The renderer builds the same curve in ffmpeg.
export function musicGainAt(audio: GainAudio, clips: GainClip[], total: number, t: number): number {
  let v = audio.gain ?? 1
  const fi = audio.fadeIn ?? 0
  const fo = audio.fadeOut ?? 0
  if (fi > 0) v *= Math.min(1, Math.max(0, t / fi))
  if (fo > 0) v *= Math.min(1, Math.max(0, (total - t) / fo))
  const duck = audio.duck ?? 1
  if (duck < 1) {
    const r = 250
    let w = 0
    for (const c of clips) {
      if (c.kind !== 'voice' || !(c.duration > 0)) continue
      const up = Math.min(1, Math.max(0, (t - (c.start - r)) / r))
      const down = Math.min(1, Math.max(0, (c.start + c.duration + r - t) / r))
      w = Math.max(w, Math.min(up, down))
    }
    v *= 1 - (1 - duck) * w
  }
  return v
}

export interface Caption { start: number, end: number, text: string }

// The caption line showing at global time g, if any. Clip-relative captions are shifted by the clip start.
export function captionAt(clips: { start: number, captions?: Caption[] | null }[], g: number): string {
  for (const c of clips) {
    for (const cap of c.captions ?? []) {
      if (g >= c.start + cap.start && g < c.start + cap.end) return cap.text
    }
  }
  return ''
}
