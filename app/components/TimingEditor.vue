<script setup lang="ts">
import type { Timing, TimingStart } from '~/composables/useSceneEdit'

// The scene's animations as bars on a timeline: drag a bar to move it, its edges to change when it starts or how
// long it runs, and the end marker to change the scene's length. Each drop saves once.
const props = defineProps<{
  timings: Timing[]
  computed: number
  duration: number
  time: number
  disabled?: boolean
}>()
const emit = defineEmits<{
  change: [timing: Timing, next: { start: TimingStart, dur: number, ease: string | null }]
  duration: [ms: number]
  seek: [ms: number]
}>()

const EASES = ['linear', 'inQuad', 'outQuad', 'inOutQuad', 'inCubic', 'outCubic', 'inOutCubic', 'outQuart', 'inOutQuart', 'outQuint', 'inOutQuint', 'inExpo', 'outExpo', 'inOutExpo', 'outBack', 'inOutBack', 'spring']
const easeItems = [{ label: 'Default (inOutCubic)', value: '' }, ...EASES.map(e => ({ label: e, value: e }))]

// While dragging, the bar shows where it will land; nothing is saved until the drop.
const drag = ref<{ offset: number, start: number, dur: number } | null>(null)
const endDrag = ref<number | null>(null)
const open = ref<number | null>(null)
const lane = ref<HTMLElement>()

// The visible range runs a little past the scene's end, so its end marker can be dragged out.
const span = computed(() => Math.max(props.duration, endDrag.value ?? 0, ...props.timings.map(t => absStart(t) + t.dur)) * 1.15)
const pct = (ms: number) => `${(ms / span.value) * 100}%`

function absStart(t: Timing, duration = props.duration) {
  return t.start.kind === 'end' ? duration - t.start.ms : t.start.ms
}
function withAbs(t: Timing, abs: number): TimingStart {
  const ms = Math.max(0, Math.round(abs / 10) * 10)
  return t.start.kind === 'end' ? { kind: 'end', ms: Math.max(0, props.duration - ms) } : { ...t.start, ms }
}

const ticks = computed(() => {
  const step = span.value > 8000 ? 1000 : span.value > 3000 ? 500 : 250
  return Array.from({ length: Math.floor(span.value / step) + 1 }, (_, i) => i * step)
})

function msAt(e: PointerEvent) {
  const r = lane.value!.getBoundingClientRect()
  return ((e.clientX - r.left) / r.width) * span.value
}

function startDrag(t: Timing, part: 'move' | 'left' | 'right', e: PointerEvent) {
  if (props.disabled) return
  e.preventDefault()
  const from = msAt(e)
  const s0 = absStart(t), d0 = t.dur
  drag.value = { offset: t.offset, start: s0, dur: d0 }
  const snap = (v: number) => Math.round(v / 10) * 10
  const move = (ev: PointerEvent) => {
    const dx = msAt(ev) - from
    if (part === 'move') drag.value = { offset: t.offset, start: Math.max(0, snap(s0 + dx)), dur: d0 }
    else if (part === 'right') drag.value = { offset: t.offset, start: s0, dur: Math.max(0, snap(d0 + dx)) }
    else {
      const s = Math.min(s0 + d0, Math.max(0, snap(s0 + dx)))
      drag.value = { offset: t.offset, start: s, dur: s0 + d0 - s }
    }
  }
  const up = () => {
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', up)
    const d = drag.value
    if (d && (d.start !== s0 || d.dur !== d0)) emit('change', t, { start: withAbs(t, d.start), dur: d.dur, ease: t.ease })
    else if (part === 'move') emit('seek', s0)
    // The bar keeps its dragged place until the saved scene comes back.
    setTimeout(() => { drag.value = null }, d && (d.start !== s0 || d.dur !== d0) ? 1500 : 0)
  }
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', up)
}
watch(() => props.timings, () => { drag.value = null })

function startEndDrag(e: PointerEvent) {
  if (props.disabled) return
  e.preventDefault()
  const move = (ev: PointerEvent) => { endDrag.value = Math.max(100, Math.round(msAt(ev) / 10) * 10) }
  const up = () => {
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', up)
    if (endDrag.value && endDrag.value !== props.duration) emit('duration', endDrag.value)
    setTimeout(() => { endDrag.value = null }, 1500)
  }
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', up)
}
watch(() => props.duration, () => { endDrag.value = null })

const barOf = (t: Timing) => drag.value?.offset === t.offset ? drag.value : { start: absStart(t), dur: t.dur }
const sceneEnd = computed(() => endDrag.value ?? props.duration)

// Typed values, for exact numbers.
function setField(t: Timing, field: 'start' | 'dur' | 'step' | 'ease', raw: string | number) {
  const v = Number(raw)
  if (field === 'ease') return emit('change', t, { start: t.start, dur: t.dur, ease: String(raw) || null })
  if (!Number.isFinite(v) || v < 0) return
  if (field === 'dur') return v !== t.dur && emit('change', t, { start: t.start, dur: v, ease: t.ease })
  if (field === 'step' && t.start.kind === 'stagger') return v !== t.start.step && emit('change', t, { start: { ...t.start, step: v }, dur: t.dur, ease: t.ease })
  if (field === 'start' && v !== t.start.ms) emit('change', t, { start: { ...t.start, ms: v }, dur: t.dur, ease: t.ease })
}
const fmt = (ms: number) => `${(ms / 1000).toFixed(2)}s`
</script>

