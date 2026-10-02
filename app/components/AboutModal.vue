<script setup lang="ts">
// About Bower: which version this is, when it was built, and the tools it uses on this computer.
const open = defineModel<boolean>('open', { default: false })
const toast = useToast()

interface About { version: string, builtAt: string | null, commit: string | null, edition: string, platform: string, runtime: string, chrome: string | null, ffmpeg: string | null, claude: { version: string | null, path: string } | null, dataFolder: string }
const about = ref<About | null>(null)
watch(open, async (o) => { if (o && !about.value) about.value = await $fetch<About>('/api/about').catch(() => null) })

const built = computed(() => {
  const at = about.value?.builtAt
  return at ? new Date(at).toLocaleString(undefined, { dateStyle: 'long', timeStyle: 'short' }) : ''
})
const rows = computed(() => {
  const a = about.value
  if (!a) return []
  return [
    { label: 'Version', value: `${a.version}${a.commit ? ` (${a.commit})` : ''}` },
    { label: 'Built', value: built.value || 'Unknown' },
    { label: 'Edition', value: a.edition },
    { label: 'System', value: a.platform },
    { label: 'Runtime', value: a.runtime },
    { label: 'Claude Code', value: a.claude ? `${a.claude.version ?? 'found'}, ${a.claude.path}` : 'Not found (see Bower settings)' },
    { label: 'Renderer', value: a.chrome ? `Chrome ${a.chrome}` : 'Chrome not found' },
    { label: 'Video encoder', value: a.ffmpeg ? `ffmpeg ${a.ffmpeg}` : 'ffmpeg not found' },
    { label: 'Data folder', value: a.dataFolder, copy: true }
  ]
})
async function copy(text: string) {
  try { await navigator.clipboard.writeText(text); toast.add({ title: 'Copied', color: 'neutral' }) } catch {}
}
function copyAll() {
  copy(rows.value.map(r => `${r.label}: ${r.value}`).join('\n'))
}
</script>

<template>
  <UModal v-model:open="open" title="About Bower" :ui="{ content: 'max-w-lg', footer: 'justify-between' }">
    <template #body>
      <div class="flex items-center gap-4">
        <UAvatar icon="i-lucide-bird" size="xl" :ui="{ root: 'rounded-xl bg-inverted', icon: 'text-inverted' }" />
        <div>
          <p class="text-xl font-semibold tracking-tight text-highlighted">Bower</p>
          <p class="text-sm text-muted">A prompt-driven motion graphics editor. Describe a scene, Claude builds it, and Bower renders it to video frame by frame.</p>
        </div>
      </div>
      <dl v-if="about" class="mt-5 grid grid-cols-[8rem_1fr] gap-x-4 gap-y-2 text-sm">
        <template v-for="r in rows" :key="r.label">
          <dt class="text-muted">{{ r.label }}</dt>
          <dd class="flex min-w-0 items-center gap-1 text-default">
            <span class="truncate" :class="{ 'font-mono text-xs': r.copy || r.label === 'Claude Code' }" :title="r.value">{{ r.value }}</span>
            <UButton v-if="r.copy" size="xs" color="neutral" variant="ghost" icon="i-heroicons-clipboard-document" aria-label="Copy" @click="copy(r.value)" />
          </dd>
        </template>
      </dl>
      <USkeleton v-else class="mt-5 h-48 w-full" />
    </template>
    <template #footer>
      <div class="flex gap-2">
        <UButton color="neutral" variant="ghost" icon="i-heroicons-clipboard-document-list" label="Copy details" :disabled="!about" @click="copyAll" />
        <UButton color="neutral" variant="ghost" icon="i-heroicons-document-text" label="Release notes" trailing-icon="i-heroicons-arrow-top-right-on-square" to="https://github.com/huy-tran/bower/releases" target="_blank" />
      </div>
      <UButton color="neutral" label="Close" @click="open = false" />
    </template>
  </UModal>
</template>
