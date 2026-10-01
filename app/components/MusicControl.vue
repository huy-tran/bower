<script setup lang="ts">
const { project, setProject, pause } = useEditor()
const music = useMusic()
const toast = useToast()
const input = ref<HTMLInputElement>()
const open = ref(false)
const offset = ref('0')

const audio = computed(() => project.value?.audio ?? null)
watch(() => audio.value?.startOffset, (v) => { offset.value = ((v ?? 0) / 1000).toFixed(2) }, { immediate: true })

async function pick(e: Event) {
  const f = (e.target as HTMLInputElement).files?.[0]
  if (!f) return
  try {
    await music.upload(f)
    open.value = true
  } catch (err: any) {
    toast.add({ title: 'Could not load that track', description: err?.data?.message || err?.message, color: 'error' })
  } finally {
    (e.target as HTMLInputElement).value = ''
  }
}

async function patchAudio(body: Record<string, unknown>) {
  setProject(await $fetch(`/api/projects/${project.value!.id}`, { method: 'PATCH', body: { audio: body } }))
}

async function saveOffset() {
  const ms = Math.round((parseFloat(offset.value) || 0) * 1000)
  if (ms !== audio.value?.startOffset) await patchAudio({ startOffset: ms })
}

async function startOnDownbeat() {
  const a = audio.value!
  const cur = a.startOffset || 0
  const next = a.downbeats.find(d => d >= cur - 1) ?? a.downbeats[0] ?? 0
  await patchAudio({ startOffset: next })
}

async function nudgeGrid(ms: number) {
  const a = audio.value!
  const shift = (l: number[]) => l.map(t => t + ms)
  await patchAudio({ beats: shift(a.beats), downbeats: shift(a.downbeats), phrases: shift(a.phrases) })
}

async function snap(grid: 'beats' | 'downbeats' | 'phrases') {
  try {
    setProject(await $fetch(`/api/projects/${project.value!.id}/scenes/snap`, { method: 'POST', body: { grid } }))
    toast.add({ title: `Cuts snapped to ${grid}`, color: 'success' })
  } catch (e: any) {
    toast.add({ title: 'Could not snap', description: e?.data?.message, color: 'error' })
  }
}

async function remove() {
  pause()
  setProject(await $fetch(`/api/projects/${project.value!.id}/audio`, { method: 'DELETE' }))
  open.value = false
}
</script>

<template>
  <div>
    <input ref="input" type="file" accept="audio/*" class="hidden" @change="pick">
    <UButton v-if="!audio" color="neutral" variant="outline" icon="i-heroicons-musical-note" label="Add music" :loading="music.analysing.value" @click="input?.click()" />
    <UPopover v-else v-model:open="open" :content="{ align: 'end', side: 'top' }">
      <UButton
        color="neutral"
        variant="outline"
        icon="i-heroicons-musical-note"
        :loading="music.analysing.value"
        :label="music.analysing.value ? `Analysing ${Math.round(music.progress.value * 100)}%` : audio.bpm ? `${Math.round(audio.bpm)} BPM` : audio.name"
        :ui="{ label: 'max-w-40 truncate' }"
      />
      <template #content>
        <div class="w-80 space-y-4 p-4 text-sm">
          <div>
            <p class="truncate font-medium text-highlighted">{{ audio.name }}</p>
            <p class="text-muted">
              <template v-if="audio.bpm">{{ audio.bpm.toFixed(1) }} BPM · {{ audio.downbeats.length }} bars · {{ audio.phrases.length }} phrases</template>
              <template v-else>Not analysed yet</template>
            </p>
          </div>

          <UFormField label="Video starts at" help="Where in the track the first frame begins.">
            <UFieldGroup class="w-full">
              <UInput v-model="offset" type="number" step="0.01" min="0" class="flex-1" @blur="saveOffset" @keydown.enter="saveOffset">
                <template #trailing><span class="text-xs text-dimmed">s</span></template>
              </UInput>
              <UButton color="neutral" variant="outline" label="Next downbeat" :disabled="!audio.downbeats.length" @click="startOnDownbeat" />
            </UFieldGroup>
          </UFormField>

          <UFormField v-if="audio.beats.length" label="Beat grid">
            <div class="flex gap-1.5">
              <UFieldGroup size="xs">
                <UButton color="neutral" variant="outline" label="-20ms" @click="nudgeGrid(-20)" />
                <UButton color="neutral" variant="outline" label="+20ms" @click="nudgeGrid(20)" />
              </UFieldGroup>
              <UButton size="xs" color="neutral" variant="ghost" icon="i-heroicons-arrow-path" label="Re-analyse" @click="music.analyse()" />
            </div>
          </UFormField>

          <UFormField v-if="audio.downbeats.length" label="Snap scene cuts to">
            <UFieldGroup size="xs">
              <UButton color="neutral" variant="subtle" label="Beats" @click="snap('beats')" />
              <UButton color="neutral" variant="subtle" label="Downbeats" @click="snap('downbeats')" />
              <UButton color="neutral" variant="subtle" label="Phrases" @click="snap('phrases')" />
            </UFieldGroup>
          </UFormField>

          <USeparator />
          <div class="flex justify-between">
            <UButton size="xs" color="neutral" variant="ghost" icon="i-heroicons-arrow-path-rounded-square" label="Replace track" @click="input?.click()" />
            <UButton size="xs" color="error" variant="ghost" icon="i-heroicons-trash" label="Remove" @click="remove" />
          </div>
        </div>
      </template>
    </UPopover>
  </div>
</template>
