<script setup lang="ts">
// Everything that changed across the project, newest first, and a way to rewind all scenes to a moment.
interface Entry { sceneId: string, title: string, at: string, label: string, kind: 'created' | 'version' | 'deleted', n: number, current: boolean }

const open = defineModel<boolean>('open', { default: false })
const { project, setProject, select } = useEditor()
const toast = useToast()

const entries = ref<Entry[]>([])
const loading = ref(false)
const confirm = ref<Entry | null>(null)
const rewinding = ref(false)

async function load() {
  loading.value = true
  try { entries.value = await $fetch(`/api/projects/${project.value!.id}/history`) } finally { loading.value = false }
}
watch(open, (o) => { if (o) load() })

// Group by day, then show time within the day.
const groups = computed(() => {
  const map = new Map<string, Entry[]>()
  for (const e of entries.value) {
    const day = new Date(e.at).toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' })
    map.set(day, [...(map.get(day) ?? []), e])
  }
  return [...map.entries()]
})
const time = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
const icon = (e: Entry) => e.kind === 'deleted' ? 'i-heroicons-trash' : e.kind === 'created' ? 'i-heroicons-plus-circle' : 'i-heroicons-pencil-square'

async function rewind(e: Entry) {
  rewinding.value = true
  try {
    const res = await $fetch<{ changed: { title: string, action: string }[], project: any }>(`/api/projects/${project.value!.id}/history/rewind`, { method: 'POST', body: { at: e.at } })
    setProject(res.project)
    if (res.project.scenes.some((s: any) => s.id === e.sceneId)) select(e.sceneId)
    confirm.value = null
    await load()
    toast.add({
      title: res.changed.length ? `Rewound to ${time(e.at)}` : 'Nothing to change',
      description: res.changed.length ? res.changed.map(c => `${c.title}: ${c.action}`).join(' · ') : 'Every scene was already in that state.',
      color: 'success',
      duration: 8000
    })
  } catch (err: any) {
    toast.add({ title: 'Could not rewind', description: err?.data?.message || err?.message, color: 'error' })
  } finally {
    rewinding.value = false
  }
}
</script>

<template>
  <UModal v-model:open="open" title="History" description="Every change to every scene, newest first. Rewind puts the whole project back to a moment; later versions stay available, so a rewind can itself be undone here." :ui="{ content: 'max-w-2xl', footer: 'justify-between' }">
    <template #body>
      <UEmpty v-if="!loading && !entries.length" variant="soft" icon="i-heroicons-clock" title="No history yet" description="Changes made through the chat and the editor show up here." />
      <div v-else class="max-h-[60vh] space-y-4 overflow-y-auto pr-1">
        <div v-for="[day, list] in groups" :key="day">
          <p class="mb-1 text-xs font-semibold text-muted">{{ day }}</p>
          <div class="divide-y divide-default rounded-md ring-1 ring-default">
            <div v-for="e in list" :key="`${e.sceneId}-${e.n}-${e.at}`" class="group flex items-center gap-3 px-3 py-2 text-sm">
              <UIcon :name="icon(e)" class="size-4 shrink-0" :class="e.kind === 'deleted' ? 'text-error' : e.current ? 'text-primary' : 'text-muted'" />
              <span class="w-20 shrink-0 font-mono text-xs text-muted">{{ time(e.at) }}</span>
              <span class="min-w-0 flex-1 truncate"><span class="font-medium text-highlighted">{{ e.title }}</span><span class="text-muted"> · {{ e.label }}</span></span>
              <UBadge v-if="e.current" color="neutral" variant="soft" size="sm" label="Current" />
              <UButton size="xs" color="neutral" variant="outline" icon="i-heroicons-arrow-uturn-left" label="Rewind here" class="opacity-0 group-hover:opacity-100 focus:opacity-100" @click="confirm = e" />
            </div>
          </div>
        </div>
      </div>

      <UModal :open="!!confirm" :title="confirm ? `Rewind the project to ${time(confirm.at)}?` : ''" description="Every scene goes back to its latest version at that moment. Scenes created later move to the trash; scenes deleted later come back. Scene order and transitions are not changed." :ui="{ footer: 'justify-end' }" @update:open="v => { if (!v) confirm = null }">
        <template #footer>
          <UButton color="neutral" variant="ghost" label="Cancel" @click="confirm = null" />
          <UButton icon="i-heroicons-arrow-uturn-left" label="Rewind" :loading="rewinding" @click="rewind(confirm!)" />
        </template>
      </UModal>
    </template>
    <template #footer>
      <p class="text-xs text-muted">Per-scene Undo and Versions are in the scene toolbar.</p>
      <UButton color="neutral" label="Close" @click="open = false" />
    </template>
  </UModal>
</template>
