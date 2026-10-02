<script setup lang="ts">
// What a project needs to look like the real product, in plain words, with a button to fix each item. Claude
// Code itself is set up in Bower settings. Shown at the top of Settings, General; the header chip counts
// the same items (see composables/useSetup.ts).
import type { SettingsTab } from './ProjectSettingsModal.vue'

const emit = defineEmits<{ go: [tab: SettingsTab], test: [] }>()
const setup = useSetup()
const bower = useBowerSettings()
onMounted(() => { if (!setup.health.value) setup.checkClaude() })
const allDone = computed(() => setup.done.value === setup.total.value)
const open = ref(!allDone.value)
watch(allDone, (d) => { if (d) open.value = false })
function act(key: string, tab?: SettingsTab) {
  if (key === 'reach') emit('test')
  else if (tab) emit('go', tab)
}
</script>

<template>
  <UCard :ui="{ body: 'p-4 sm:p-4' }">
    <button type="button" class="flex w-full items-center gap-3 text-left" @click="open = !open">
      <UIcon :name="allDone ? 'i-heroicons-check-badge' : 'i-heroicons-rocket-launch'" class="size-5 shrink-0" :class="allDone ? 'text-success' : 'text-primary'" />
      <div class="min-w-0 flex-1">
        <h3 class="font-semibold text-highlighted">{{ allDone ? 'All set up' : 'Set up this project' }}</h3>
        <p class="text-xs text-muted">{{ setup.done.value }} of {{ setup.total.value }} done. All optional: they make the video look like your real product.</p>
      </div>
      <UIcon :name="open ? 'i-heroicons-chevron-up' : 'i-heroicons-chevron-down'" class="size-4 text-muted" />
    </button>
    <UAlert v-if="setup.blocked.value" class="mt-4" color="warning" variant="soft" icon="i-heroicons-exclamation-triangle" :title="setup.health.value?.installed ? 'Claude Code is not signed in' : 'Claude Code was not found'" description="Claude cannot build scenes until it is ready. It is set up once for this computer, in Bower settings." :actions="[{ label: 'Open Bower settings', color: 'warning', variant: 'outline', onClick: () => bower.show('claude') }]" />
    <ul v-if="open" class="mt-4 space-y-3">
      <li v-for="i in setup.items.value" :key="i.key" class="flex items-start gap-3">
        <UIcon :name="i.done ? 'i-lucide-circle-check' : 'i-lucide-circle-dashed'" class="mt-0.5 size-5 shrink-0" :class="i.done ? 'text-success' : i.optional ? 'text-dimmed' : 'text-warning'" />
        <div class="min-w-0 flex-1">
          <p class="text-sm font-medium" :class="i.done ? 'text-muted' : 'text-highlighted'">{{ i.label }}<span v-if="i.optional && !i.done" class="ml-1.5 text-xs font-normal text-dimmed">optional</span></p>
          <p class="truncate text-xs text-muted" :title="i.detail">{{ i.detail }}</p>
        </div>
        <UButton v-if="i.action && !(i.done && i.key !== 'reach')" size="xs" color="neutral" variant="outline" :label="i.action" @click="act(i.key, i.tab)" />
      </li>
    </ul>
  </UCard>
</template>
