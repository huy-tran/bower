<script setup lang="ts">
// "All projects" (from the Bower menu): every project in its folder tree, with search and folder actions.
import ProjectTree from './ProjectTree.vue'

const emit = defineEmits<{ new: [] }>()
const open = defineModel<boolean>('open', { default: false })
const ed = useEditor()
const { project, projects } = ed
const fo = useFolders()

const search = ref('')
const openFolders = reactive(new Set<string>())
try { for (const f of JSON.parse(localStorage.getItem('bower:folders-open') || '[]')) openFolders.add(f) } catch {}
function toggle(path: string) {
  openFolders.has(path) ? openFolders.delete(path) : openFolders.add(path)
  try { localStorage.setItem('bower:folders-open', JSON.stringify([...openFolders])) } catch {}
}
// Always reveal the folder holding the open project.
watch(() => project.value?.folder, (f) => {
  if (!f) return
  const parts = f.split('/')
  for (let i = 1; i <= parts.length; i++) openFolders.add(parts.slice(0, i).join('/'))
}, { immediate: true })


const matches = computed(() => {
  const q = search.value.trim().toLowerCase()
  if (!q) return null
  return projects.value.filter(p => p.name.toLowerCase().includes(q) || p.folder.toLowerCase().includes(q)).sort((a, b) => a.name.localeCompare(b.name))
})

async function openProject(id: string) {
  open.value = false
  search.value = ''
  if (id !== project.value?.id) await ed.openProject(id)
}

// Create / rename / delete folders through one small dialog.
const dialog = reactive({ open: false, mode: 'create' as 'create' | 'rename' | 'delete', path: '', name: '' })
function folderAction(mode: typeof dialog.mode, path: string) {
  dialog.mode = mode
  dialog.path = path
  dialog.name = mode === 'rename' ? folderName(path) : ''
  dialog.open = true
}
async function confirmDialog() {
  const name = dialog.name.trim()
  let ok = false
  if (dialog.mode === 'create') {
    if (!name) return
    const path = dialog.path ? `${dialog.path}/${name}` : name
    ok = await fo.create(path)
    if (ok) openFolders.add(dialog.path), openFolders.add(path)
  } else if (dialog.mode === 'rename') {
    if (!name) return
    ok = await fo.rename(dialog.path, name)
  } else {
    ok = await fo.remove(dialog.path)
  }
  if (ok) dialog.open = false
}
const dialogTitle = computed(() => ({ create: dialog.path ? `New folder in ${folderLabel(dialog.path)}` : 'New folder', rename: `Rename “${folderName(dialog.path)}”`, delete: `Delete “${folderName(dialog.path)}”?` })[dialog.mode])
</script>

<template>
  <UModal v-model:open="open" title="All projects" :ui="{ content: 'max-w-xl', body: 'p-0 sm:p-0' }">
    <template #body>
      <div>
        <div class="flex items-center gap-2 border-b border-default p-2">
          <UInput v-model="search" icon="i-heroicons-magnifying-glass" placeholder="Find a project" size="sm" class="flex-1" autofocus />
          <UTooltip text="New folder at the top level">
            <UButton size="sm" color="neutral" variant="ghost" icon="i-heroicons-folder-plus" aria-label="New folder" @click="folderAction('create', '')" />
          </UTooltip>
        </div>
        <div class="max-h-[60vh] overflow-y-auto p-1.5">
          <template v-if="matches">
            <button v-for="p in matches" :key="p.id" class="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-elevated" :class="{ 'bg-elevated': project?.id === p.id }" @click="openProject(p.id)">
              <UIcon name="i-heroicons-film" class="size-4 shrink-0 text-muted" />
              <span class="truncate">{{ p.name }}</span>
              <span v-if="p.folder" class="ml-auto shrink-0 truncate text-xs text-dimmed">{{ folderLabel(p.folder) }}</span>
            </button>
            <p v-if="!matches.length" class="px-2 py-3 text-center text-xs text-dimmed">No project matches “{{ search }}”.</p>
          </template>
          <ProjectTree v-else :node="fo.tree.value" :depth="0" :open-folders="openFolders" @open="openProject" @toggle="toggle" @folder-action="folderAction" />
        </div>
        <div class="flex items-center justify-between border-t border-default p-2">
          <p class="text-xs text-dimmed">{{ projects.length }} project{{ projects.length === 1 ? '' : 's' }} · {{ fo.folders.value.length }} folder{{ fo.folders.value.length === 1 ? '' : 's' }}</p>
          <UButton size="xs" color="neutral" variant="outline" icon="i-heroicons-plus" label="New project" @click="open = false; emit('new')" />
        </div>
      </div>
    </template>
  </UModal>

  <UModal v-model:open="dialog.open" :title="dialogTitle" :description="dialog.mode === 'delete' ? 'Projects and subfolders inside it move up one level. Nothing is deleted from disk.' : undefined" :ui="{ footer: 'justify-end' }">
    <template v-if="dialog.mode !== 'delete'" #body>
      <UFormField label="Folder name">
        <UInput v-model="dialog.name" autofocus class="w-full" placeholder="e.g. Clients" @keydown.enter="confirmDialog" />
      </UFormField>
    </template>
    <template #footer>
      <UButton color="neutral" variant="ghost" label="Cancel" @click="dialog.open = false" />
      <UButton :color="dialog.mode === 'delete' ? 'error' : 'neutral'" :label="{ create: 'Create', rename: 'Rename', delete: 'Delete folder' }[dialog.mode]" :disabled="dialog.mode !== 'delete' && !dialog.name.trim()" @click="confirmDialog" />
    </template>
  </UModal>
</template>
