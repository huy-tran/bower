<script setup lang="ts">
import type { DropdownMenuItem } from '@nuxt/ui'

interface Version { n: number, at: string, label: string }
interface Attachment { path: string, url: string, name: string }

const { project, selected, selectedIndex, setProject, select, time, mode, active } = useEditor()
const chat = useChat()
const toast = useToast()

const tab = ref<'scene' | 'project'>('scene')
const draft = ref('')
const attachments = ref<Attachment[]>([])
// Screenshots sent over from Settings, App land here as pending attachments.
watch(chat.queuedAttachments, (list) => {
  if (!list.length) return
  attachments.value = [...attachments.value, ...list.filter(a => !attachments.value.some(x => x.path === a.path))].slice(0, 8)
  chat.queuedAttachments.value = []
}, { immediate: true })
const uploading = ref(false)
const dragOver = ref(false)
const fileInput = ref<HTMLInputElement>()
const versions = ref<{ current: number, items: Version[] }>({ current: 0, items: [] })
const editingTitle = ref(false)
const titleDraft = ref('')
const editingDuration = ref(false)
const durationDraft = ref('')
const confirmDelete = ref(false)
const comparing = ref(false)
const now = ref(Date.now())
let clock: ReturnType<typeof setInterval>

const tabs = [{ label: 'Scene', value: 'scene' }, { label: 'Project', value: 'project' }]
const MODELS = [
  { label: 'Default model', value: 'default', description: 'The one set in Bower settings' },
  { label: 'Opus', value: 'opus', description: 'Best for building scenes' },
  { label: 'Sonnet', value: 'sonnet', description: 'Fast, good for tweaks' },
  { label: 'Haiku', value: 'haiku', description: 'Fastest, simple edits' }
]
// "Default" sends no model, so the server uses the one in Bower settings (or Claude Code's own). A pick here
// applies to this editor session only.
const model = ref('default')

// How Claude shows the app in this scene (saved in the scene's meta block); empty means the project setting.
const APP_MODES = [
  { label: 'App: project default', value: 'default', description: 'Follow the setting in Settings, App' },
  { label: 'App: screenshots', value: 'shots', description: 'Place real screenshots, animate with crops and zooms' },
  { label: 'App: rebuild', value: 'rebuild', description: 'Redraw screens in HTML so parts animate separately' },
  { label: 'App: Claude decides', value: 'auto', description: 'Whichever suits the request' }
]
const appMode = computed({
  get: () => selected.value?.app ?? 'default',
  set: async (v: string) => {
    if (!project.value || !selected.value) return
    setProject(await $fetch(`/api/projects/${project.value.id}/scenes/${selected.value.id}`, { method: 'PATCH', body: { app: v === 'default' ? null : v } }))
  }
})

const key = computed(() => tab.value === 'project' ? 'project' : selected.value?.id ?? '')
const pid = computed(() => project.value?.id ?? '')
const current = computed(() => pid.value && key.value ? chat.thread(pid.value, key.value) : null)
const job = computed(() => current.value?.job?.status === 'running' ? current.value.job : null)
const busy = computed(() => !!job.value)
const hasBeats = computed(() => !!project.value?.audio?.beats.length)

// Scene-relative playhead time, for the "at 1.20s" chip and the prompt context.
const sceneTime = computed(() => {
  if (!selected.value) return 0
  if (mode.value === 'scene') return time.value
  return active.value?.scene.id === selected.value.id ? active.value.t : 0
})

// UChatMessages expects AI SDK shaped messages.
const messages = computed(() => {
  const list = (current.value?.messages ?? []).map((m, i) => ({
    id: `${key.value}-${i}`,
    role: m.role === 'user' ? 'user' as const : 'assistant' as const,
    parts: [{ type: 'text' as const, text: m.text }],
    metadata: { error: m.role === 'error', durationMs: m.durationMs, costUsd: m.costUsd, attachments: m.attachments, streaming: false }
  }))
  // Claude's reply as it is being written.
  if (job.value?.partial?.trim()) {
    list.push({ id: `${key.value}-partial`, role: 'assistant', parts: [{ type: 'text', text: job.value.partial }], metadata: { error: false, durationMs: undefined, costUsd: undefined, attachments: undefined, streaming: true } })
  }
  return list
})

watch([pid, key], ([p, k]) => { if (p && k) chat.load(p, k).catch(() => {}) }, { immediate: true })

