<script setup lang="ts">
// What a new project needs, in plain words, with a button to fix each item. Only Claude Code is required; the
// rest makes videos look like the real product. Shown at the top of Settings, General; the header chip counts
// the same items (see composables/useSetup.ts).
import type { SettingsTab } from './ProjectSettingsModal.vue'

const emit = defineEmits<{ go: [tab: SettingsTab], test: [] }>()
const setup = useSetup()
const toast = useToast()
onMounted(() => { if (!setup.health.value) setup.checkClaude() })

// Where Claude Code is: found automatically, or a folder or program the user points to (this machine, all projects).
const locating = reactive({ open: false, path: '', busy: false, picking: false })
const SOURCES: Record<string, string> = { setting: 'the location you chose', env: 'the desktop app', path: 'the PATH', folder: 'its usual install folder' }
const where = computed(() => {
  const c = setup.health.value
  return c?.path ? `Found at ${c.path}, from ${SOURCES[c.source ?? ''] ?? 'an automatic search'}.` : ''
})
function openLocate() {
  locating.open = true
  locating.path = setup.health.value?.setting || ''
}
async function browse() {
  locating.picking = true
  try {
    const title = 'Choose the folder that holds Claude Code'
    const desktop = bowerDesktop()
    const path = desktop ? await desktop.pickFolder(title, locating.path || undefined) : (await $fetch<{ path: string | null }>('/api/pick-folder', { method: 'POST', body: { title, initial: locating.path || undefined } })).path
    if (path) locating.path = path
  } catch (err: any) {
    toast.add({ title: 'Could not open the folder chooser', description: err?.data?.message || err?.message, color: 'error' })
  } finally {
    locating.picking = false
  }
}
async function saveLocation(path = locating.path) {
  locating.busy = true
  try {
    await $fetch('/api/settings/claude', { method: 'PUT', body: { path } })
    await setup.checkClaude(true)
    locating.open = false
    toast.add({ title: path.trim() ? 'Claude Code found' : 'Back to finding Claude Code automatically', description: where.value, color: 'success' })
  } catch (err: any) {
    toast.add({ title: 'That is not Claude Code', description: err?.data?.message || err?.message, color: 'error', duration: 10000 })
  } finally {
    locating.busy = false
  }
}

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
        <p class="text-xs text-muted">{{ setup.done.value }} of {{ setup.total.value }} done. Only Claude Code is required; the rest makes the video look like your real product.</p>
      </div>
      <UIcon :name="open ? 'i-heroicons-chevron-up' : 'i-heroicons-chevron-down'" class="size-4 text-muted" />
    </button>
    <ul v-if="open" class="mt-4 space-y-3">
      <li v-for="i in setup.items.value" :key="i.key" class="flex items-start gap-3">
        <UIcon :name="i.done ? 'i-lucide-circle-check' : 'i-lucide-circle-dashed'" class="mt-0.5 size-5 shrink-0" :class="i.done ? 'text-success' : i.optional ? 'text-dimmed' : 'text-warning'" />
        <div class="min-w-0 flex-1">
          <p class="text-sm font-medium" :class="i.done ? 'text-muted' : 'text-highlighted'">{{ i.label }}<span v-if="i.optional && !i.done" class="ml-1.5 text-xs font-normal text-dimmed">optional</span></p>
          <p class="truncate text-xs text-muted" :title="i.detail">{{ i.detail }}</p>
          <template v-if="i.key === 'claude'">
            <p v-if="where" class="truncate text-xs text-dimmed" :title="where">{{ where }}</p>
            <div v-if="locating.open" class="mt-2 space-y-2">
              <div class="flex gap-2">
                <UInput v-model="locating.path" size="sm" class="flex-1 font-mono text-xs" placeholder="Folder that holds Claude Code, or the program itself" @keydown.enter="saveLocation()" />
                <UButton size="sm" color="neutral" variant="outline" icon="i-heroicons-folder-open" label="Browse…" :loading="locating.picking" @click="browse" />
              </div>
              <div class="flex items-center gap-2">
                <UButton size="xs" label="Use this" :loading="locating.busy" :disabled="!locating.path.trim()" @click="saveLocation()" />
                <UButton v-if="setup.health.value?.setting" size="xs" color="neutral" variant="ghost" label="Find it automatically" @click="saveLocation('')" />
                <UButton size="xs" color="neutral" variant="ghost" label="Cancel" @click="locating.open = false" />
              </div>
              <p class="text-xs text-dimmed">Saved for this computer and used by every project.</p>
            </div>
          </template>
        </div>
        <template v-if="i.key === 'claude'">
          <UButton v-if="setup.health.value && !setup.health.value.installed" size="xs" color="primary" variant="soft" label="Get Claude Code" trailing-icon="i-heroicons-arrow-top-right-on-square" to="https://claude.com/claude-code" target="_blank" />
          <UButton v-if="!locating.open" size="xs" color="neutral" variant="outline" :label="setup.health.value?.installed ? 'Change location' : 'Locate…'" @click="openLocate" />
          <UButton v-if="!i.done" size="xs" color="neutral" variant="outline" label="Check again" :loading="setup.checkingClaude.value" @click="setup.checkClaude(true)" />
        </template>
        <UButton v-else-if="i.action && !(i.done && i.key !== 'reach')" size="xs" color="neutral" variant="outline" :label="i.action" @click="act(i.key, i.tab)" />
      </li>
    </ul>
  </UCard>
</template>
