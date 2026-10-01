<script setup lang="ts">
const { project, selected, select, setProject } = useEditor()
const chat = useChat()
const toast = useToast()

const dragId = ref<string | null>(null)
const overId = ref<string | null>(null)
const adding = ref(false)
const newTitle = ref('')
const newBrief = ref('')
const strip = ref<HTMLElement>()

function onDragStart(id: string, e: DragEvent) {
  dragId.value = id
  e.dataTransfer!.effectAllowed = 'move'
  e.dataTransfer!.setData('text/plain', id)
}

async function onDrop(targetId: string) {
  const p = project.value!
  const from = dragId.value
  dragId.value = overId.value = null
  if (!from || from === targetId) return
  const ids = p.scenes.map(s => s.id).filter(id => id !== from)
  ids.splice(ids.indexOf(targetId) + (p.scenes.findIndex(s => s.id === from) < p.scenes.findIndex(s => s.id === targetId) ? 1 : 0), 0, from)
  setProject(await $fetch(`/api/projects/${p.id}/scenes/order`, { method: 'PUT', body: { ids } }))
}

async function addScene() {
  const p = project.value!
  const title = newTitle.value.trim() || 'New scene'
  const res = await $fetch<{ id: string, project: any }>(`/api/projects/${p.id}/scenes`, {
    method: 'POST', body: { title, afterId: selected.value?.id }
  })
  setProject(res.project)
  select(res.id)
  adding.value = false
  const brief = newBrief.value.trim()
  newTitle.value = newBrief.value = ''
  if (brief) {
    chat.send(p.id, res.id, `Build this scene from scratch: ${brief}`).catch(e => toast.add({ title: 'Could not start Claude', description: e.data?.message, color: 'error' }))
  }
}

watch(() => selected.value?.id, async (id) => {
  await nextTick()
  strip.value?.querySelector(`[data-scene="${id}"]`)?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' })
})
</script>

<template>
  <div v-if="project" ref="strip" class="flex gap-4 overflow-x-auto px-6 pt-3 pb-4">
    <div
      v-for="(s, i) in project.scenes"
      :key="s.id"
      :data-scene="s.id"
      class="w-60 shrink-0 cursor-pointer"
      draggable="true"
      @click="select(s.id)"
      @dragstart="onDragStart(s.id, $event)"
      @dragover.prevent="overId = s.id"
      @dragleave="overId === s.id && (overId = null)"
      @drop.prevent="onDrop(s.id)"
      @dragend="dragId = overId = null"
    >
      <div
        class="relative aspect-video overflow-hidden rounded-lg bg-white ring-1 transition"
        :class="[
          s.id === selected?.id ? 'ring-2 ring-blue-500' : 'ring-zinc-200 hover:ring-zinc-300',
          overId === s.id && dragId !== s.id && 'ring-2 ring-zinc-900',
          dragId === s.id && 'opacity-40'
        ]"
      >
        <iframe :src="frameUrl(project.id, s, s.duration * 0.6)" class="pointer-events-none size-full border-0" loading="lazy" tabindex="-1" />
        <span class="absolute top-2 left-2 grid size-6 place-items-center rounded-md bg-zinc-800 text-xs font-semibold text-white">{{ i + 1 }}</span>
        <span v-if="chat.isBusy(project.id, s.id)" class="absolute top-2 right-2 flex items-center gap-1 rounded-md bg-white/90 px-1.5 py-0.5 text-[11px] font-medium text-zinc-600 shadow-sm">
          <UIcon name="i-lucide-loader-circle" class="size-3 animate-spin" /> Working
        </span>
      </div>
      <div class="mt-1.5 flex items-baseline gap-2 text-sm">
        <span class="truncate font-medium text-zinc-800">{{ s.title }}</span>
        <span class="ml-auto shrink-0 text-zinc-400">{{ fmtSeconds(s.duration) }}</span>
      </div>
    </div>

    <button
      class="grid aspect-video w-40 shrink-0 place-items-center rounded-lg border-2 border-dashed border-zinc-300 text-zinc-400 transition hover:border-zinc-400 hover:text-zinc-600"
      @click="adding = true"
    >
      <span class="flex flex-col items-center gap-1 text-sm font-medium"><UIcon name="i-lucide-plus" class="size-5" /> Add scene</span>
    </button>

    <UModal v-model:open="adding" title="New scene" description="Added after the current scene.">
      <template #body>
        <form class="space-y-4" @submit.prevent="addScene">
          <UFormField label="Title">
            <UInput v-model="newTitle" placeholder="e.g. Dark mode" autofocus class="w-full" />
          </UFormField>
          <UFormField label="Brief (optional)" help="If you describe the scene, Claude builds it straight away.">
            <UTextarea v-model="newBrief" :rows="4" autoresize placeholder="Headline 'Dark by default' slides up, then the settings card flips from light to dark on the downbeat." class="w-full" />
          </UFormField>
          <div class="flex justify-end gap-2">
            <UButton color="neutral" variant="ghost" label="Cancel" @click="adding = false" />
            <UButton type="submit" color="neutral" :label="newBrief.trim() ? 'Create and build' : 'Create scene'" />
          </div>
        </form>
      </template>
    </UModal>
  </div>
</template>