onMounted(() => { clock = setInterval(() => (now.value = Date.now()), 250) })
onBeforeUnmount(() => clearInterval(clock))

function fail(e: any, title: string) {
  toast.add({ title, description: e?.data?.message || e?.message, color: 'error' })
}

const dictation = useDictation(text => (draft.value = text))
watch(dictation.error, (e) => { if (e) toast.add({ title: 'Voice input', description: e, color: 'error' }) })
// Dictation belongs to one thread; switching scene or tab ends it.
watch(key, () => dictation.stop())

async function send(text?: string) {
  if (dictation.listening.value) await dictation.stop()
  const msg = (text ?? draft.value).trim()
  if (!msg || busy.value || !key.value) return
  const files = text ? [] : attachments.value.map(a => a.path)
  if (!text) {
    draft.value = ''
    attachments.value = []
  }
  try {
    await chat.send(pid.value, key.value, msg, {
      model: model.value === 'default' ? undefined : model.value,
      attachments: files.length ? files : undefined,
      at: tab.value === 'scene' ? Math.round(sceneTime.value) : undefined
    })
  } catch (e) {
    fail(e, 'Could not start Claude')
  }
}

function insertTime() {
  const chip = `(at ${(sceneTime.value / 1000).toFixed(2)}s) `
  draft.value = draft.value && !draft.value.endsWith(' ') ? `${draft.value} ${chip}` : `${draft.value}${chip}`
}

async function addFiles(files: File[]) {
  const images = files.filter(f => f.type.startsWith('image/'))
  if (!images.length) return
  uploading.value = true
  try {
    const form = new FormData()
    for (const f of images.slice(0, 8)) form.append('file', f)
    const res = await $fetch<{ files: Attachment[] }>(`/api/projects/${pid.value}/assets`, { method: 'POST', body: form })
    attachments.value = [...attachments.value, ...res.files].slice(0, 8)
  } catch (e) {
    fail(e, 'Could not attach')
  } finally {
    uploading.value = false
  }
}
function onPick(e: Event) {
  addFiles([...((e.target as HTMLInputElement).files ?? [])])
  ;(e.target as HTMLInputElement).value = ''
}
function onDrop(e: DragEvent) {
  dragOver.value = false
  const files = [...(e.dataTransfer?.files ?? [])]
  if (files.some(f => f.type.startsWith('image/'))) {
    e.preventDefault()
    e.stopPropagation()
    addFiles(files)
  }
}
function onPaste(e: ClipboardEvent) {
  const files = [...(e.clipboardData?.files ?? [])]
  if (files.some(f => f.type.startsWith('image/'))) {
    e.preventDefault()
    addFiles(files)
  }
}

async function loadVersions(open: boolean) {
  if (open && selected.value) versions.value = await $fetch(`/api/projects/${pid.value}/scenes/${selected.value.id}/versions`)
}

const versionItems = computed<DropdownMenuItem[][]>(() => [
  versions.value.items.length
    ? [...versions.value.items].reverse().map(v => ({
        label: `v${v.n} · ${timeAgo(v.at)}`,
        description: v.label,
        icon: v.n === versions.value.current ? 'i-heroicons-check' : 'i-heroicons-clock',
        color: v.n === versions.value.current ? 'primary' : undefined,
        onSelect: () => restore(v.n)
      }))
    : [{ label: 'No versions yet', disabled: true }],
  [{ label: 'Compare versions side by side', icon: 'i-heroicons-view-columns', disabled: versions.value.items.length < 2, onSelect: () => (comparing.value = true) }]
])

async function undo() {
  try {
    setProject(await $fetch(`/api/projects/${pid.value}/scenes/${selected.value!.id}/undo`, { method: 'POST' }))
  } catch (e) { fail(e, 'Nothing to undo') }
}

async function restore(n: number) {
  setProject(await $fetch(`/api/projects/${pid.value}/scenes/${selected.value!.id}/versions/${n}/restore`, { method: 'POST' }))
  toast.add({ title: `Restored v${n}`, color: 'neutral' })
}

