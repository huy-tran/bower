<script setup lang="ts">
interface Version { n: number, at: string, label: string }

const { project, selected, selectedIndex, setProject, select } = useEditor()
const chat = useChat()
const toast = useToast()

const tab = ref<'scene' | 'project'>('scene')
const draft = ref('')
const scroller = ref<HTMLElement>()
const versions = ref<{ current: number, items: Version[] }>({ current: 0, items: [] })
const versionsOpen = ref(false)
const editingTitle = ref(false)
const titleDraft = ref('')
const editingDuration = ref(false)
const durationDraft = ref('')
const now = ref(Date.now())
let clock: ReturnType<typeof setInterval>

const key = computed(() => tab.value === 'project' ? 'project' : selected.value?.id ?? '')
const pid = computed(() => project.value?.id ?? '')
const current = computed(() => pid.value && key.value ? chat.thread(pid.value, key.value) : null)
const busy = computed(() => current.value?.job?.status === 'running')
const hasBeats = computed(() => !!project.value?.audio?.beats.length)

watch([pid, key], ([p, k]) => { if (p && k) chat.load(p, k).catch(() => {}) }, { immediate: true })

watch(() => current.value?.messages.length, async () => {
  await nextTick()
  scroller.value?.scrollTo({ top: scroller.value.scrollHeight, behavior: 'smooth' })
})
watch(() => current.value?.job?.activity.length, async () => {
  await nextTick()
  scroller.value?.scrollTo({ top: scroller.value.scrollHeight })
})

onMounted(() => { clock = setInterval(() => (now.value = Date.now()), 250) })
onBeforeUnmount(() => clearInterval(clock))

function fail(e: any, title: string) {
  toast.add({ title, description: e?.data?.message || e?.message, color: 'error' })
}

async function send(text?: string) {
  const msg = (text ?? draft.value).trim()
  if (!msg || busy.value || !key.value) return
  if (!text) draft.value = ''
  try {
    await chat.send(pid.value, key.value, msg)
  } catch (e) {
    fail(e, 'Could not start Claude')
  }
}

function onKey(e: KeyboardEvent) {
  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
    e.preventDefault()
    send()
  }
}

async function loadVersions() {
  if (!selected.value) return
  versions.value = await $fetch(`/api/projects/${pid.value}/scenes/${selected.value.id}/versions`)
}
watch(versionsOpen, (o) => { if (o) loadVersions() })

async function undo() {
  try {
    setProject(await $fetch(`/api/projects/${pid.value}/scenes/${selected.value!.id}/undo`, { method: 'POST' }))
  } catch (e) { fail(e, 'Nothing to undo') }
}

async function restore(n: number) {
  setProject(await $fetch(`/api/projects/${pid.value}/scenes/${selected.value!.id}/versions/${n}/restore`, { method: 'POST' }))
  versionsOpen.value = false
}

async function duplicate() {
  const res = await $fetch<{ id: string, project: any }>(`/api/projects/${pid.value}/scenes/${selected.value!.id}/duplicate`, { method: 'POST' })
  setProject(res.project)
  select(res.id)
}

async function remove() {
  const s = selected.value!
  if (!confirm(`Delete scene "${s.title}"? Its versions and chat are deleted too.`)) return
  try {
    setProject(await $fetch(`/api/projects/${pid.value}/scenes/${s.id}`, { method: 'DELETE' }))
  } catch (e) { fail(e, 'Could not delete scene') }
}

function openExternal() {
  window.open(frameUrl(pid.value, selected.value!), '_blank')
}

async function clearChat() {
  await chat.clear(pid.value, key.value)
}

function startTitle() {
  titleDraft.value = tab.value === 'project' ? project.value!.name : selected.value!.title
  editingTitle.value = true
}
async function saveTitle() {
  editingTitle.value = false
  const t = titleDraft.value.trim()
  if (!t) return
  if (tab.value === 'project') setProject(await $fetch(`/api/projects/${pid.value}`, { method: 'PATCH', body: { name: t } }))
  else setProject(await $fetch(`/api/projects/${pid.value}/scenes/${selected.value!.id}`, { method: 'PATCH', body: { title: t } }))
  if (tab.value === 'project') useEditor().loadProjects()
}

