<script setup lang="ts">
const props = defineProps<{
  duration: number
  time: number
  marks: { beats: number[], downbeats: number[], phrases: number[] } | null
  cuts?: { at: number, title: string }[]
  // Waveform peaks sampled over the visible range.
  wave?: number[]
}>()

const emit = defineEmits<{ seek: [t: number], scrub: [active: boolean] }>()

const track = ref<HTMLElement>()
const dragging = ref(false)
const pct = (t: number) => `${props.duration ? Math.min(100, Math.max(0, t / props.duration * 100)) : 0}%`

const ticks = computed(() => {
  const d = props.duration / 1000
  const step = d > 60 ? 10 : d > 20 ? 5 : d > 8 ? 2 : 1
  const out: number[] = []
  for (let s = 0; s <= d + 0.001; s += step) out.push(s)
  return out
})

const wavePath = computed(() => {
  const w = props.wave
  if (!w?.length) return ''
  const n = w.length
  const top = w.map((v, i) => `${(i / (n - 1)) * 1000},${50 - v * 48}`)
  const bottom = w.map((v, i) => `${((n - 1 - i) / (n - 1)) * 1000},${50 + w[n - 1 - i]! * 48}`)
  return `M${top.join('L')}L${bottom.join('L')}Z`
})

function timeAt(e: PointerEvent) {
  const r = track.value!.getBoundingClientRect()
  return Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * props.duration
}

function down(e: PointerEvent) {
  dragging.value = true
  emit('scrub', true)
  ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  emit('seek', timeAt(e))
}
function move(e: PointerEvent) {
  if (dragging.value) emit('seek', timeAt(e))
}
function up() {
  if (!dragging.value) return
  dragging.value = false
  emit('scrub', false)
}
</script>

<template>
  <div class="select-none">
    <div
      ref="track"
      class="group relative h-9 cursor-pointer touch-none"
      @pointerdown="down"
      @pointermove="move"
      @pointerup="up"
      @pointercancel="up"
    >
      <svg v-if="wavePath" class="pointer-events-none absolute inset-x-0 top-0 h-6 w-full text-zinc-200" viewBox="0 0 1000 100" preserveAspectRatio="none">
        <path :d="wavePath" fill="currentColor" />
      </svg>
      <template v-if="marks">
        <span v-for="b in marks.beats" :key="`b${b}`" class="pointer-events-none absolute top-4 h-2 w-px bg-zinc-400" :style="{ left: pct(b) }" />
        <span v-for="b in marks.downbeats" :key="`d${b}`" class="pointer-events-none absolute top-2.5 h-3.5 w-px bg-zinc-700" :style="{ left: pct(b) }" />
        <span v-for="b in marks.phrases" :key="`p${b}`" class="pointer-events-none absolute top-1 h-5 w-0.5 -translate-x-1/2 rounded bg-violet-400" :style="{ left: pct(b) }" />
      </template>
      <span v-for="c in cuts" :key="`c${c.at}`" class="pointer-events-none absolute top-0 h-7 w-px bg-zinc-900/40" :style="{ left: pct(c.at) }" />
      <div class="absolute inset-x-0 top-6 h-1.5 rounded-full bg-zinc-200">
        <div class="h-full rounded-full bg-zinc-800" :style="{ width: pct(time) }" />
      </div>
      <div
        class="absolute top-3.5 h-6 w-1.5 -translate-x-1/2 rounded-full bg-blue-500 shadow ring-2 ring-white transition-transform group-hover:scale-110"
        :style="{ left: pct(time) }"
      />
    </div>
    <div class="relative h-4 font-mono text-[10px] text-zinc-400">
      <span v-for="s in ticks" :key="s" class="absolute -translate-x-1/2" :style="{ left: pct(s * 1000) }">{{ s }}s</span>
    </div>
  </div>
</template>
