<script setup lang="ts">
// One level of the project tree: this folder's subfolders (recursively) and its projects.
import type { DropdownMenuItem } from '@nuxt/ui'
import type { FolderNode } from '~/composables/useFolders'

const props = defineProps<{ node: FolderNode, depth: number, openFolders: Set<string> }>()
const emit = defineEmits<{ open: [id: string], toggle: [path: string], folderAction: [action: 'create' | 'rename' | 'delete', path: string] }>()

const { project } = useEditor()
const fo = useFolders()

const count = (n: FolderNode): number => n.projects.length + n.folders.reduce((a, f) => a + count(f), 0)

const folderMenu = (f: FolderNode): DropdownMenuItem[][] => [[
  { label: 'New subfolder…', icon: 'i-heroicons-folder-plus', onSelect: () => emit('folderAction', 'create', f.path) },
  { label: 'Rename…', icon: 'i-heroicons-pencil', onSelect: () => emit('folderAction', 'rename', f.path) }
], [
  { label: 'Delete folder', icon: 'i-heroicons-trash', color: 'error', onSelect: () => emit('folderAction', 'delete', f.path) }
]]

const projectMenu = (p: { id: string, folder: string }): DropdownMenuItem[][] => [[{
  label: 'Move to…',
  icon: 'i-heroicons-arrow-right-start-on-rectangle',
  children: [fo.items.value.map(i => ({ label: i.label, icon: i.value === ROOT ? 'i-heroicons-home' : 'i-heroicons-folder', disabled: i.value === toFolderValue(p.folder), onSelect: () => fo.moveProject(p.id, i.value) }))]
}]]

const pad = computed(() => ({ paddingLeft: `${props.depth * 14 + 6}px` }))
</script>

<template>
  <div>
    <div v-for="f in node.folders" :key="f.path">
      <div class="group flex items-center gap-1 rounded-md pr-1 hover:bg-elevated" :style="pad">
        <button class="flex min-w-0 flex-1 items-center gap-1.5 py-1.5 text-left text-sm" @click="emit('toggle', f.path)">
          <UIcon :name="openFolders.has(f.path) ? 'i-heroicons-chevron-down' : 'i-heroicons-chevron-right'" class="size-3.5 shrink-0 text-dimmed" />
          <UIcon :name="openFolders.has(f.path) ? 'i-heroicons-folder-open' : 'i-heroicons-folder'" class="size-4 shrink-0 text-muted" />
          <span class="truncate font-medium text-highlighted">{{ f.name }}</span>
          <span class="shrink-0 text-xs text-dimmed">{{ count(f) }}</span>
        </button>
        <UDropdownMenu :items="folderMenu(f)" :content="{ align: 'end' }">
          <UButton size="xs" color="neutral" variant="ghost" icon="i-heroicons-ellipsis-horizontal" class="opacity-0 group-hover:opacity-100 data-[state=open]:opacity-100" :aria-label="`Folder ${f.name} actions`" />
        </UDropdownMenu>
      </div>
      <ProjectTree v-if="openFolders.has(f.path)" :node="f" :depth="depth + 1" :open-folders="openFolders" @open="id => emit('open', id)" @toggle="p => emit('toggle', p)" @folder-action="(a, p) => emit('folderAction', a, p)" />
    </div>

    <div v-for="p in node.projects" :key="p.id" class="group flex items-center gap-1 rounded-md pr-1 hover:bg-elevated" :class="{ 'bg-elevated': project?.id === p.id }" :style="pad">
      <button class="flex min-w-0 flex-1 items-center gap-1.5 py-1.5 text-left text-sm" @click="emit('open', p.id)">
        <UIcon name="i-heroicons-film" class="ml-5 size-4 shrink-0" :class="project?.id === p.id ? 'text-primary' : 'text-muted'" />
        <span class="truncate" :class="project?.id === p.id ? 'font-semibold text-highlighted' : ''">{{ p.name }}</span>
      </button>
      <UDropdownMenu :items="projectMenu(p)" :content="{ align: 'end' }">
        <UButton size="xs" color="neutral" variant="ghost" icon="i-heroicons-ellipsis-horizontal" class="opacity-0 group-hover:opacity-100 data-[state=open]:opacity-100" :aria-label="`Project ${p.name} actions`" />
      </UDropdownMenu>
    </div>

    <p v-if="!node.folders.length && !node.projects.length" class="py-1.5 text-xs text-dimmed" :style="pad">Empty</p>
  </div>
</template>