// Save the selected scene as a reusable template.
const savingTemplate = ref(false)
const templateForm = reactive({ open: false, name: '', description: '' })
function openSaveTemplate() {
  templateForm.name = selected.value?.title ?? ''
  templateForm.description = ''
  templateForm.open = true
}
async function saveTemplate() {
  if (!templateForm.name.trim()) return
  savingTemplate.value = true
  try {
    const t = await $fetch<{ name: string }>(`/api/projects/${pid.value}/scenes/${selected.value!.id}/template`, { method: 'POST', body: { name: templateForm.name, description: templateForm.description } })
    templateForm.open = false
    toast.add({ title: `Saved “${t.name}” as a template`, description: 'Insert it in any project from Add scene, then From a template.', color: 'success' })
  } catch (e) {
    fail(e, 'Could not save the template')
  } finally {
    savingTemplate.value = false
  }
}

async function duplicate() {
  const res = await $fetch<{ id: string, project: any }>(`/api/projects/${pid.value}/scenes/${selected.value!.id}/duplicate`, { method: 'POST' })
  setProject(res.project)
  select(res.id)
}

async function remove() {
  confirmDelete.value = false
  const title = selected.value!.title
  try {
    setProject(await $fetch(`/api/projects/${pid.value}/scenes/${selected.value!.id}`, { method: 'DELETE' }))
    toast.add({ title: `"${title}" moved to the trash`, description: 'Restore it from the project menu within 30 days.', color: 'neutral' })
  } catch (e) { fail(e, 'Could not delete scene') }
}

async function copyScenePath() {
  const path = selected.value?.path
  if (!path) return
  await navigator.clipboard.writeText(path)
  toast.add({ title: 'Scene file path copied', description: path, color: 'neutral' })
}

function openExternal() {
  window.open(frameUrl(pid.value, selected.value!), '_blank')
}

function startTitle() {
  titleDraft.value = tab.value === 'project' ? project.value!.name : selected.value!.title
  editingTitle.value = true
}
async function saveTitle() {
  if (!editingTitle.value) return
  editingTitle.value = false
  const t = titleDraft.value.trim()
  if (!t) return
  if (tab.value === 'project') {
    setProject(await $fetch(`/api/projects/${pid.value}`, { method: 'PATCH', body: { name: t } }))
    useEditor().loadProjects()
  } else {
    setProject(await $fetch(`/api/projects/${pid.value}/scenes/${selected.value!.id}`, { method: 'PATCH', body: { title: t } }))
  }
}

function startDuration() {
  durationDraft.value = (selected.value!.duration / 1000).toFixed(2)
  editingDuration.value = true
}
async function saveDuration() {
  if (!editingDuration.value) return
  editingDuration.value = false
  const ms = Math.round(parseFloat(durationDraft.value) * 1000)
  if (!ms || ms < 100 || ms === selected.value!.duration) return
  setProject(await $fetch(`/api/projects/${pid.value}/scenes/${selected.value!.id}`, { method: 'PATCH', body: { duration: ms } }))
}

const placeholder = computed(() => tab.value === 'project'
  ? 'Ask about the whole video, e.g. "Add a closing scene after the logo" or "Make every headline 10% smaller."'
  : 'What should change? e.g. "Hold on the headline a full second longer, then slide the card in from the right."')

const toolIcon = (a: string) => a.startsWith('Looking at frames') || a.startsWith('Viewing') ? 'i-heroicons-photo'
  : a.startsWith('Checking the cuts') ? 'i-heroicons-scissors'
    : a.startsWith('Reading') ? 'i-heroicons-document-magnifying-glass'
      : a.startsWith('Editing') || a.startsWith('Writing') ? 'i-heroicons-pencil-square'
        : a.startsWith('Searching') ? 'i-heroicons-magnifying-glass'
          : 'i-heroicons-chat-bubble-left'

const assetUrl = (path: string) => `/api/projects/${pid.value}/files/${path}`

