<script setup lang="ts">
import type { DesktopUpdate } from '~/utils/desktop'

// Desktop app only: once a new version has downloaded in the background, offer to restart into it.
const desktop = bowerDesktop()
const update = ref<DesktopUpdate | null>(null)
const installing = ref(false)

let stop: (() => void) | undefined
onMounted(async () => {
  if (!desktop) return
  stop = desktop.onUpdate(u => (update.value = u))
  update.value ??= await desktop.updateState()
})
onBeforeUnmount(() => stop?.())

function install() {
  installing.value = true
  desktop?.installUpdate()
}
</script>

<template>
  <UTooltip v-if="update?.state === 'ready'" :text="`Bower ${update.version} has downloaded. Restarting takes a few seconds and stops any render or Claude reply in progress. It also installs the next time you quit.`">
    <UButton color="primary" size="sm" icon="i-heroicons-arrow-path" :label="`Restart to update to v${update.version}`" :loading="installing" @click="install" />
  </UTooltip>
</template>
