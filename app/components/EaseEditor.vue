<script setup lang="ts">
import { easeFn } from '#shared/utils/tracks'
import { EASE_PRESETS } from '~/utils/presets'

// The easing into a keyframe: a named one, or a custom curve whose two handles are dragged, as in a graph editor.
const props = defineProps<{ modelValue: string | undefined, disabled?: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [v: string] }>()

const CUSTOM = 'custom'
const parse = (v: string | undefined) => {
  const m = /^cubic\(([^)]+)\)$/.exec(v ?? '')
  return m ? m[1]!.split(',').map(Number) as [number, number, number, number] : null
}
const handles = ref<[number, number, number, number] | null>(parse(props.modelValue))
watch(() => props.modelValue, v => { handles.value = parse(v) })

const items = computed(() => [
  ...EASE_PRESETS,
  ...(props.modelValue && !parse(props.modelValue) && !EASE_PRESETS.some(e => e.value === props.modelValue) ? [{ label: props.modelValue, value: props.modelValue }] : []),
  { label: 'Custom curve', value: CUSTOM }
])
const choice = computed({
  get: () => parse(props.modelValue) ? CUSTOM : props.modelValue || 'inOutCubic',
  set: (v: string) => emit('update:modelValue', v === CUSTOM ? 'cubic(0.25, 0.1, 0.25, 1)' : v)
})

// The curve, in a 100x100 box with room above and below for overshoot.
const S = 100, PAD = 30
const current = computed(() => handles.value ? `cubic(${handles.value.join(',')})` : props.modelValue)
const curve = computed(() => {
  const f = easeFn(current.value)
  return Array.from({ length: 61 }, (_, i) => {
    const p = i / 60
    return `${p * S},${PAD + S - f(p) * S}`
  }).join(' ')
})
const pt = (x: number, y: number) => ({ x: x * S, y: PAD + S - y * S })

const svg = ref<SVGSVGElement>()
function drag(which: 0 | 1, e: PointerEvent) {
  if (!handles.value || props.disabled) return
  const el = e.currentTarget as SVGElement
  el.setPointerCapture(e.pointerId)
  const move = (ev: PointerEvent) => {
    const r = svg.value!.getBoundingClientRect()
    const x = Math.min(1, Math.max(0, (ev.clientX - r.left) / r.width * (S / S)))
    const y = Math.min(2, Math.max(-1, (PAD + S - (ev.clientY - r.top) / r.height * (S + 2 * PAD)) / S))
    const h = [...handles.value!] as [number, number, number, number]
    h[which * 2] = Math.round(x * 100) / 100
    h[which * 2 + 1] = Math.round(y * 100) / 100
    handles.value = h
  }
  const up = () => {
    el.removeEventListener('pointermove', move)
    el.removeEventListener('pointerup', up)
    emit('update:modelValue', `cubic(${handles.value!.join(', ')})`)
  }
  el.addEventListener('pointermove', move)
  el.addEventListener('pointerup', up)
}
</script>

<template>
  <div class="flex items-start gap-3">
    <svg ref="svg" :viewBox="`0 0 ${S} ${S + 2 * PAD}`" class="h-28 w-[4.3rem] shrink-0 overflow-visible rounded bg-muted ring-1 ring-default">
      <rect x="0" :y="PAD" :width="S" :height="S" fill="none" class="stroke-(--ui-border)" stroke-width="1" />
      <polyline :points="curve" fill="none" class="stroke-(--ui-primary)" stroke-width="3" vector-effect="non-scaling-stroke" />
      <template v-if="handles">
        <line :x1="0" :y1="PAD + S" :x2="pt(handles[0], handles[1]).x" :y2="pt(handles[0], handles[1]).y" class="stroke-(--ui-text-muted)" stroke-width="1" vector-effect="non-scaling-stroke" />
        <line :x1="S" :y1="PAD" :x2="pt(handles[2], handles[3]).x" :y2="pt(handles[2], handles[3]).y" class="stroke-(--ui-text-muted)" stroke-width="1" vector-effect="non-scaling-stroke" />
        <circle v-for="w in ([0, 1] as const)" :key="w" :cx="pt(handles[w * 2]!, handles[w * 2 + 1]!).x" :cy="pt(handles[w * 2]!, handles[w * 2 + 1]!).y" r="7" class="cursor-grab fill-(--ui-bg) stroke-(--ui-primary)" stroke-width="2" vector-effect="non-scaling-stroke" @pointerdown.prevent="drag(w, $event)" />
      </template>
    </svg>
    <div class="min-w-0 flex-1 space-y-1.5">
      <USelect v-model="choice" :items="items" size="xs" class="w-full" :disabled="disabled" aria-label="Easing" />
      <p class="text-xs text-muted">
        <template v-if="handles">Drag the two handles to shape the curve.</template>
        <template v-else>How the value travels into this keyframe. Pick Custom curve to shape it yourself.</template>
      </p>
    </div>
  </div>
</template>
