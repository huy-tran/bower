<script setup lang="ts">
import type { Section } from '~/composables/useEditor'

const props = defineProps<{
  duration: number
  time: number
  playing?: boolean
  marks: { beats: number[], downbeats: number[], phrases: number[], sections: Section[] } | null
  cuts?: { at: number, title: string }[]
  clips?: { id: string, kind: 'sfx' | 'voice', name: string, start: number, end: number }[]
  // Waveform peaks sampled over the whole timeline.
  wave?: number[]
  loop?: { from: number, to: number } | null
  // Visible window as fractions of the timeline (zoom).
  view: { from: number, to: number }
}>()

const emit = defineEmits<{
  seek: [t: number]
  scrub: [active: boolean]
  loop: [from: number | null, to?: number]
  view: [from: number, to: number]
}>()

const track = ref<HTMLElement>()
const drag = ref<null | 'seek' | 'loop'>(null)
let anchor = 0

const vFrom = computed(() => props.view.from * props.duration)
const vTo = computed(() => props.view.to * props.duration)
const span = computed(() => Math.max(1, vTo.value - vFrom.value))
const zoomed = computed(() => props.view.to - props.view.from < 0.999)
const pct = (t: number) => `${(t - vFrom.value) / span.value * 100}%`
const width = (a: number, b: number) => `${Math.max(0, (Math.min(b, vTo.value) - Math.max(a, vFrom.value)) / span.value * 100)}%`
const visible = (t: number) => t >= vFrom.value - 1 && t <= vTo.value + 1

const ticks = computed(() => {
  const d = span.value / 1000
  const step = [0.1, 0.25, 0.5, 1, 2, 5, 10, 30, 60].find(s => d / s <= 12) ?? 60
  const out: number[] = []
  for (let s = Math.ceil(vFrom.value / 1000 / step) * step; s <= vTo.value / 1000 + 1e-6; s += step) out.push(Math.round(s * 1000) / 1000)
  return { list: out, digits: step < 1 ? (step < 0.25 ? 1 : 2) : 0 }
})

const SECTION_COLORS: Record<string, string> = {
  intro: 'bg-sky-300/70', verse: 'bg-emerald-300/70', build: 'bg-amber-300/80', drop: 'bg-rose-400/80',
  chorus: 'bg-rose-400/80', breakdown: 'bg-indigo-300/70', bridge: 'bg-indigo-300/70', outro: 'bg-slate-300/80'
}
const sectionColor = (label: string) => SECTION_COLORS[label] ?? 'bg-(--ui-border-accented)'

const wavePath = computed(() => {
  const w = props.wave
  if (!w?.length) return ''
  const i0 = Math.floor(props.view.from * w.length), i1 = Math.ceil(props.view.to * w.length)
  const slice = w.slice(i0, Math.max(i0 + 2, i1))
  const step = Math.max(1, Math.floor(slice.length / 400))
  const pts: number[] = []
  for (let i = 0; i < slice.length; i += step) pts.push(Math.max(...slice.slice(i, i + step)))
  const n = pts.length
  if (n < 2) return ''
  const top = pts.map((v, i) => `${(i / (n - 1)) * 1000},${50 - v * 48}`)
  const bottom = pts.map((_, i) => `${((n - 1 - i) / (n - 1)) * 1000},${50 + pts[n - 1 - i]! * 48}`)
  return `M${top.join('L')}L${bottom.join('L')}Z`
})

function timeAt(e: PointerEvent | WheelEvent) {
  const r = track.value!.getBoundingClientRect()
  return vFrom.value + Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * span.value
}

function down(e: PointerEvent) {
  ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  if (e.shiftKey) {
    drag.value = 'loop'
    anchor = timeAt(e)
    emit('loop', null)
    return
  }
  drag.value = 'seek'
  emit('scrub', true)
  emit('seek', timeAt(e))
}
function move(e: PointerEvent) {
  if (drag.value === 'seek') emit('seek', timeAt(e))
  else if (drag.value === 'loop') emit('loop', anchor, timeAt(e))
}
function up() {
  if (drag.value === 'seek') emit('scrub', false)
  drag.value = null
}

