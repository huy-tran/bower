<script setup lang="ts">
const ed = useEditor()
const { project, projects, selected, selectedIndex, mainTab, mode, playing, time, active, marks, timelineDuration, timelineStart } = ed
const music = useMusic()
const toast = useToast()

const presenting = ref(false)
const artOpen = ref(false)
const artDraft = ref('')
const newOpen = ref(false)
const newName = ref('')
const dropping = ref(false)
const stageBox = ref<HTMLElement>()
const stageSize = reactive({ w: 0, h: 0 })
let wasPlaying = false

onMounted(async () => {
  await ed.loadProjects()
  let last: string | null = null
  try { last = localStorage.getItem('storyboard:project') } catch {}
  const id = projects.value.find(p => p.id === last)?.id ?? projects.value[0]?.id
  if (id) await ed.openProject(id)

  const ro = new ResizeObserver(([e]) => {
    const { width, height } = e!.contentRect
    const w = Math.min(width, height * 16 / 9)
    stageSize.w = Math.floor(w)
    stageSize.h = Math.floor(w * 9 / 16)
  })
  watchEffect(() => { if (stageBox.value) ro.observe(stageBox.value) })

  window.addEventListener('keydown', onKey)
  window.addEventListener('dragover', onDragOver)
  window.addEventListener('dragleave', onDragLeave)
  window.addEventListener('drop', onDrop)
})
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKey)
  window.removeEventListener('dragover', onDragOver)
  window.removeEventListener('dragleave', onDragLeave)
  window.removeEventListener('drop', onDrop)
})

const projectId = computed({
  get: () => project.value?.id,
  set: (id) => { if (id) ed.openProject(id) }
})
const projectItems = computed(() => projects.value.map(p => ({ label: p.name, value: p.id })))

// Only keep the scenes that can be on screen loaded in the main player.
const playerScenes = computed(() => {
  const p = project.value
  if (!p || !selected.value) return []
  return mode.value === 'scene' ? [selected.value] : p.scenes
})

const cuts = computed(() => mode.value === 'video' ? project.value?.scenes.slice(1).map(s => ({ at: s.start, title: s.title })) : [])

const wave = computed(() => {
  const a = project.value?.audio
  if (!a?.peaks?.length || !a.duration) return undefined
  const from = (a.startOffset || 0) + timelineStart.value
  const to = from + timelineDuration.value
  const n = a.peaks.length
  const i0 = Math.max(0, Math.floor(from / a.duration * n)), i1 = Math.min(n, Math.ceil(to / a.duration * n))
  const slice = a.peaks.slice(i0, i1)
  if (slice.length < 2) return undefined
  const step = Math.max(1, Math.floor(slice.length / 400))
  const out: number[] = []
  for (let i = 0; i < slice.length; i += step) out.push(Math.max(...slice.slice(i, i + step)))
  return out
})

function onScrub(activeNow: boolean) {
  if (activeNow) {
    wasPlaying = playing.value
    ed.pause()
  } else if (wasPlaying) {
    ed.play()
  }
}

function typing(e: KeyboardEvent) {
  const t = e.target as HTMLElement
  return t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName)
}

function onKey(e: KeyboardEvent) {
  if (presenting.value || typing(e) || mainTab.value !== 'scenes') return
  const frame = 1000 / (project.value?.fps || 30)
  if (e.key === ' ') { e.preventDefault(); ed.toggle() }
  else if (e.key === 'ArrowRight') { e.preventDefault(); ed.pause(); ed.seek(time.value + (e.shiftKey ? 1000 : frame)) }
  else if (e.key === 'ArrowLeft') { e.preventDefault(); ed.pause(); ed.seek(time.value - (e.shiftKey ? 1000 : frame)) }
  else if (e.key === 'Home') { e.preventDefault(); ed.seek(0) }
  else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    const p = project.value!
    const i = selectedIndex.value + (e.key === 'ArrowDown' ? 1 : -1)
    if (p.scenes[i]) { e.preventDefault(); ed.select(p.scenes[i]!.id) }
  }
}

const hasFiles = (e: DragEvent) => e.dataTransfer?.types.includes('Files')
function onDragOver(e: DragEvent) {
  if (!hasFiles(e)) return
  e.preventDefault()
  dropping.value = true
}
function onDragLeave(e: DragEvent) {
  if (!e.relatedTarget) dropping.value = false
}
async function onDrop(e: DragEvent) {
  if (!hasFiles(e)) return
  e.preventDefault()
  dropping.value = false
  const f = [...(e.dataTransfer?.files ?? [])].find(f => f.type.startsWith('audio/') || /\.(mp3|wav|m4a|aac|ogg|flac)$/i.test(f.name))
  if (!f) return toast.add({ title: 'Drop an audio file (mp3, wav, m4a, ogg, flac)', color: 'warning' })
  try {
    await music.upload(f)
    toast.add({ title: 'Music analysed', description: `${Math.round(project.value?.audio?.bpm ?? 0)} BPM · beats show on the timeline`, color: 'success' })
  } catch (err: any) {
    toast.add({ title: 'Could not load that track', description: err?.data?.message || err?.message, color: 'error' })
  }
}

