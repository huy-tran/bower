<script setup lang="ts">
import type { DesktopUpdateInfo } from '~/utils/desktop'

// Desktop app only: once a new version has downloaded in the background, a dialog offers to restart
// into it. "Later" keeps a button in the header and does not ask again for that version until
// Bower is next opened; the update also installs whenever Bower quits.
const desktop = bowerDesktop()
const update = ref<DesktopUpdateInfo | null>(null)
const installing = ref(false)
const dialogOpen = ref(false)
const DISMISSED = 'bower:update-dismissed'

const ready = computed(() => update.value?.state === 'ready')

function dismissed() {
  try { return sessionStorage.getItem(DISMISSED) } catch { return null }
}

watch(update, (u) => {
  if (u?.state === 'ready' && dismissed() !== u.version) dialogOpen.value = true
})
// Check for updates found this version already downloaded: ask again even after a "Later".
const { reopen } = useUpdateCheck()
watch(reopen, () => { if (ready.value) dialogOpen.value = true })

let stop: (() => void) | undefined
onMounted(async () => {
  if (!desktop) return
  stop = desktop.onUpdate(u => (update.value = u))
  update.value ??= await desktop.updateState()
})
onBeforeUnmount(() => stop?.())

function later() {
  try { sessionStorage.setItem(DISMISSED, update.value!.version) } catch {}
  dialogOpen.value = false
}

function install() {
  installing.value = true
  desktop?.installUpdate()
}
</script>

<template>
  <template v-if="ready">
    <UButton color="primary" size="sm" icon="i-heroicons-arrow-path" :label="`Restart to update to v${update!.version}`" :loading="installing" @click="dialogOpen = true" />

    <UModal v-model:open="dialogOpen" :title="`Bower ${update!.version} is ready`" description="It has downloaded in the background. Restart now to finish updating." :ui="{ footer: 'justify-end' }" @update:open="o => !o && !installing && later()">
      <template #body>
        <div class="flex items-start gap-3">
          <UIcon name="i-heroicons-arrow-path-rounded-square" class="mt-0.5 size-6 shrink-0 text-primary" />
          <div class="space-y-1 text-sm">
            <p class="text-highlighted">Bower closes and reopens on version {{ update!.version }} in a few seconds. Your projects stay as they are.</p>
            <p class="text-muted">Restarting stops any render or Claude reply in progress. Choose Later to finish those first; the update also installs the next time you quit Bower.</p>
          </div>
        </div>
        <div v-if="update!.notes" class="mt-4 border-t border-default pt-3">
          <p class="mb-2 text-sm font-semibold text-highlighted">What’s new</p>
          <!-- Plain text from the release notes (electron/main.mjs strips the markup). -->
          <p class="max-h-72 overflow-y-auto text-sm whitespace-pre-line text-default">{{ update!.notes }}</p>
        </div>
      </template>
      <template #footer>
        <UButton color="neutral" variant="ghost" label="Later" :disabled="installing" @click="later" />
        <UButton color="primary" icon="i-heroicons-arrow-path" label="Restart now" :loading="installing" @click="install" />
      </template>
    </UModal>
  </template>
</template>
