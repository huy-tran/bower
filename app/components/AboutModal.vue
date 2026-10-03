<script setup lang="ts">
// About Bower: which version this is, when it was built, the tools it uses on this computer, and what's new.
import changelog from '../../CHANGELOG.md?raw'

const open = defineModel<boolean>('open', { default: false })

// This version's section of CHANGELOG.md, as groups of bullets (bold lead-ins kept). Rendered as text, no HTML.
interface NoteItem { lead: string, text: string }
const whatsNew = computed(() => {
  const version = useRuntimeConfig().public.version as string
  const lines = changelog.split(/\r?\n/)
  const start = lines.findIndex(l => l === `## ${version}` || l.startsWith(`## ${version} `))
  if (start < 0) return null
  const groups: { title: string, items: NoteItem[] }[] = []
  for (const line of lines.slice(start + 1)) {
    if (line.startsWith('## ')) break
    if (line.startsWith('### ')) { groups.push({ title: line.slice(4).trim(), items: [] }); continue }
    if (!groups.length) groups.push({ title: '', items: [] })
    const g = groups[groups.length - 1]!
    if (line.startsWith('- ')) {
      const m = line.slice(2).match(/^\*\*(.+?)\*\*\s*(.*)$/)
      g.items.push(m ? { lead: m[1]!, text: m[2]! } : { lead: '', text: line.slice(2) })
    } else if (line.trim() && g.items.length) g.items[g.items.length - 1]!.text += ` ${line.trim()}`
  }
  return { version, groups: groups.filter(x => x.items.length) }
})
const showNew = ref(false)
const toast = useToast()
const updates = useUpdateCheck()

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
      <div v-if="whatsNew" class="mt-5 border-t border-default pt-4">
        <button type="button" class="flex w-full items-center justify-between text-left" @click="showNew = !showNew">
          <span class="font-semibold text-highlighted">What’s new in {{ whatsNew.version }}</span>
          <UIcon :name="showNew ? 'i-heroicons-chevron-up' : 'i-heroicons-chevron-down'" class="size-4 text-muted" />
        </button>
        <div v-if="showNew" class="mt-3 max-h-80 space-y-3 overflow-y-auto pr-1 text-sm">
          <div v-for="g in whatsNew.groups" :key="g.title">
            <p v-if="g.title" class="mb-1 text-xs font-semibold tracking-wide text-muted uppercase">{{ g.title }}</p>
            <ul class="list-disc space-y-1.5 pl-5">
              <li v-for="(it, i) in g.items" :key="i"><span v-if="it.lead" class="font-medium text-highlighted">{{ it.lead }} </span><span class="text-default">{{ it.text }}</span></li>
            </ul>
          </div>
        </div>
      </div>
    </template>
    <template #footer>
      <div class="flex gap-2">
        <UButton color="neutral" variant="ghost" icon="i-heroicons-clipboard-document-list" label="Copy details" :disabled="!about" @click="copyAll" />
        <UButton v-if="updates.available.value" color="neutral" variant="ghost" icon="i-heroicons-arrow-path" label="Check for updates" :loading="updates.checking.value" @click="updates.check()" />
        <UButton color="neutral" variant="ghost" icon="i-heroicons-document-text" label="Release notes" trailing-icon="i-heroicons-arrow-top-right-on-square" to="https://github.com/huy-tran/bower/releases" target="_blank" />
      </div>
      <UButton color="neutral" label="Close" @click="open = false" />
    </template>
  </UModal>
</template>