function openArt() {
  artDraft.value = project.value?.artDirection ?? ''
  artOpen.value = true
}
async function saveArt() {
  ed.setProject(await $fetch(`/api/projects/${project.value!.id}`, { method: 'PATCH', body: { artDirection: artDraft.value } }))
  artOpen.value = false
  toast.add({ title: 'Art direction saved', description: 'Claude applies it to every prompt from now on.', color: 'success' })
}

async function createProject() {
  const name = newName.value.trim()
  if (!name) return
  const p = await $fetch<{ id: string }>('/api/projects', { method: 'POST', body: { name } })
  await ed.loadProjects()
  await ed.openProject(p.id)
  newOpen.value = false
  newName.value = ''
}

const importInput = ref<HTMLInputElement>()
const health = ref<{ claude: { installed: boolean, loggedIn: boolean } } | null>(null)
onMounted(async () => { health.value = await $fetch('/api/health').catch(() => null) as any })

const projectMenu = computed(() => [[
  { label: 'Export project (.zip)', icon: 'i-lucide-package', disabled: !project.value, onSelect: () => { window.location.href = `/api/projects/${project.value!.id}/export` } },
  { label: 'Import project…', icon: 'i-lucide-package-open', onSelect: () => importInput.value?.click() }
], [
  { label: 'Download web player (.html)', icon: 'i-lucide-globe', disabled: !project.value, onSelect: () => { window.location.href = `/api/projects/${project.value!.id}/player?download=1` } },
  { label: 'Preview web player', icon: 'i-lucide-external-link', disabled: !project.value, onSelect: () => { window.open(`/api/projects/${project.value!.id}/player`, '_blank') } }
]])

async function importProject(e: Event) {
  const f = (e.target as HTMLInputElement).files?.[0]
  ;(e.target as HTMLInputElement).value = ''
  if (!f) return
  const form = new FormData()
  form.append('file', f)
  try {
    const p = await $fetch<{ id: string, name: string }>('/api/projects/import', { method: 'POST', body: form })
    await ed.loadProjects()
    await ed.openProject(p.id)
    toast.add({ title: `Imported "${p.name}"`, color: 'success' })
  } catch (err: any) {
    toast.add({ title: 'Could not import', description: err?.data?.message || err?.message, color: 'error' })
  }
}

async function copyPath() {
  const path = selected.value?.path
  if (!path) return
  await navigator.clipboard.writeText(path)
  toast.add({ title: 'Path copied', description: path, color: 'neutral' })
}
</script>

