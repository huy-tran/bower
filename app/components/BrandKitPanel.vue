<script setup lang="ts">
// The project's brand kit: pick one, start a new one, or open the editor. Editing happens in BrandKitModal.
// Explicit import: the file was recreated during development and the dev server's component registry
// does not always pick a deleted-then-recreated name back up until it restarts.
import BrandKitModal, { type BrandKit } from './BrandKitModal.vue'

const { project, setProject } = useEditor()
const toast = useToast()

const kits = ref<BrandKit[]>([])
const newName = ref('')
const editorOpen = ref(false)
const editId = ref<string | null>(null)

async function load() {
  kits.value = await $fetch('/api/brand-kits')
}
onMounted(load)

const NONE = '__none__'
const kitItems = computed(() => [{ label: 'No brand kit', value: NONE }, ...kits.value.map(k => ({ label: k.name, value: k.id }))])
const current = computed(() => kits.value.find(k => k.id === project.value?.brandKitId) ?? null)
const selected = computed({
  get: () => project.value?.brandKitId ?? NONE,
  set: (id: string) => use(id === NONE ? null : id)
})

async function use(id: string | null) {
  try {
    setProject(await $fetch(`/api/projects/${project.value!.id}`, { method: 'PATCH', body: { brandKitId: id } }))
    const kit = kits.value.find(k => k.id === id)
    toast.add({ title: kit ? `Using ${kit.name} for this project` : 'Brand kit removed from this project', description: kit ? 'Claude will follow it from the next prompt.' : undefined, color: 'success' })
  } catch (e: any) {
    toast.add({ title: 'Could not change the brand kit', description: e?.data?.message, color: 'error' })
  }
}

// A new kit is used by this project straight away and opened for filling in.
async function create() {
  const name = newName.value.trim()
  if (!name) return
  const k = await $fetch<BrandKit>('/api/brand-kits', { method: 'POST', body: { name } })
  newName.value = ''
  kits.value.push(k)
  await use(k.id)
  edit(k.id)
}

function edit(id: string) {
  editId.value = id
  editorOpen.value = true
}

// The editor may have renamed or deleted kits.
async function onEditorChange() {
  await load()
  if (project.value?.brandKitId && !kits.value.some(k => k.id === project.value!.brandKitId)) await useEditor().refresh()
}
</script>

<template>
  <div class="space-y-5">
    <BrandKitModal v-model:open="editorOpen" :kit-id="editId" @change="onEditorChange" />

    <UFormField label="Kit" help="Kits are shared by every project on this computer.">
      <div class="flex gap-2">
        <USelect v-model="selected" :items="kitItems" class="flex-1" />
        <UButton v-if="current" color="neutral" variant="outline" icon="i-heroicons-pencil-square" label="Edit kit…" @click="edit(current.id)" />
      </div>
    </UFormField>

    <UFormField label="New kit" help="Starts a kit with that name, uses it for this project and opens it for you to fill in.">
      <UFieldGroup class="w-full">
        <UInput v-model="newName" placeholder="e.g. Acme Corp" class="flex-1" @keydown.enter="create" />
        <UButton color="neutral" variant="outline" icon="i-heroicons-plus" label="Create" :disabled="!newName.trim()" @click="create" />
      </UFieldGroup>
    </UFormField>

    <UCard v-if="current" :ui="{ body: 'p-4 sm:p-4 space-y-4' }">
      <div class="flex items-center justify-between gap-2">
        <h3 class="font-semibold text-highlighted">{{ current.name }}</h3>
        <UBadge color="info" variant="subtle" size="sm" label="In use" />
      </div>
      <div class="grid grid-cols-[6rem_1fr] gap-x-3 gap-y-3 text-sm">
        <span class="text-muted">Colours</span>
        <div v-if="current.colors.length" class="flex flex-wrap gap-2">
          <UTooltip v-for="c in current.colors" :key="c.hex + c.name" :text="`${c.name || 'Colour'} ${c.hex}`">
            <span class="block size-6 rounded-md ring-1 ring-default" :style="{ background: c.hex }" />
          </UTooltip>
        </div>
        <span v-else class="text-dimmed">None yet</span>
        <span class="text-muted">Fonts</span>
        <span>{{ current.fonts.heading }} for headings · {{ current.fonts.body }} for body text</span>
        <span class="text-muted">Logos</span>
        <div v-if="current.files.length" class="flex flex-wrap gap-2">
          <div v-for="f in current.files" :key="f.name" class="grid size-12 place-items-center overflow-hidden rounded-md bg-elevated p-1 ring-1 ring-default">
            <img :src="`/api/brand-kits/${current.id}/files/${f.name}`" :alt="f.label" class="max-h-full max-w-full object-contain">
          </div>
        </div>
        <span v-else class="text-dimmed">None yet</span>
        <template v-if="current.notes.trim()">
          <span class="text-muted">Notes</span>
          <p class="whitespace-pre-line">{{ current.notes.trim() }}</p>
        </template>
      </div>
    </UCard>
    <UEmpty v-else variant="soft" size="sm" icon="i-heroicons-swatch" title="No brand kit" description="Claude uses the art direction alone. Pick a kit above, or create one for this client." />
  </div>
</template>
