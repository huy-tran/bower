<script setup lang="ts">
// Claude Code on this computer: whether it is installed and signed in, where Bower found it, and a way to point
// Bower at it when it lives somewhere unusual. Used in Bower settings.
const setup = useSetup()
const toast = useToast()
onMounted(() => setup.checkClaude(true))

const c = computed(() => setup.health.value)
const SOURCES: Record<string, string> = { setting: 'the location you chose', env: 'the desktop app', path: 'the PATH', folder: 'its usual install folder' }
const status = computed(() => {
  if (!c.value) return { icon: 'i-heroicons-arrow-path', color: 'text-muted', title: 'Checking…', detail: '' }
  if (!c.value.installed) return { icon: 'i-heroicons-x-circle', color: 'text-error', title: 'Claude Code was not found', detail: 'Bower uses Claude Code to build scenes. Install it, or point Bower at it below if it is installed somewhere unusual.' }
  if (!c.value.loggedIn) return { icon: 'i-heroicons-exclamation-triangle', color: 'text-warning', title: 'Claude Code is not signed in', detail: 'Open Claude Code once and sign in with your Claude account, then check again.' }
  return { icon: 'i-lucide-circle-check', color: 'text-success', title: `Claude Code ${c.value.version ?? ''} is ready`, detail: '' }
})
const where = computed(() => c.value?.path ? `${c.value.path} (found from ${SOURCES[c.value.source ?? ''] ?? 'an automatic search'})` : '')

const locate = reactive({ path: '', busy: false, picking: false })
watch(c, v => { if (v && !locate.path) locate.path = v.setting || '' }, { immediate: true })
async function browse() {
  locate.picking = true
  try {
    const title = 'Choose the folder that holds Claude Code'
    const desktop = bowerDesktop()
    const path = desktop ? await desktop.pickFolder(title, locate.path || undefined) : (await $fetch<{ path: string | null }>('/api/pick-folder', { method: 'POST', body: { title, initial: locate.path || undefined } })).path
    if (path) locate.path = path
  } catch (err: any) {
    toast.add({ title: 'Could not open the folder chooser', description: err?.data?.message || err?.message, color: 'error' })
  } finally {
    locate.picking = false
  }
}
async function save(path = locate.path) {
  locate.busy = true
  try {
    await $fetch('/api/settings/claude', { method: 'PUT', body: { path } })
    await setup.checkClaude(true)
    if (!path.trim()) locate.path = ''
    toast.add({ title: path.trim() ? 'Claude Code found' : 'Back to finding Claude Code automatically', description: where.value, color: 'success' })
  } catch (err: any) {
    toast.add({ title: 'That is not Claude Code', description: err?.data?.message || err?.message, color: 'error', duration: 10000 })
  } finally {
    locate.busy = false
  }
}
</script>

<template>
  <div class="space-y-5">
    <div class="flex items-start gap-3">
      <UIcon :name="status.icon" class="mt-0.5 size-6 shrink-0" :class="[status.color, { 'animate-spin': !c }]" />
      <div class="min-w-0 flex-1 space-y-1">
        <p class="font-semibold text-highlighted">{{ status.title }}</p>
        <p v-if="status.detail" class="text-sm text-muted">{{ status.detail }}</p>
        <p v-if="where" class="truncate font-mono text-xs text-dimmed" :title="where">{{ where }}</p>
      </div>
      <div class="flex shrink-0 gap-2">
        <UButton v-if="c && !c.installed" color="primary" variant="soft" label="Get Claude Code" trailing-icon="i-heroicons-arrow-top-right-on-square" to="https://claude.com/claude-code" target="_blank" />
        <UButton color="neutral" variant="outline" icon="i-heroicons-arrow-path" label="Check again" :loading="setup.checkingClaude.value" @click="setup.checkClaude(true)" />
      </div>
    </div>

    <UFormField label="Where Claude Code is" hint="Optional" help="Bower looks on the PATH and in the usual install folders. If yours is somewhere else, choose the folder that holds it (or the program itself). Saved for this computer.">
      <div class="flex gap-2">
        <UInput v-model="locate.path" class="flex-1 font-mono text-xs" placeholder="Found automatically" @keydown.enter="save()" />
        <UButton color="neutral" variant="outline" icon="i-heroicons-folder-open" label="Browse…" :loading="locate.picking" @click="browse" />
        <UButton label="Use this" :loading="locate.busy" :disabled="!locate.path.trim() || locate.path === c?.setting" @click="save()" />
      </div>
      <UButton v-if="c?.setting" size="xs" color="neutral" variant="link" label="Find it automatically instead" class="mt-1 px-0" @click="save('')" />
    </UFormField>
  </div>
</template>