<template>
  <div class="flex h-full flex-col p-3 lg:p-5">
    <UAlert
      v-if="health && (!health.claude.installed || !health.claude.loggedIn)"
      class="mb-3"
      color="warning"
      variant="subtle"
      icon="i-lucide-triangle-alert"
      :title="health.claude.installed ? 'Claude Code is not signed in' : 'Claude Code is not installed'"
      :description="health.claude.installed
        ? 'Prompts will fail until you sign in. Run `claude` in a terminal once and log in, then reload this page.'
        : 'Prompts need the Claude Code CLI. Install it from claude.com/claude-code, run `claude` once to sign in, then restart this app.'"
    />
    <div class="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl bg-white shadow-xl ring-1 ring-black/5">
      <!-- Header -->
      <header class="flex items-center gap-3 border-b border-zinc-200 px-4 py-3">
        <div class="flex items-center gap-2 pr-2">
          <span class="grid size-7 place-items-center rounded-lg bg-zinc-900 text-white"><UIcon name="i-lucide-calendar-range" class="size-4" /></span>
          <span class="text-lg font-semibold tracking-tight text-zinc-900">Storyboard</span>
        </div>
        <USelect v-model="projectId" :items="projectItems" class="w-64" placeholder="Choose a project" />
        <UButton color="neutral" variant="outline" icon="i-lucide-plus" label="New project" @click="newOpen = true" />
        <UDropdownMenu :items="projectMenu" :content="{ align: 'start' }">
          <UButton color="neutral" variant="ghost" icon="i-lucide-ellipsis" aria-label="Project actions" />
        </UDropdownMenu>
        <input ref="importInput" type="file" accept=".zip,application/zip" class="hidden" @change="importProject">
        <div class="flex rounded-lg bg-zinc-100 p-0.5 text-sm">
          <button v-for="t in (['scenes', 'render'] as const)" :key="t" class="rounded-md px-4 py-1.5 capitalize transition" :class="mainTab === t ? 'bg-white font-medium text-zinc-900 shadow-sm' : 'text-zinc-500 hover:text-zinc-700'" @click="mainTab = t; ed.pause()">
            {{ t }}
          </button>
        </div>
        <div class="ml-auto flex items-center gap-2">
          <UButton color="neutral" variant="outline" icon="i-lucide-palette" label="Art direction" :disabled="!project" @click="openArt" />
          <UButton color="neutral" variant="outline" icon="i-lucide-clipboard-copy" label="Copy path" :disabled="!selected" @click="copyPath" />
          <UButton color="neutral" icon="i-lucide-maximize" label="Present" :disabled="!project" @click="presenting = true" />
        </div>
      </header>

      <div v-if="!project" class="grid flex-1 place-items-center text-sm text-zinc-400">
        <UIcon name="i-lucide-loader-circle" class="size-6 animate-spin" />
      </div>

      <template v-else-if="mainTab === 'scenes'">
        <div class="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_minmax(380px,32%)]">
          <!-- Stage -->
          <section class="flex min-h-0 flex-col bg-zinc-100/80">
            <div class="px-6 pt-3 pb-2 text-sm">
              <span class="font-medium text-zinc-900">
                <template v-if="mode === 'scene'">Scene {{ selectedIndex + 1 }} of {{ project.scenes.length }}</template>
                <template v-else>Whole video</template>
              </span>
              <span class="text-zinc-500"> · {{ active?.scene.title }}<template v-if="mode === 'scene'"> · loops</template></span>
            </div>
            <div ref="stageBox" class="flex min-h-0 flex-1 items-center justify-center px-6">
              <div :style="{ width: `${stageSize.w}px`, height: `${stageSize.h}px` }">
                <ScenePlayer v-if="active" :project="project" :scenes="playerScenes" :active-id="active.scene.id" :t="active.t" rounded />
              </div>
            </div>
            <div class="flex items-center gap-4 px-6 pt-3 pb-3">
              <div class="flex shrink-0 rounded-lg bg-white p-0.5 text-sm ring-1 ring-zinc-200">
                <button class="rounded-md px-3 py-1.5" :class="mode === 'scene' ? 'bg-zinc-900 font-medium text-white' : 'text-zinc-500 hover:text-zinc-800'" @click="ed.setMode('scene')">This scene</button>
                <button class="rounded-md px-3 py-1.5" :class="mode === 'video' ? 'bg-zinc-900 font-medium text-white' : 'text-zinc-500 hover:text-zinc-800'" @click="ed.setMode('video')">Whole video</button>
              </div>
              <button class="grid size-11 shrink-0 place-items-center rounded-full bg-zinc-900 text-white shadow transition hover:bg-zinc-700" :title="playing ? 'Pause (Space)' : 'Play (Space)'" @click="ed.toggle()">
                <UIcon :name="playing ? 'i-lucide-pause' : 'i-lucide-play'" class="size-5" :class="!playing && 'translate-x-px'" />
              </button>
              <span class="w-28 shrink-0 font-mono text-sm text-zinc-700 tabular-nums">{{ (time / 1000).toFixed(2) }} <span class="text-zinc-400">/ {{ fmtSeconds(timelineDuration) }}</span></span>
              <TimelineBar class="min-w-0 flex-1" :duration="timelineDuration" :time="time" :marks="marks" :cuts="cuts" :wave="wave" @seek="ed.seek" @scrub="onScrub" />
              <MusicControl class="shrink-0" />
            </div>
          </section>

          <ChatPanel />
        </div>
        <div class="border-t border-zinc-200 bg-white">
          <SceneStrip />
        </div>
      </template>

      <RenderPanel v-else />
    </div>

    <PresentOverlay v-if="presenting" @close="presenting = false" />

    <div v-if="dropping" class="pointer-events-none fixed inset-0 z-40 grid place-items-center bg-zinc-900/40 backdrop-blur-sm">
      <div class="rounded-2xl bg-white px-10 py-8 text-center shadow-2xl">
        <UIcon name="i-lucide-audio-waveform" class="mx-auto size-10 text-zinc-800" />
        <p class="mt-3 text-lg font-semibold text-zinc-900">Drop music to sync</p>
        <p class="text-sm text-zinc-500">Beats, downbeats and phrases are detected automatically.</p>
      </div>
    </div>

    <UModal v-model:open="artOpen" title="Art direction" description="Project-wide style guidance included in every prompt to Claude.">
      <template #body>
        <UTextarea v-model="artDraft" :rows="10" autoresize class="w-full" placeholder="e.g. Swiss minimalism. Inter Display, very tight tracking. Black on warm off-white (#faf9f7). One accent colour: #3b82f6. Motion is calm and precise - outExpo arrivals, never bouncy." />
        <div class="mt-4 flex justify-end gap-2">
          <UButton color="neutral" variant="ghost" label="Cancel" @click="artOpen = false" />
          <UButton color="neutral" label="Save" @click="saveArt" />
        </div>
      </template>
    </UModal>

    <UModal v-model:open="newOpen" title="New project">
      <template #body>
        <form class="space-y-4" @submit.prevent="createProject">
          <UFormField label="Name">
            <UInput v-model="newName" placeholder="e.g. Launch teaser" autofocus class="w-full" />
          </UFormField>
          <div class="flex justify-end gap-2">
            <UButton color="neutral" variant="ghost" label="Cancel" @click="newOpen = false" />
            <UButton type="submit" color="neutral" label="Create" :disabled="!newName.trim()" />
          </div>
        </form>
      </template>
    </UModal>
  </div>
</template>