// Ctrl/⌘ + wheel zooms around the pointer; the plain wheel pans once zoomed in.
function wheel(e: WheelEvent) {
  const f = props.view.from, t = props.view.to, s = t - f
  if (e.ctrlKey || e.metaKey) {
    e.preventDefault()
    const at = timeAt(e) / props.duration
    const next = Math.min(1, Math.max(0.02, s * (e.deltaY > 0 ? 1.25 : 0.8)))
    const k = (at - f) / s
    emit('view', at - k * next, at - k * next + next)
  } else if (zoomed.value) {
    e.preventDefault()
    const d = (Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY) / 1000 * s
    emit('view', f + d, t + d)
  }
}

// Keep the playhead in view while playing.
watch(() => props.time, (t) => {
  if (!props.playing || !zoomed.value) return
  if (t > vTo.value || t < vFrom.value) {
    const s = props.view.to - props.view.from
    const at = t / props.duration
    emit('view', at - s * 0.1, at - s * 0.1 + s)
  }
})
</script>

<template>
  <div class="select-none">
    <div
      ref="track"
      class="group relative h-12 cursor-pointer touch-none overflow-hidden"
      title="Click to seek · Shift-drag to loop a region · Ctrl/⌘ + scroll to zoom"
      @pointerdown="down"
      @pointermove="move"
      @pointerup="up"
      @pointercancel="up"
      @wheel="wheel"
    >
      <!-- Music sections -->
      <template v-if="marks?.sections.length">
        <div
          v-for="s in marks.sections"
          :key="`s${s.start}`"
          class="pointer-events-none absolute top-0 h-2 rounded-sm"
          :class="sectionColor(s.label)"
          :style="{ left: pct(Math.max(s.start, vFrom)), width: width(s.start, s.end) }"
        />
      </template>
      <svg v-if="wavePath" class="pointer-events-none absolute inset-x-0 top-2.5 h-6 w-full text-(--ui-border-accented)" viewBox="0 0 1000 100" preserveAspectRatio="none">
        <path :d="wavePath" fill="currentColor" />
      </svg>
      <template v-if="marks">
        <span v-for="b in marks.beats.filter(visible)" :key="`b${b}`" class="pointer-events-none absolute top-6 h-2 w-px bg-accented" :style="{ left: pct(b) }" />
        <span v-for="b in marks.downbeats.filter(visible)" :key="`d${b}`" class="pointer-events-none absolute top-4.5 h-3.5 w-px bg-inverted/60" :style="{ left: pct(b) }" />
        <span v-for="b in marks.phrases.filter(visible)" :key="`p${b}`" class="pointer-events-none absolute top-3 h-5 w-0.5 -translate-x-1/2 rounded bg-primary" :style="{ left: pct(b) }" />
      </template>
      <span v-for="c in (cuts ?? []).filter(c => visible(c.at))" :key="`c${c.at}`" class="pointer-events-none absolute top-2 h-7 w-px bg-inverted/40" :style="{ left: pct(c.at) }" />

      <!-- Loop region -->
      <div
        v-if="loop"
        class="pointer-events-none absolute inset-y-0 border-x-2 border-primary bg-primary/10"
        :style="{ left: pct(Math.max(loop.from, vFrom)), width: width(loop.from, loop.to) }"
      />

      <div class="absolute inset-x-0 top-8 h-1.5 rounded-full bg-accented">
        <div class="h-full rounded-full bg-inverted" :style="{ width: `${Math.min(100, Math.max(0, (time - vFrom) / span * 100))}%` }" />
      </div>

      <!-- Sound clips -->
      <div
        v-for="c in clips ?? []"
        :key="c.id"
        class="pointer-events-none absolute top-10.5 h-1.5 rounded-full"
        :class="c.kind === 'voice' ? 'bg-sky-500/80' : 'bg-amber-500/80'"
        :style="{ left: pct(Math.max(c.start, vFrom)), width: width(c.start, c.end) }"
      />

      <div
        v-if="visible(time)"
        class="absolute top-5.5 h-6 w-1.5 -translate-x-1/2 rounded-full bg-primary shadow ring-2 ring-(--ui-bg) transition-transform group-hover:scale-110"
        :style="{ left: pct(time) }"
      />
    </div>
    <div class="relative h-4 font-mono text-[10px] text-dimmed">
      <span v-for="s in ticks.list" :key="s" class="absolute -translate-x-1/2" :style="{ left: pct(s * 1000) }">{{ s.toFixed(ticks.digits) }}s</span>
    </div>
  </div>
</template>
