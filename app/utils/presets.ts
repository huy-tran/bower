import type { TrackKey } from '#shared/utils/tracks'

// Animation presets: keyframes added to the picked element at the playhead. Entrances start at the playhead and
// end on the element's resting values; exits leave from them. `rest(name)` is the value a property has where the
// preset lands (or leaves from), so a preset works on an element that already moves or sits somewhere else.
export interface AnimPreset {
  id: string
  label: string
  icon: string
  kind: 'in' | 'out'
  // How long it runs, in ms.
  dur: number
  keys: (t: number, d: number, rest: (name: string) => number) => Record<string, TrackKey[]>
}

const fadeIn = (t: number, d: number, rest: (n: string) => number): TrackKey[] => [[t, 0], [t + d, rest('opacity'), 'outCubic']]
const fadeOut = (t: number, d: number, rest: (n: string) => number): TrackKey[] => [[t, rest('opacity')], [t + d, 0, 'inCubic']]

export const PRESETS: AnimPreset[] = [
  { id: 'fade-in', label: 'Fade in', icon: 'i-lucide-sunrise', kind: 'in', dur: 500, keys: (t, d, r) => ({ opacity: fadeIn(t, d, r) }) },
  { id: 'slide-up', label: 'Slide up', icon: 'i-lucide-arrow-up', kind: 'in', dur: 700, keys: (t, d, r) => ({ y: [[t, r('y') + 80], [t + d, r('y'), 'outExpo']], opacity: fadeIn(t, d * 0.7, r) }) },
  { id: 'slide-left', label: 'From the left', icon: 'i-lucide-arrow-right', kind: 'in', dur: 700, keys: (t, d, r) => ({ x: [[t, r('x') - 160], [t + d, r('x'), 'outExpo']], opacity: fadeIn(t, d * 0.7, r) }) },
  { id: 'slide-right', label: 'From the right', icon: 'i-lucide-arrow-left', kind: 'in', dur: 700, keys: (t, d, r) => ({ x: [[t, r('x') + 160], [t + d, r('x'), 'outExpo']], opacity: fadeIn(t, d * 0.7, r) }) },
  { id: 'pop', label: 'Pop', icon: 'i-lucide-zap', kind: 'in', dur: 600, keys: (t, d, r) => ({ scale: [[t, r('scale') * 0.6], [t + d, r('scale'), 'outBack']], opacity: fadeIn(t, d * 0.5, r) }) },
  { id: 'zoom-in', label: 'Zoom in', icon: 'i-lucide-zoom-in', kind: 'in', dur: 800, keys: (t, d, r) => ({ scale: [[t, r('scale') * 1.25], [t + d, r('scale'), 'outExpo']], opacity: fadeIn(t, d * 0.6, r) }) },
  { id: 'blur-in', label: 'Blur in', icon: 'i-lucide-droplet', kind: 'in', dur: 700, keys: (t, d, r) => ({ blur: [[t, 24], [t + d, r('blur'), 'outCubic']], opacity: fadeIn(t, d * 0.8, r) }) },
  { id: 'typewriter', label: 'Typewriter', icon: 'i-lucide-keyboard', kind: 'in', dur: 1200, keys: (t, d) => ({ typed: [[t, 0], [t + d, 1, 'linear']] }) },
  { id: 'fade-out', label: 'Fade out', icon: 'i-lucide-sunset', kind: 'out', dur: 400, keys: (t, d, r) => ({ opacity: fadeOut(t, d, r) }) },
  { id: 'slide-down-out', label: 'Slide down', icon: 'i-lucide-arrow-down', kind: 'out', dur: 500, keys: (t, d, r) => ({ y: [[t, r('y')], [t + d, r('y') + 80, 'inCubic']], opacity: fadeOut(t, d, r) }) },
  { id: 'shrink-out', label: 'Shrink', icon: 'i-lucide-minimize-2', kind: 'out', dur: 450, keys: (t, d, r) => ({ scale: [[t, r('scale')], [t + d, r('scale') * 0.6, 'inCubic']], opacity: fadeOut(t, d, r) }) },
  { id: 'blur-out', label: 'Blur out', icon: 'i-lucide-cloud-fog', kind: 'out', dur: 500, keys: (t, d, r) => ({ blur: [[t, r('blur')], [t + d, 24, 'inCubic']], opacity: fadeOut(t, d, r) }) }
]

// Named easings offered for a keyframe, plus a custom curve.
export const EASE_PRESETS = [
  { label: 'Linear', value: 'linear' },
  { label: 'Ease', value: 'inOutCubic' },
  { label: 'Ease in', value: 'inCubic' },
  { label: 'Ease out', value: 'outCubic' },
  { label: 'Strong ease out', value: 'outExpo' },
  { label: 'Gentle ease out', value: 'outQuint' },
  { label: 'Overshoot', value: 'outBack' },
  { label: 'Spring', value: 'spring' }
]