function startDuration() {
  durationDraft.value = (selected.value!.duration / 1000).toFixed(2)
  editingDuration.value = true
}
async function saveDuration() {
  editingDuration.value = false
  const ms = Math.round(parseFloat(durationDraft.value) * 1000)
  if (!ms || ms < 100 || ms === selected.value!.duration) return
  setProject(await $fetch(`/api/projects/${pid.value}/scenes/${selected.value!.id}`, { method: 'PATCH', body: { duration: ms } }))
}

const placeholder = computed(() => tab.value === 'project'
  ? 'Ask about the whole video, e.g. "Add a closing scene after the logo" or "Make every headline 10% smaller."'
  : 'What should change? e.g. "Hold on the headline a full second longer, then slide the card in from the right."')

function timeAgo(iso: string) {
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.round(s / 60)}m ago`
  if (s < 86400) return `${Math.round(s / 3600)}h ago`
  return new Date(iso).toLocaleDateString()
}
</script>

<template>
  <aside v-if="project && selected" class="flex min-h-0 flex-col border-l border-zinc-200 bg-white">
    <div class="flex items-center gap-3 border-b border-zinc-100 px-4 py-3">
      <div class="flex rounded-lg bg-zinc-100 p-0.5 text-sm">
        <button v-for="t in (['scene', 'project'] as const)" :key="t" class="rounded-md px-3 py-1 capitalize transition" :class="tab === t ? 'bg-white font-medium text-zinc-900 shadow-sm' : 'text-zinc-500 hover:text-zinc-700'" @click="tab = t">
          {{ t }}
        </button>
      </div>
      <UInput v-if="editingTitle" v-model="titleDraft" size="sm" autofocus class="min-w-0 flex-1" @blur="saveTitle" @keydown.enter="saveTitle" @keydown.esc="editingTitle = false" />
      <button v-else class="min-w-0 flex-1 truncate text-left text-base font-semibold text-zinc-900 hover:text-zinc-600" title="Rename" @click="startTitle">
        {{ tab === 'project' ? project.name : selected.title }}
      </button>
      <template v-if="tab === 'scene'">
        <UInput v-if="editingDuration" v-model="durationDraft" size="xs" autofocus class="w-20" @blur="saveDuration" @keydown.enter="saveDuration" @keydown.esc="editingDuration = false">
          <template #trailing><span class="text-xs text-zinc-400">s</span></template>
        </UInput>
        <button v-else class="font-mono text-sm text-zinc-500 hover:text-zinc-800" title="Change duration" @click="startDuration">{{ fmtSeconds(selected.duration) }}</button>
      </template>
      <span v-else class="font-mono text-sm text-zinc-500">{{ fmtSeconds(project.duration) }}</span>
    </div>

    <div class="flex items-center gap-1.5 border-b border-zinc-100 px-4 py-2.5">
      <template v-if="tab === 'scene'">
        <UButton size="sm" color="neutral" variant="outline" icon="i-lucide-undo-2" label="Undo" :disabled="busy" @click="undo" />
        <UPopover v-model:open="versionsOpen" :content="{ align: 'start' }">
          <UButton size="sm" color="neutral" variant="outline" icon="i-lucide-history" :label="`Versions (${project.versions[selected.id] ?? 0})`" :disabled="busy" />
          <template #content>
            <div class="max-h-80 w-80 overflow-y-auto p-1">
              <button
                v-for="v in [...versions.items].reverse()"
                :key="v.n"
                class="flex w-full items-start gap-2 rounded-md px-2.5 py-2 text-left text-sm hover:bg-zinc-50"
                @click="restore(v.n)"
              >
                <span class="mt-px font-mono text-xs text-zinc-400">v{{ v.n }}</span>
                <span class="min-w-0 flex-1">
                  <span class="line-clamp-2 text-zinc-800">{{ v.label }}</span>
                  <span class="text-xs text-zinc-400">{{ timeAgo(v.at) }}</span>
                </span>
                <UIcon v-if="v.n === versions.current" name="i-lucide-check" class="mt-0.5 size-4 text-blue-500" />
              </button>
              <p v-if="!versions.items.length" class="px-2.5 py-2 text-sm text-zinc-400">No versions yet.</p>
            </div>
          </template>
        </UPopover>
        <UTooltip text="Open scene in a new tab"><UButton size="sm" color="neutral" variant="ghost" icon="i-lucide-external-link" @click="openExternal" /></UTooltip>
        <UTooltip text="Duplicate scene"><UButton size="sm" color="neutral" variant="ghost" icon="i-lucide-copy" @click="duplicate" /></UTooltip>
        <UTooltip text="Delete scene"><UButton size="sm" color="error" variant="ghost" icon="i-lucide-trash-2" :disabled="project.scenes.length <= 1" @click="remove" /></UTooltip>
      </template>
      <span v-else class="text-xs text-zinc-500">Changes can touch any scene, and each changed scene gets a new version.</span>
      <UButton class="ml-auto" size="sm" color="neutral" variant="ghost" label="Clear chat" :disabled="busy || !current?.messages.length" @click="clearChat" />
    </div>

    <div ref="scroller" class="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4">
      <div v-if="current && !current.messages.length && !busy" class="mt-8 px-4 text-center text-sm text-zinc-400">
        <UIcon name="i-lucide-sparkles" class="mx-auto mb-2 size-6" />
        <p v-if="tab === 'scene'">Describe a change to <span class="font-medium text-zinc-600">{{ selected.title }}</span>. Claude edits <code class="text-xs">{{ selected.file }}</code> and the preview reloads when it's done.</p>
        <p v-else>Ask for changes across the whole video: add, reorder or restyle scenes.</p>
      </div>
      <template v-for="(m, i) in current?.messages" :key="i">
        <div v-if="m.role === 'user'" class="ml-8 rounded-xl bg-zinc-900 px-3.5 py-2.5 text-[15px] leading-relaxed whitespace-pre-wrap text-white">{{ m.text }}</div>
        <div v-else class="rounded-xl px-3.5 py-3 text-[15px] leading-relaxed whitespace-pre-wrap" :class="m.role === 'error' ? 'bg-red-50 text-red-700' : 'bg-zinc-100 text-zinc-800'">
          {{ m.text }}
          <div v-if="m.durationMs" class="mt-1.5 text-xs text-zinc-400">{{ Math.round(m.durationMs / 1000) }}s<template v-if="m.costUsd"> · ${{ m.costUsd.toFixed(2) }}</template></div>
        </div>
      </template>
      <div v-if="busy && current?.job" class="rounded-xl bg-zinc-50 px-3.5 py-3 text-sm ring-1 ring-zinc-100">
        <div class="mb-1.5 flex items-center gap-2 font-medium text-zinc-700">
          <UIcon name="i-lucide-loader-circle" class="size-4 animate-spin" />
          Claude is working · {{ Math.round((now - current.job.startedAt) / 1000) }}s
          <UButton class="ml-auto" size="xs" color="neutral" variant="ghost" label="Stop" @click="chat.cancel(pid, key)" />
        </div>
        <p v-for="(a, i) in current.job.activity" :key="i" class="truncate font-mono text-xs leading-5 text-zinc-500">{{ a }}</p>
      </div>
    </div>

    <div class="border-t border-zinc-100 p-4">
      <div v-if="tab === 'scene' && hasBeats && !busy" class="mb-2 flex flex-wrap gap-1.5">
        <UButton size="xs" color="neutral" variant="soft" icon="i-lucide-audio-waveform" label="Snap motion to beats" @click="send('Retime this scene so its key motion moments land exactly on the music: big arrivals on downbeats, smaller accents on beats. Keep the choreography and look the same otherwise.')" />
        <UButton size="xs" color="neutral" variant="soft" icon="i-lucide-scissors" label="Match the next cut" :disabled="selectedIndex >= project.scenes.length - 1" @click="send('Make the last frame of this scene match the first frame of the next scene exactly so the cut is invisible.')" />
      </div>
      <div class="rounded-xl ring-1 ring-zinc-200 focus-within:ring-2 focus-within:ring-zinc-400">
        <textarea
          v-model="draft"
          rows="3"
          class="block w-full resize-none rounded-t-xl bg-transparent px-3.5 pt-3 text-[15px] leading-relaxed text-zinc-900 placeholder:text-zinc-400 focus:outline-none"
          :placeholder="placeholder"
          :disabled="busy"
          @keydown="onKey"
        />
        <div class="flex items-center px-3 pb-2.5">
          <span class="text-xs text-zinc-400">Ctrl/⌘ + Enter to send</span>
          <UButton class="ml-auto" color="neutral" label="Send" :loading="busy" :disabled="!draft.trim()" @click="send()" />
        </div>
      </div>
    </div>
  </aside>
</template>
