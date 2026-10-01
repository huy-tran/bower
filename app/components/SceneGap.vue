<script setup lang="ts">
import type { Seam, SceneView } from '~/composables/useEditor'
import { TRANSITIONS } from '#shared/utils/timeline'

const props = defineProps<{ from: SceneView, to: SceneView, seam?: Seam }>()
const { project, setProject, select } = useEditor()
const chat = useChat()
const toast = useToast()

const type = computed(() => props.to.transition?.type ?? 'cut')
const duration = ref(props.to.transition?.duration ?? 600)
watch(() => props.to.transition?.duration, (d) => { if (d) duration.value = d })

const label = computed(() => TRANSITIONS.find(t => t.value === type.value)?.label ?? 'Cut')
const seamColor = computed(() => !props.seam ? 'neutral' : props.seam.diff < 1 ? 'success' : props.seam.diff < 8 ? 'warning' : 'neutral')

async function setTransition(t: string, d = duration.value) {
  setProject(await $fetch(`/api/projects/${project.value!.id}/scenes/${props.to.id}`, {
    method: 'PATCH', body: { transition: t === 'cut' ? null : { type: t, duration: d } }
  }))
}

let timer: ReturnType<typeof setTimeout>
function setDuration(v: number) {
  duration.value = v
  clearTimeout(timer)
  timer = setTimeout(() => setTransition(type.value, v), 300)
}

async function makeSeamless() {
  try {
    await chat.send(project.value!.id, props.from.id, `Make the last frame of this scene match the first frame of the next scene ("${props.to.title}") exactly so the cut is invisible. Run the seam check and keep going until it is under 1%.`)
    select(props.from.id)
    toast.add({ title: `Claude is matching ${props.from.title} to ${props.to.title}`, color: 'neutral' })
  } catch (e: any) {
    toast.add({ title: 'Could not start Claude', description: e?.data?.message, color: 'error' })
  }
}
</script>

<template>
  <div class="flex w-12 shrink-0 flex-col items-center justify-center gap-1 pb-6">
    <UPopover :content="{ side: 'top' }">
      <UTooltip :text="`${label}${seam ? ` · ${seam.diff.toFixed(1)}% change at the cut` : ''}`">
        <UButton
          size="xs"
          color="neutral"
          :variant="type === 'cut' ? 'ghost' : 'soft'"
          :icon="type === 'cut' ? 'i-heroicons-scissors' : 'i-heroicons-arrows-right-left'"
          :aria-label="`Transition from ${from.title} to ${to.title}`"
        />
      </UTooltip>
      <template #content>
        <div class="w-80 space-y-3 p-3">
          <p class="text-sm font-medium text-highlighted">{{ from.title }} → {{ to.title }}</p>
          <div class="grid grid-cols-[1fr_7rem] gap-2">
            <UFormField label="Transition" size="sm">
              <USelect :model-value="type" :items="TRANSITIONS" size="sm" class="w-full" @update:model-value="v => setTransition(String(v))" />
            </UFormField>
            <UFormField label="Length (ms)" size="sm">
              <UInputNumber :model-value="duration" :min="100" :max="3000" :step="50" size="sm" :disabled="type === 'cut'" @update:model-value="v => setDuration(Number(v) || 600)" />
            </UFormField>
          </div>
          <div v-if="seam" class="space-y-2">
            <p class="text-xs text-muted">
              Seam check: <span class="font-medium" :class="seam.diff < 1 ? 'text-success' : 'text-default'">{{ seam.diff.toFixed(2) }}%</span> of pixels change at the cut
              ({{ seam.diff < 1 ? 'reads as seamless' : 'a visible jump' }}). Last frame | first frame | changes in red.
            </p>
            <img :src="seam.url" alt="Seam comparison" class="w-full rounded-sm ring-1 ring-default">
            <UButton v-if="seam.diff >= 1" block size="xs" color="neutral" variant="outline" icon="i-heroicons-sparkles" label="Ask Claude to make this cut seamless" @click="makeSeamless" />
          </div>
          <p v-else class="text-xs text-dimmed">Checking the cut…</p>
        </div>
      </template>
    </UPopover>
    <UBadge v-if="seam" :color="seamColor" variant="subtle" size="sm" class="font-mono" :label="`${seam.diff < 10 ? seam.diff.toFixed(1) : Math.round(seam.diff)}%`" />
  </div>
</template>
