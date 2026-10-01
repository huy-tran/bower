<script setup lang="ts">
// Pick a saved scene template and insert it after the current scene.
interface SceneTemplate { id: string, name: string, description: string, width: number, height: number, duration: number, from: { project: string, scene: string }, createdAt: string }

const open = defineModel<boolean>('open', { default: false })
const emit = defineEmits<{ inserted: [id: string] }>()
const { project, selected, setProject, select } = useEditor()
const chat = useChat()
const toast = useToast()

const templates = ref<SceneTemplate[]>([])
const loading = ref(false)
const adapt = ref(true)
const inserting = ref<string | null>(null)
const confirmDelete = ref<SceneTemplate | null>(null)

async function load() {
  loading.value = true
  try { templates.value = await $fetch('/api/templates') } finally { loading.value = false }
}
watch(open, (o) => { if (o) load() })

const fits = (t: SceneTemplate) => t.width === project.value?.width && t.height === project.value?.height

async function insert(t: SceneTemplate) {
  const p = project.value!
  inserting.value = t.id
  try {
    const res = await $fetch<{ id: string, sizeDiffers: boolean, project: any }>(`/api/projects/${p.id}/templates/${t.id}`, { method: 'POST', body: { afterId: selected.value?.id } })
    setProject(res.project)
    select(res.id)
    open.value = false
    emit('inserted', res.id)
    if (adapt.value) {
      const why = [res.sizeDiffers ? `It was made for a ${t.width}x${t.height} stage and this project is ${p.width}x${p.height}` : '', 'this project has its own brand kit and art direction'].filter(Boolean).join(', and ')
      chat.send(p.id, res.id, `This scene was inserted from the template "${t.name}". Adapt it to this project: ${why}. Keep its structure and motion, change layout, sizes, colours, fonts and copy so it belongs here.`)
        .catch(e => toast.add({ title: 'Could not start Claude', description: e?.data?.message, color: 'error' }))
      toast.add({ title: `“${t.name}” inserted`, description: 'Claude is adapting it to this project.', color: 'success' })
    } else {
      toast.add({ title: `“${t.name}” inserted`, color: 'success' })
    }
  } catch (err: any) {
    toast.add({ title: 'Could not insert the template', description: err?.data?.message || err?.message, color: 'error' })
  } finally {
    inserting.value = null
  }
}

async function remove(t: SceneTemplate) {
  templates.value = await $fetch(`/api/templates/${t.id}`, { method: 'DELETE' })
  confirmDelete.value = null
}
</script>

<template>
  <UModal v-model:open="open" title="Insert a template" description="Saved scenes you can reuse in any project. The copy goes after the current scene." :ui="{ content: 'max-w-3xl', footer: 'justify-between' }">
    <template #body>
      <UEmpty v-if="!loading && !templates.length" variant="soft" icon="i-heroicons-bookmark" title="No templates yet" description="Open a scene you want to reuse and click Save as template in its toolbar." />
      <div v-else class="grid grid-cols-3 gap-4">
        <div v-for="t in templates" :key="t.id" class="group flex flex-col overflow-hidden rounded-lg ring-1 ring-default">
          <div class="relative bg-elevated" :style="{ aspectRatio: `${t.width} / ${t.height}` }">
            <img :src="`/api/templates/${t.id}/thumb`" :alt="t.name" class="size-full object-contain" @error="($event.target as HTMLImageElement).style.visibility = 'hidden'">
            <UButton class="absolute top-1.5 right-1.5 opacity-0 group-hover:opacity-100" size="xs" color="error" variant="solid" icon="i-heroicons-trash" :aria-label="`Delete ${t.name}`" @click="confirmDelete = t" />
          </div>
          <div class="flex flex-1 flex-col gap-1 p-3">
            <p class="font-medium text-highlighted">{{ t.name }}</p>
            <p v-if="t.description" class="line-clamp-2 text-xs text-muted">{{ t.description }}</p>
            <p class="mt-auto text-xs text-dimmed">{{ fmtSeconds(t.duration, 1) }} · {{ t.width }}×{{ t.height }}<span v-if="!fits(t)" class="text-warning"> · other shape</span></p>
            <UButton size="sm" color="neutral" :variant="fits(t) ? 'solid' : 'outline'" icon="i-heroicons-plus" label="Insert" :loading="inserting === t.id" :disabled="!!inserting" class="mt-1 justify-center" @click="insert(t)" />
          </div>
        </div>
      </div>

      <UModal :open="!!confirmDelete" :title="`Delete the “${confirmDelete?.name}” template?`" description="Scenes already inserted from it are not affected." :ui="{ footer: 'justify-end' }" @update:open="v => { if (!v) confirmDelete = null }">
        <template #footer>
          <UButton color="neutral" variant="ghost" label="Cancel" @click="confirmDelete = null" />
          <UButton color="error" label="Delete template" @click="remove(confirmDelete!)" />
        </template>
      </UModal>
    </template>
    <template #footer>
      <USwitch v-model="adapt" label="Ask Claude to adapt it to this project's brand and stage" />
      <UButton color="neutral" variant="ghost" label="Close" @click="open = false" />
    </template>
  </UModal>
</template>
