<script setup lang="ts">
// Ctrl+K (Cmd+K on a Mac): search Bower's actions, scenes, projects and settings, and run one with Enter.
// The page builds the groups, so every entry does exactly what the matching button or menu item does.
import type { CommandPaletteGroup, CommandPaletteItem } from '@nuxt/ui'

const open = defineModel<boolean>('open', { default: false })
defineProps<{ groups: CommandPaletteGroup<CommandPaletteItem>[] }>()
const term = ref('')
watch(open, (o) => { if (!o) term.value = '' })

// Run the entry after the palette has closed, so a window it opens is not closed with it.
function run(item: CommandPaletteItem | undefined) {
  if (!item) return
  open.value = false
  const act = (item as CommandPaletteItem & { run?: () => void }).run
  if (act) setTimeout(act, 60)
}
</script>

<template>
  <UModal v-model:open="open" :ui="{ content: 'max-w-xl p-0 top-[12vh] -translate-y-0', body: 'p-0 sm:p-0' }" title="Command palette" description="Search actions, scenes, projects and settings">
    <template #content>
      <UCommandPalette
        v-model:search-term="term"
        :groups="groups"
        placeholder="Type a command, scene or project…"
        class="h-[min(32rem,70vh)]"
        :fuse="{ resultLimit: 40, fuseOptions: { keys: ['label', 'suffix', 'keywords'] } }"
        @update:model-value="run"
      />
    </template>
  </UModal>
</template>
