<script setup lang="ts">
import type { TrackPropDef, TrackValue } from '#shared/utils/tracks'

// One property in the layer inspector, After Effects style: the stopwatch (keyframes on or off), the label (drag it
// left or right to change a number), the value, and the diamond (a keyframe at the playhead, added or removed).
const props = defineProps<{
  def: TrackPropDef
  value: TrackValue
  keyed: boolean
  // A keyframe sits at the playhead.
  atKey: boolean
  // Has a value or keyframes of its own (not just the element's style).
  set: boolean
  disabled?: boolean
}>()
const emit = defineEmits<{
  live: [v: TrackValue]
  commit: [v: TrackValue]
  stopwatch: []
  diamond: []
  clear: []
}>()

// Opacity and scale are stored as CSS has them (0..1, 1 = normal) and shown as percentages.
const factor = computed(() => props.def.factor ?? 1)
const shownStep = computed(() => Math.round((props.def.step ?? 1) * factor.value * 1000) / 1000)
const shown = computed(() => {
  if (props.def.kind !== 'number') return props.value
  const n = (Number(props.value) || 0) * factor.value
  return shownStep.value < 1 ? Math.round(n * 1000) / 1000 : Math.round(n * 10) / 10
})

function clamp(n: number) {
  if (props.def.min !== undefined) n = Math.max(props.def.min, n)
  if (props.def.max !== undefined) n = Math.min(props.def.max, n)
  return n
}

// Dragging the label: one step per pixel (ten with Shift, a tenth with Alt), previewed live, saved on release.
function scrub(e: PointerEvent) {
  if (props.def.kind !== 'number' || props.disabled) return
  e.preventDefault()
  const el = e.currentTarget as HTMLElement
  el.setPointerCapture(e.pointerId)
  const start = Number(props.value) || 0
  const step = props.def.step ?? 1
  let moved = 0, last = start
  const move = (ev: PointerEvent) => {
    moved += ev.movementX * (ev.shiftKey ? 10 : ev.altKey ? 0.1 : 1)
    last = clamp(Math.round(Math.round((start + moved * step) / step) * step * 1000) / 1000)
    emit('live', last)
  }
  const up = () => {
    el.removeEventListener('pointermove', move)
    el.removeEventListener('pointerup', up)
    if (last !== start) emit('commit', last)
  }
  el.addEventListener('pointermove', move)
  el.addEventListener('pointerup', up)
}

function typed(raw: string) {
  if (props.def.kind === 'number') {
    const n = Number(raw) / factor.value
    if (Number.isFinite(n) && n !== Number(props.value)) emit('commit', clamp(n))
  } else if (raw.trim() && raw !== props.value) emit('commit', raw.trim())
}

// Colour inputs only take #rrggbb; computed colours come as rgb().
const hex = computed(() => {
  const v = String(props.value)
  if (/^#[0-9a-f]{6}/i.test(v)) return v.slice(0, 7)
  const m = /rgba?\((\d+)[\s,]+(\d+)[\s,]+(\d+)/.exec(v)
  return m ? `#${[m[1], m[2], m[3]].map(x => Number(x).toString(16).padStart(2, '0')).join('')}` : '#000000'
})
</script>

<template>
  <div class="group grid grid-cols-[1.25rem_6.5rem_minmax(0,1fr)_1.25rem] items-center gap-1.5">
    <UTooltip :text="keyed ? 'Stop keyframing (keep the value at the playhead)' : 'Keyframe this (starts with a keyframe at the playhead)'">
      <button type="button" class="grid size-5 place-items-center rounded hover:bg-elevated disabled:opacity-40" :class="keyed ? 'text-primary' : 'text-dimmed'" :disabled="disabled || def.kind === 'boolean'" :aria-label="`Keyframe ${def.label}`" :aria-pressed="keyed" @click="emit('stopwatch')">
        <UIcon name="i-lucide-timer" class="size-3.5" />
      </button>
    </UTooltip>
    <span
      class="truncate text-sm select-none"
      :class="[def.kind === 'number' && !disabled && 'cursor-ew-resize', set ? 'text-highlighted' : 'text-muted']"
      :title="def.kind === 'number' ? `${def.label}: drag left or right to change (Shift: faster, Alt: finer)` : def.label"
      @pointerdown="scrub"
      @dblclick="set && emit('clear')"
    >{{ def.label }}</span>
    <div class="flex min-w-0 items-center gap-1.5">
      <template v-if="def.kind === 'number'">
        <UInput :model-value="Number(shown)" type="number" :step="shownStep" size="xs" :aria-label="def.label" class="min-w-0 flex-1" :ui="{ base: 'tabular-nums' }" :disabled="disabled" @change="typed(($event.target as HTMLInputElement).value)" @keydown.enter="($event.target as HTMLInputElement).blur()">
          <template v-if="def.unit" #trailing><span class="text-xs text-dimmed">{{ def.unit }}</span></template>
        </UInput>
      </template>
      <template v-else-if="def.kind === 'color'">
        <input type="color" :value="hex" class="h-6 w-8 shrink-0 cursor-pointer rounded border-0 bg-transparent p-0" :disabled="disabled" :aria-label="def.label" @input="emit('live', ($event.target as HTMLInputElement).value)" @change="emit('commit', ($event.target as HTMLInputElement).value)">
        <UInput :model-value="String(value)" size="xs" class="min-w-0 flex-1 font-mono" :disabled="disabled" @change="typed(($event.target as HTMLInputElement).value)" />
      </template>
      <USwitch v-else size="sm" :model-value="!!value" :disabled="disabled" @update:model-value="v => emit('commit', !!v)" />
    </div>
    <UTooltip v-if="keyed" :text="atKey ? 'Remove the keyframe at the playhead' : 'Add a keyframe at the playhead'">
      <button type="button" class="grid size-5 place-items-center rounded hover:bg-elevated" :disabled="disabled" :aria-label="atKey ? 'Remove keyframe' : 'Add keyframe'" @click="emit('diamond')">
        <span class="size-2.5 rotate-45 border-[1.5px] border-primary" :class="atKey && 'bg-primary'" />
      </button>
    </UTooltip>
    <span v-else />
  </div>
</template>