<template>
  <div class="space-y-2">
    <div class="grid grid-cols-[7rem_minmax(0,1fr)] items-end gap-x-2">
      <span class="text-xs text-muted">Scene {{ fmt(sceneEnd) }}</span>
      <div ref="lane" class="relative h-5 text-[10px] text-dimmed tabular-nums select-none">
        <span v-for="tk in ticks" :key="tk" class="absolute bottom-0 -translate-x-1/2" :style="{ left: pct(tk) }">{{ tk / 1000 }}</span>
      </div>
    </div>

    <div class="relative">
      <!-- Playhead and scene end span every row. -->
      <div class="pointer-events-none absolute inset-y-0 right-0 left-[calc(7rem+0.5rem)]">
        <div class="absolute inset-y-0 w-px bg-primary" :style="{ left: pct(time) }" />
        <div class="absolute inset-y-0 right-0 bg-elevated/70" :style="{ left: pct(sceneEnd) }" />
      </div>

      <div v-for="t in timings" :key="t.offset" class="relative">
        <div class="grid grid-cols-[7rem_minmax(0,1fr)] items-center gap-x-2 py-0.5">
          <button type="button" class="truncate rounded px-1 py-0.5 text-left font-mono text-xs text-default hover:bg-elevated" :class="open === t.offset && 'bg-elevated'" :title="t.line" @click="open = open === t.offset ? null : t.offset">
            {{ t.label }}
          </button>
          <div class="relative h-6 rounded bg-muted">
            <div
              class="group absolute inset-y-0.5 flex min-w-1.5 cursor-grab items-center rounded bg-primary/80 active:cursor-grabbing"
              :class="disabled && 'cursor-not-allowed opacity-50'"
              :style="{ left: pct(barOf(t).start), width: pct(barOf(t).dur) }"
              :title="`${t.label}: starts ${fmt(barOf(t).start)}, lasts ${fmt(barOf(t).dur)}${t.ease ? `, ${t.ease}` : ''}. Drag to move, drag an edge to resize.`"
              @pointerdown="startDrag(t, 'move', $event)"
            >
              <span class="absolute inset-y-0 left-0 w-1.5 cursor-ew-resize rounded-l bg-primary opacity-0 group-hover:opacity-100" @pointerdown.stop="startDrag(t, 'left', $event)" />
              <span class="absolute inset-y-0 right-0 w-1.5 cursor-ew-resize rounded-r bg-primary opacity-0 group-hover:opacity-100" @pointerdown.stop="startDrag(t, 'right', $event)" />
            </div>
            <!-- A staggered animation repeats for each item, one step later each time. -->
            <template v-if="t.start.kind === 'stagger'">
              <div v-for="n in 3" :key="n" class="pointer-events-none absolute inset-y-1.5 rounded border border-dashed border-primary/50" :style="{ left: pct(barOf(t).start + n * t.start.step), width: pct(barOf(t).dur) }" />
            </template>
          </div>
        </div>
        <div v-if="open === t.offset" class="mb-2 ml-[7.5rem] space-y-2 rounded-md bg-elevated/60 p-2">
          <code class="block truncate text-[11px] text-muted" :title="t.line">{{ t.line }}</code>
          <div class="flex flex-wrap items-end gap-2">
            <UFormField :label="t.start.kind === 'end' ? 'Before the end (ms)' : t.start.kind === 'stagger' ? 'First starts (ms)' : 'Starts (ms)'" size="xs">
              <UInput :model-value="t.start.ms" type="number" min="0" step="10" size="xs" class="w-24" :disabled="disabled" @change="setField(t, 'start', ($event.target as HTMLInputElement).value)" />
            </UFormField>
            <UFormField v-if="t.start.kind === 'stagger'" label="Each next (ms)" size="xs">
              <UInput :model-value="t.start.step" type="number" min="0" step="5" size="xs" class="w-20" :disabled="disabled" @change="setField(t, 'step', ($event.target as HTMLInputElement).value)" />
            </UFormField>
            <UFormField label="Lasts (ms)" size="xs">
              <UInput :model-value="t.dur" type="number" min="0" step="10" size="xs" class="w-24" :disabled="disabled" @change="setField(t, 'dur', ($event.target as HTMLInputElement).value)" />
            </UFormField>
            <UFormField label="Easing" size="xs">
              <USelect :model-value="t.ease ?? ''" :items="easeItems" size="xs" class="w-36" :disabled="disabled" @update:model-value="v => setField(t, 'ease', String(v ?? ''))" />
            </UFormField>
          </div>
        </div>
      </div>

      <!-- The scene's end: drag it to make the scene longer or shorter. -->
      <div class="pointer-events-none absolute inset-y-0 right-0 left-[calc(7rem+0.5rem)]">
        <div
          class="pointer-events-auto absolute inset-y-0 -ml-1.5 w-3 cursor-ew-resize"
          :class="disabled && 'pointer-events-none'"
          :style="{ left: pct(sceneEnd) }"
          title="Scene end: drag to make the scene longer or shorter"
          @pointerdown="startEndDrag"
        >
          <div class="mx-auto h-full w-0.5 bg-inverted/60" />
        </div>
      </div>
    </div>

    <p v-if="!timings.length" class="text-xs text-muted">
      No animations with plain-number timings in this scene. Ask Claude to write them as <code>VE.progress(t, start, duration)</code> with numbers so they show here.
    </p>
    <p v-else-if="computed" class="text-xs text-muted">
      {{ computed }} more {{ computed === 1 ? 'animation works out its' : 'animations work out their' }} timing in code, so {{ computed === 1 ? 'it is' : 'they are' }} not shown. Ask Claude to change {{ computed === 1 ? 'it' : 'them' }}.
    </p>
  </div>
</template>