function timeAgo(iso: string) {
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.round(s / 60)}m ago`
  if (s < 86400) return `${Math.round(s / 3600)}h ago`
  return new Date(iso).toLocaleDateString()
}
</script>

<template>
  <aside
    v-if="project && selected"
    class="relative flex min-h-0 flex-col border-l border-default bg-default"
    @dragover.prevent="e => e.dataTransfer?.types.includes('Files') && (dragOver = true)"
    @dragleave="e => !(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node) && (dragOver = false)"
    @drop.capture="onDrop"
  >
    <input ref="fileInput" type="file" accept="image/*" multiple class="hidden" @change="onPick">
    <div class="flex items-center gap-3 border-b border-default px-4 py-3">
      <UTabs v-model="tab" :items="tabs" :content="false" size="sm" color="neutral" class="w-auto" />
      <UInput v-if="editingTitle" v-model="titleDraft" size="sm" autofocus class="min-w-0 flex-1" @blur="saveTitle" @keydown.enter="saveTitle" @keydown.esc="editingTitle = false" />
      <UButton
        v-else
        color="neutral"
        variant="ghost"
        class="min-w-0 flex-1 text-base font-semibold"
        :label="tab === 'project' ? project.name : selected.title"
        :ui="{ label: 'truncate' }"
        title="Rename"
        @click="startTitle"
      />
      <template v-if="tab === 'scene'">
        <UInput v-if="editingDuration" v-model="durationDraft" size="xs" autofocus class="w-20" @blur="saveDuration" @keydown.enter="saveDuration" @keydown.esc="editingDuration = false">
          <template #trailing><span class="text-xs text-muted">s</span></template>
        </UInput>
        <UButton v-else size="sm" color="neutral" variant="ghost" class="font-mono" :label="fmtSeconds(selected.duration)" title="Change duration" @click="startDuration" />
      </template>
      <UBadge v-else color="neutral" variant="soft" class="font-mono" :label="fmtSeconds(project.duration)" />
    </div>

    <div class="flex items-center gap-1.5 border-b border-default px-4 py-2.5">
      <template v-if="tab === 'scene'">
        <UFieldGroup size="sm">
          <UButton color="neutral" variant="outline" icon="i-heroicons-arrow-uturn-left" label="Undo" :disabled="busy" @click="undo" />
          <UDropdownMenu :items="versionItems" :content="{ align: 'start' }" :ui="{ content: 'w-80 max-h-96', itemDescription: 'line-clamp-2' }" @update:open="loadVersions">
            <UButton color="neutral" variant="outline" icon="i-heroicons-clock" :label="`Versions (${project.versions[selected.id] ?? 0})`" :disabled="busy" />
          </UDropdownMenu>
        </UFieldGroup>
        <UTooltip text="Open scene in a new tab"><UButton size="sm" color="neutral" variant="ghost" icon="i-heroicons-arrow-top-right-on-square" aria-label="Open scene in a new tab" @click="openExternal" /></UTooltip>
        <UTooltip text="Copy the scene file's path (to open it in your own editor)"><UButton size="sm" color="neutral" variant="ghost" icon="i-heroicons-clipboard-document" aria-label="Copy scene file path" @click="copyScenePath" /></UTooltip>
        <UTooltip text="Duplicate scene"><UButton size="sm" color="neutral" variant="ghost" icon="i-heroicons-document-duplicate" aria-label="Duplicate scene" @click="duplicate" /></UTooltip>
        <UTooltip text="Save as a template to reuse in other projects"><UButton size="sm" color="neutral" variant="ghost" icon="i-heroicons-bookmark" aria-label="Save as template" :disabled="busy" @click="openSaveTemplate" /></UTooltip>
        <UTooltip text="Delete scene"><UButton size="sm" color="error" variant="ghost" icon="i-heroicons-trash" aria-label="Delete scene" :disabled="project.scenes.length <= 1 || busy" @click="confirmDelete = true" /></UTooltip>
      </template>
      <span v-else class="text-xs text-muted">Changes can touch any scene, and each changed scene gets a new version.</span>
      <UButton class="ml-auto" size="sm" color="neutral" variant="ghost" label="Clear chat" :disabled="busy || !messages.length" @click="chat.clear(pid, key)" />
    </div>

    <div class="min-h-0 flex-1 overflow-y-auto px-4 py-4">
      <UEmpty
        v-if="current && !messages.length && !busy"
        variant="naked"
        icon="i-heroicons-sparkles"
        :title="tab === 'scene' ? `Change ${selected.title}` : 'Change the whole video'"
        :description="tab === 'scene'
          ? `Describe what should change. Claude edits ${selected.file}, checks the frames, and the preview reloads when it's done. Drop images here to show it what you mean.`
          : 'Ask for changes across the whole video: add, reorder or restyle scenes.'"
        class="mt-6"
      />
      <UChatMessages
        v-else
        :messages="messages"
        :status="busy && !job?.partial?.trim() ? 'submitted' : busy ? 'streaming' : 'ready'"
        :user="{ variant: 'solid', color: 'neutral' }"
        :assistant="{ variant: 'soft', color: 'neutral' }"
        :spacing-offset="0"
        compact
        :ui="{ root: 'min-h-0' }"
      >
        <template #content="{ message }">
          <div v-if="(message.metadata as any)?.attachments?.length" class="mb-2 flex flex-wrap gap-1.5">
            <img v-for="a in (message.metadata as any).attachments" :key="a" :src="assetUrl(a)" :alt="a" class="h-14 rounded-sm object-cover ring-1 ring-white/20">
          </div>
          <div class="text-[15px] leading-relaxed whitespace-pre-wrap" :class="(message.metadata as any)?.error && 'text-error'">
            {{ message.parts[0]?.type === 'text' ? message.parts[0].text : '' }}<span v-if="(message.metadata as any)?.streaming" class="ml-0.5 inline-block h-4 w-1.5 animate-pulse bg-current align-text-bottom opacity-60" />
          </div>
          <p v-if="(message.metadata as any)?.durationMs" class="mt-1.5 text-xs text-dimmed">
            {{ Math.round((message.metadata as any).durationMs / 1000) }}s<template v-if="(message.metadata as any).costUsd"> · ~${{ (message.metadata as any).costUsd.toFixed(2) }} API-equivalent</template>
          </p>
        </template>
        <template #indicator>
          <div v-if="job" class="w-full space-y-1.5">
            <UChatShimmer :text="`Claude is working · ${Math.round((now - job.startedAt) / 1000)}s`" class="text-sm font-medium" />
            <UChatTool
              v-for="(a, i) in job.activity"
              :key="i"
              :text="a"
              :icon="toolIcon(a)"
              :loading="i === job.activity.length - 1"
              :disabled="true"
              :ui="{ label: 'truncate font-mono text-xs' }"
            />
          </div>
        </template>
      </UChatMessages>
      <div v-if="job?.partial?.trim()" class="mt-2 space-y-1">
        <UChatTool v-for="(a, i) in job.activity.slice(-2)" :key="i" :text="a" :icon="toolIcon(a)" :loading="i === 1 || job.activity.length === 1" :disabled="true" :ui="{ label: 'truncate font-mono text-xs' }" />
      </div>
    </div>

    <div class="border-t border-default p-4">
      <div v-if="tab === 'scene' && hasBeats && !busy" class="mb-2 flex flex-wrap gap-1.5">
        <UButton size="xs" color="neutral" variant="soft" icon="i-heroicons-signal" label="Snap motion to beats" @click="send('Retime this scene so its key motion moments land exactly on the music: big arrivals on downbeats, smaller accents on beats. Keep the choreography and look the same otherwise.')" />
        <UButton size="xs" color="neutral" variant="soft" icon="i-heroicons-scissors" label="Match the next cut" :disabled="selectedIndex >= project.scenes.length - 1" @click="send('Make the last frame of this scene match the first frame of the next scene exactly so the cut is invisible. Run the seam check and keep going until it is under 1%.')" />
      </div>
      <UChatPrompt
        v-model="draft"
        :placeholder="dictation.listening.value ? 'Listening… speak your change' : placeholder"
        :rows="3"
        :maxrows="10"
        autoresize
        variant="subtle"
        @submit="send()"
        @paste="onPaste"
      >
        <template v-if="attachments.length || uploading" #header>
          <div class="flex flex-wrap items-center gap-2">
            <div v-for="(a, i) in attachments" :key="a.path" class="group relative">
              <img :src="a.url" :alt="a.name" class="h-12 w-16 rounded-sm object-cover ring-1 ring-default">
              <UButton class="absolute -top-1.5 -right-1.5" size="xs" color="neutral" variant="solid" icon="i-heroicons-x-mark" :ui="{ base: 'rounded-full p-0.5' }" :aria-label="`Remove ${a.name}`" @click="attachments.splice(i, 1)" />
            </div>
            <UIcon v-if="uploading" name="i-heroicons-arrow-path" class="size-4 animate-spin text-muted" />
          </div>
        </template>
        <template #footer>
          <!-- Wraps onto a second row when the panel is narrow, so the pickers never run under the buttons on the right. -->
          <div class="flex min-w-0 flex-1 flex-wrap items-center gap-0.5">
            <UTooltip text="Attach reference images (or drop / paste them)">
              <UButton size="sm" color="neutral" variant="ghost" icon="i-heroicons-paper-clip" aria-label="Attach images" :disabled="busy" @click="fileInput?.click()" />
            </UTooltip>
            <UTooltip v-if="tab === 'scene'" text="Point at the playhead time">
              <UButton size="sm" color="neutral" variant="ghost" icon="i-heroicons-map-pin" :label="`${(sceneTime / 1000).toFixed(2)}s`" class="font-mono" :disabled="busy" @click="insertTime" />
            </UTooltip>
            <USelect v-model="model" :items="MODELS" size="sm" variant="ghost" class="w-32 max-w-full" :ui="{ content: 'min-w-56' }" aria-label="Model" />
            <USelect v-if="tab === 'scene' && project?.app" v-model="appMode" :items="APP_MODES" size="sm" variant="ghost" class="w-40 max-w-full" :ui="{ content: 'min-w-64' }" aria-label="How Claude shows the app" :disabled="busy" />
          </div>
          <span v-if="dictation.listening.value" class="ml-2 flex shrink-0 items-center gap-1.5 text-xs font-medium text-error">
            <span class="size-2 animate-pulse rounded-full bg-error" /> Listening
          </span>
          <UTooltip v-if="dictation.supported" :text="dictation.listening.value ? 'Stop dictation' : 'Dictate with your voice'">
            <UButton
              class="ml-auto shrink-0"
              :color="dictation.listening.value ? 'error' : 'neutral'"
              :variant="dictation.listening.value ? 'soft' : 'ghost'"
              :icon="dictation.listening.value ? 'i-heroicons-stop-circle' : 'i-heroicons-microphone'"
              :aria-label="dictation.listening.value ? 'Stop dictation' : 'Dictate'"
              :aria-pressed="dictation.listening.value"
              :disabled="busy"
              @click="dictation.toggle(draft)"
            />
          </UTooltip>
          <UChatPromptSubmit class="shrink-0" :class="!dictation.supported && 'ml-auto'" :status="busy ? 'streaming' : 'ready'" :disabled="!busy && !draft.trim()" @stop="chat.cancel(pid, key)" />
        </template>
      </UChatPrompt>
      <p class="mt-1.5 flex items-center gap-1 text-xs text-dimmed">
        <UKbd value="enter" size="sm" /> to send · <UKbd value="shift" size="sm" /> <UKbd value="enter" size="sm" /> new line
      </p>
    </div>

    <div v-if="dragOver" class="pointer-events-none absolute inset-0 z-30 grid place-items-center bg-default/80 backdrop-blur-sm">
      <UEmpty variant="outline" icon="i-heroicons-photo" title="Drop images to attach" description="Claude will look at them with your next message." class="bg-default" />
    </div>

    <UModal
      v-model:open="confirmDelete"
      :title="`Delete “${selected.title}”?`"
      description="The scene moves to the trash with its versions and chat. You can restore it from the project menu for 30 days."
      :ui="{ footer: 'justify-end' }"
    >
      <template #footer>
        <UButton color="neutral" variant="ghost" label="Cancel" @click="confirmDelete = false" />
        <UButton color="error" icon="i-heroicons-trash" label="Move to trash" @click="remove" />
      </template>
    </UModal>

    <CompareModal v-model:open="comparing" :scene="selected" />
    <UModal v-model:open="templateForm.open" title="Save as template" description="A copy of this scene you can insert into any project. Claude can adapt it to the other project's brand and stage when inserted." :ui="{ footer: 'justify-end' }">
      <template #body>
        <div class="space-y-4">
          <UFormField label="Name">
            <UInput v-model="templateForm.name" autofocus class="w-full" placeholder="e.g. Lower third" @keydown.enter="saveTemplate" />
          </UFormField>
          <UFormField label="Description" hint="Optional">
            <UTextarea v-model="templateForm.description" :rows="2" autoresize class="w-full" placeholder="e.g. Name and role slide in from the left over a soft bar. Change the two text lines." />
          </UFormField>
        </div>
      </template>
      <template #footer>
        <UButton color="neutral" variant="ghost" label="Cancel" @click="templateForm.open = false" />
        <UButton icon="i-heroicons-bookmark" label="Save template" :loading="savingTemplate" :disabled="!templateForm.name.trim()" @click="saveTemplate" />
      </template>
    </UModal>
  </aside>
</template>
