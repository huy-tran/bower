<script setup lang="ts">
import type { TrackKey } from '#shared/utils/tracks'

// The picked layer's keyframes on the scene's timeline, one row per keyframed property: click a diamond to select it
// (and jump there), drag it to retime it. A drop saves once.
const props = defineProps<{
  rows: { name: string, label: string, keys: TrackKey[], factor?: number, unit?: string }[]
  duration: number
  time: number
  fps: number
  selected: { name: string, index: number } | null
  disabled?: boolean
}>()
const emit = defineEmits<{
  select: [name: string, index: number]
  change: [name: string, keys: TrackKey[]]
  seek: [ms: number]
}>()

const lane = ref<HTMLElement>()
const drag = ref<{ name: string, index: number, ms: number } | null>(null)
const span = computed(() => Math.max(props.duration, ...props.rows.flatMap(r => r.keys.map(k => k[0]))) || 1)
const pct = (ms: number) => `${(ms / span.value) * 100}%`
const frame = computed(() => 1000 / (props.fps || 30))

function startDrag(name: string, index: number, keys: TrackKey[], e: PointerEvent) {
  if (props.disabled) return
  e.preventDefault()
  const el = e.currentTarget as HTMLElement
  el.setPointerCapture(e.pointerId)
  const r = lane.value!.getBoundingClientRect()
  const x0 = e.clientX, ms0 = keys[index]![0]
  let moved = false
  const move = (ev: PointerEvent) => {
    if (!moved && Math.abs(ev.clientX - x0) < 3) return
    moved = true
    const ms = Math.max(0, Math.round((ms0 + (ev.clientX - x0) / r.width * span.value) / frame.value) * frame.value)
    drag.value = { name, index, ms: Math.round(ms) }
  }
  const up = () => {
    el.removeEventListener('pointermove', move)
    el.removeEventListener('pointerup', up)
    const d = drag.value
    if (!moved || !d) {
      emit('select', name, index)
      emit('seek', ms0)
      return
    }
    // Moving onto another keyframe of the same property replaces it.
    const next = keys.map((k, j) => j === index ? [d.ms, k[1], k[2]].filter(x => x !== undefined) as TrackKey : k)
      .filter((k, j) => j === index || Math.abs(k[0] - d.ms) >= frame.value / 2)
    emit('change', name, next)
    setTimeout(() => { drag.value = null }, 1500)
  }
  el.addEventListener('pointermove', move)
  el.addEventListener('pointerup', up)
}
watch(() => props.rows, () => { drag.value = null })

const at = (name: string, index: number, k: TrackKey) => drag.value?.name === name && drag.value.index === index ? drag.value.ms : k[0]
</script>

<template>
  <div class="space-y-1">
    <div class="grid grid-cols-[6.5rem_minmax(0,1fr)] gap-x-2">
      <span />
      <div ref="lane" class="relative h-4 text-[10px] text-dimmed tabular-nums select-none">
        <span class="absolute left-0">0</span>
        <span class="absolute right-0">{{ (span / 1000).toFixed(1) }}s</span>
      </div>
    </div>
    <div class="relative">
      <div class="pointer-events-none absolute inset-y-0 right-0 left-[calc(6.5rem+0.5rem)]">
        <div class="absolute inset-y-0 z-10 w-px bg-primary" :style="{ left: pct(time) }" />
      </div>
      <div v-for="r in rows" :key="r.name" class="grid grid-cols-[6.5rem_minmax(0,1fr)] items-center gap-x-2 py-0.5">
        <span class="truncate text-xs text-muted">{{ r.label }}</span>
        <div class="relative h-6 rounded bg-muted">
          <!-- The stretch between the first and last keyframe. -->
          <div v-if="r.keys.length > 1" class="absolute inset-y-2.5 bg-primary/25" :style="{ left: pct(r.keys[0]![0]), width: pct(r.keys.at(-1)![0] - r.keys[0]![0]) }" />
          <button
            v-for="(k, i) in r.keys"
            :key="i"
            type="button"
            class="absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rotate-45 cursor-ew-resize border-[1.5px] border-primary transition-colors"
            :class="selected?.name === r.name && selected.index === i ? 'bg-primary ring-2 ring-primary/40' : 'bg-default hover:bg-primary/40'"
            :style="{ left: pct(at(r.name, i, k)) }"
            :title="`${r.label} at ${(k[0] / 1000).toFixed(2)}s: ${typeof k[1] === 'number' ? Math.round(k[1] * (r.factor ?? 1) * 100) / 100 + (r.unit ?? '') : k[1]}${k[2] ? `, ${k[2]}` : ''}. Click to select, drag to move.`"
            :aria-label="`${r.label} keyframe at ${(k[0] / 1000).toFixed(2)}s`"
            @pointerdown="startDrag(r.name, i, r.keys, $event)"
          />
        </div>
      </div>
    </div>
  </div>
</template>
