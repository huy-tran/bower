<script setup lang="ts">
import type { DropdownMenuItem } from '@nuxt/ui'
import type { SettingsTab } from '~/components/ProjectSettingsModal.vue'

const ed = useEditor()
const { project, projects, selected, selectedIndex, mainTab, mode, playing, time, rate, loop, view, layers, active, caption, marks, clipMarks, timelineDuration, timelineStart } = ed
const music = useMusic()
const narration = useNarration()
const toast = useToast()
// package.json's version; "dev" marks a `nuxt dev` server rather than a build.
const appVersion = `v${useRuntimeConfig().public.version}${import.meta.dev ? ' · dev' : ''}`

const presenting = ref(false)
const settingsOpen = ref(false)
const storyOpen = ref(false)
const historyOpen = ref(false)
const story = useStoryboard()
const settingsTab = ref<SettingsTab>('general')
const newOpen = ref(false)
const newProject = reactive({ name: '', folder: ROOT })
const folders = useFolders()
const deleteOpen = ref(false)
const trashOpen = ref(false)
const soundOpen = ref(false)
const dropping = ref(false)
const loaded = ref(false)
const stageBox = ref<HTMLElement>()
const stageSize = reactive({ w: 0, h: 0 })
let wasPlaying = false

// Fit the stage into the preview area at the project's own shape (16:9, 9:16, 1:1, 4:5...).
const stageArea = reactive({ w: 0, h: 0 })
watchEffect(() => {
  const p = project.value
  const r = p ? p.width / p.height : 16 / 9
  const w = Math.min(stageArea.w, stageArea.h * r)
  stageSize.w = Math.floor(w)
  stageSize.h = Math.floor(w / r)
})

onMounted(async () => {
  await ed.loadProjects()
  let last: string | null = null
  try { last = localStorage.getItem('bower:project') } catch {}
  const id = projects.value.find(p => p.id === last)?.id ?? projects.value[0]?.id
  if (id) await ed.openProject(id)
  loaded.value = true

  const ro = new ResizeObserver(([e]) => {
    stageArea.w = e!.contentRect.width
    stageArea.h = e!.contentRect.height
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

const mainTabs = [{ label: 'Scenes', value: 'scenes' }, { label: 'Render', value: 'render' }]
const modeTabs = [{ label: 'This scene', value: 'scene' }, { label: 'Whole video', value: 'video' }]
const modeModel = computed({ get: () => mode.value, set: v => ed.setMode(v as PlayMode) })
const rateItems = [{ label: '0.25×', value: 0.25 }, { label: '0.5×', value: 0.5 }, { label: '1×', value: 1 }]
const rateModel = computed({ get: () => rate.value, set: v => ed.setRate(Number(v)) })
watch(mainTab, () => ed.pause())

// In scene mode only the selected scene is loaded; in video mode all of them, so cuts and transitions are instant.
const playerScenes = computed(() => {
  const p = project.value
  if (!p || !selected.value) return []
  return mode.value === 'scene' ? [selected.value] : p.scenes
})

const cuts = computed(() => mode.value === 'video' ? project.value?.scenes.slice(1).map(s => ({ at: s.start, title: s.title })) : [])

// Waveform peaks over the current timeline (dense enough to zoom into).
const wave = computed(() => {
  const a = project.value?.audio
  if (!a?.peaks?.length || !a.duration) return undefined
  const from = (a.startOffset || 0) + timelineStart.value
  const to = from + timelineDuration.value
  const n = a.peaks.length
  const i0 = Math.max(0, Math.floor(from / a.duration * n)), i1 = Math.min(n, Math.ceil(to / a.duration * n))
  const slice = a.peaks.slice(i0, i1)
  return slice.length < 2 ? undefined : slice
})

const zoomed = computed(() => view.value.to - view.value.from < 0.999)
function zoom(factor: number) {
  const { from, to } = view.value
  const at = timelineDuration.value ? time.value / timelineDuration.value : 0.5
  const span = Math.min(1, Math.max(0.02, (to - from) * factor))
  ed.setView(at - span / 2, at + span / 2)
}

function onScrub(activeNow: boolean) {
  if (activeNow) {
    wasPlaying = playing.value
    ed.pause()
  } else if (wasPlaying) {
    ed.play()
  }
}

// Leave keys to whatever has focus: text fields, and Nuxt UI tabs, menus and dialogs have their own arrow-key navigation.
function focusOwnsKey(e: KeyboardEvent) {
  const t = e.target as HTMLElement
  if (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName)) return true
  if (t.closest('[role=tablist],[role=menu],[role=listbox],[role=dialog],[role=slider]')) return true
  // Space on a focused button presses it; toggling playback as well would undo a click on Play.
  return e.key === ' ' && !!t.closest('button,a')
}

function onKey(e: KeyboardEvent) {
  if (presenting.value || focusOwnsKey(e) || mainTab.value !== 'scenes' || !project.value) return
  if (e.ctrlKey || e.metaKey || e.altKey) return
  const frame = 1000 / (project.value.fps || 30)
  const k = e.key.toLowerCase()
  if (e.key === ' ') { e.preventDefault(); ed.toggle() }
  else if (e.key === 'ArrowRight') { e.preventDefault(); ed.pause(); ed.seek(time.value + (e.shiftKey ? 1000 : frame)) }
  else if (e.key === 'ArrowLeft') { e.preventDefault(); ed.pause(); ed.seek(time.value - (e.shiftKey ? 1000 : frame)) }
  else if (e.key === 'Home') { e.preventDefault(); ed.seek(loop.value?.from ?? 0) }
  else if (k === 'i') ed.setLoop(time.value, loop.value?.to ?? timelineDuration.value)
  else if (k === 'o') ed.setLoop(loop.value?.from ?? 0, time.value)
  else if (k === 'l') ed.setLoop(null)
  else if (e.key === '+' || e.key === '=') zoom(0.6)
  else if (e.key === '-') zoom(1 / 0.6)
  else if (e.key === '0') ed.setView(0, 1)
  else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    const p = project.value
    const i = selectedIndex.value + (e.key === 'ArrowDown' ? 1 : -1)
    if (p.scenes[i]) { e.preventDefault(); ed.select(p.scenes[i]!.id) }
  }
}

// Only audio drags show the "drop music" overlay; images go to the chat panel.
const audioDrag = (e: DragEvent) => FEATURES.music && [...(e.dataTransfer?.items ?? [])].some(i => i.kind === 'file' && i.type.startsWith('audio/'))
function onDragOver(e: DragEvent) {
  if (!e.dataTransfer?.types.includes('Files')) return
  e.preventDefault()
  dropping.value = audioDrag(e)
}
function onDragLeave(e: DragEvent) {
  if (!e.relatedTarget) dropping.value = false
}
async function onDrop(e: DragEvent) {
  if (!e.dataTransfer?.types.includes('Files')) return
  e.preventDefault()
  dropping.value = false
  const files = [...(e.dataTransfer?.files ?? [])]
  const f = FEATURES.music ? files.find(f => f.type.startsWith('audio/') || /\.(mp3|wav|m4a|aac|ogg|flac)$/i.test(f.name)) : undefined
  if (!f) {
    if (files.some(f => f.type.startsWith('image/'))) return toast.add({ title: 'Drop images on the chat panel to attach them', color: 'neutral' })
    return toast.add({ title: FEATURES.music ? 'Drop an audio file (mp3, wav, m4a, ogg, flac)' : 'Drop images on the chat panel; sound effects and voice-over go in the Sound panel', color: 'warning' })
  }
  if (!project.value) return
  try {
    await music.upload(f)
    toast.add({ title: 'Music analysed', description: `${Math.round(project.value?.audio?.bpm ?? 0)} BPM · beats and sections show on the timeline`, color: 'success' })
  } catch (err: any) {
    toast.add({ title: 'Could not load that track', description: err?.data?.message || err?.message, color: 'error' })
  }
}

// Setup progress for the header chip; refreshed when the project changes or the settings close.
const setup = useSetup()
const bower = useBowerSettings()
// Leaving Bower settings may have changed the open project's app (renamed, moved): reload it.
watch(bower.open, async (o) => { if (!o && project.value) { ed.setProject(await $fetch(`/api/projects/${project.value.id}`)); setup.checkClaude() } })
onMounted(() => setup.checkClaude())
watch([() => project.value?.id, settingsOpen], ([id, open]) => { if (id && !open) setup.loadSession(id, !!project.value?.app) }, { immediate: true })

function openSettings(tab: SettingsTab = 'general') {
  settingsTab.value = tab
  settingsOpen.value = true
}

// New projects go in the open project's folder unless another is picked.
function openNew() {
  newProject.folder = toFolderValue(project.value?.folder ?? '')
  newOpen.value = true
}
async function createProject() {
  const name = newProject.name.trim()
  if (!name) return
  const p = await $fetch<{ id: string }>('/api/projects', { method: 'POST', body: { name, folder: fromFolderValue(newProject.folder) } })
  await ed.loadProjects()
  await folders.load()
  await ed.openProject(p.id)
  newOpen.value = false
  newProject.name = ''
}

async function duplicateProject() {
  const p = await $fetch<{ id: string, name: string }>(`/api/projects/${project.value!.id}/duplicate`, { method: 'POST', body: {} })
  await ed.loadProjects()
  await ed.openProject(p.id)
  toast.add({ title: `Created "${p.name}"`, color: 'success' })
}

async function adapt(format: string) {
  try {
    const p = await $fetch<{ id: string, name: string }>(`/api/projects/${project.value!.id}/adapt`, { method: 'POST', body: { format } })
    await ed.loadProjects()
    await ed.openProject(p.id)
    toast.add({ title: `Created "${p.name}"`, description: 'Claude is re-laying out every scene for the new size. Follow along in the Project chat.', color: 'success' })
  } catch (e: any) {
    toast.add({ title: 'Could not create that format', description: e?.data?.message, color: 'error' })
  }
}

async function deleteProject() {
  const name = project.value!.name
  deleteOpen.value = false
  await $fetch(`/api/projects/${project.value!.id}`, { method: 'DELETE' })
  ed.closeProject()
  await ed.loadProjects()
  if (projects.value[0]) await ed.openProject(projects.value[0].id)
  toast.add({ title: `"${name}" moved to the trash`, description: 'Restore it from Trash within 30 days.', color: 'neutral' })
}

const importInput = ref<HTMLInputElement>()
const health = ref<{ claude: { installed: boolean, loggedIn: boolean } } | null>(null)
onMounted(async () => { health.value = await $fetch('/api/health').catch(() => null) as any })

const formatLabel = computed(() => {
  const p = project.value
  if (!p) return ''
  const r = p.width / p.height
  return Math.abs(r - 16 / 9) < 0.01 ? '16:9' : Math.abs(r - 9 / 16) < 0.01 ? '9:16' : Math.abs(r - 1) < 0.01 ? '1:1' : Math.abs(r - 0.8) < 0.01 ? '4:5' : `${p.width}×${p.height}`
})

// Bower itself, for every project on this computer.
const bowerMenu = computed<DropdownMenuItem[][]>(() => [[
  { label: 'Bower settings…', icon: 'i-heroicons-adjustments-horizontal', onSelect: () => bower.show('claude') },
  { label: 'Apps…', icon: 'i-heroicons-window', onSelect: () => bower.show('apps') },
  { label: 'Trash', icon: 'i-heroicons-archive-box', onSelect: () => (trashOpen.value = true) }
], [
  { label: `Bower ${appVersion}`, icon: 'i-lucide-bird', disabled: true }
]])

const projectMenu = computed<DropdownMenuItem[][]>(() => {
  const has = !!project.value
  const formats = ['16:9', '9:16', '1:1', '4:5'].filter(f => f !== formatLabel.value)
  return [[
    { label: 'Storyboard…', icon: 'i-heroicons-clipboard-document-list', disabled: !has, onSelect: () => (storyOpen.value = true) },
    { label: 'History…', icon: 'i-heroicons-clock', disabled: !has, onSelect: () => (historyOpen.value = true) },
    { label: 'Project settings…', icon: 'i-heroicons-cog-6-tooth', disabled: !has, onSelect: () => openSettings() },
    { label: 'Duplicate project', icon: 'i-heroicons-document-duplicate', disabled: !has, onSelect: duplicateProject },
    {
      label: 'New version for social…', icon: 'i-heroicons-device-phone-mobile', disabled: !has,
      children: [formats.map(f => ({
        label: { '16:9': 'Landscape 16:9', '9:16': 'Vertical 9:16 (Reels, TikTok, Shorts)', '1:1': 'Square 1:1', '4:5': 'Portrait 4:5 (feed)' }[f]!,
        onSelect: () => adapt(f)
      }))]
    }
  ], [
    { label: 'Export project (.zip)', icon: 'i-heroicons-archive-box-arrow-down', disabled: !has, onSelect: () => { window.location.href = `/api/projects/${project.value!.id}/export` } },
    { label: 'Import project…', icon: 'i-heroicons-arrow-up-tray', onSelect: () => importInput.value?.click() },
    { label: 'Download web player (.html)', icon: 'i-heroicons-globe-alt', disabled: !has, onSelect: () => { window.location.href = `/api/projects/${project.value!.id}/player?download=1` } },
    { label: 'Preview web player', icon: 'i-heroicons-arrow-top-right-on-square', disabled: !has, onSelect: () => { window.open(`/api/projects/${project.value!.id}/player`, '_blank') } }
  ], [
    { label: 'Delete project', icon: 'i-heroicons-trash', color: 'error', disabled: !has, onSelect: () => (deleteOpen.value = true) }
  ]]
})

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
      icon="i-heroicons-exclamation-triangle"
      :title="health.claude.installed ? 'Claude Code is not signed in' : 'Claude Code is not installed'"
      :description="health.claude.installed
        ? 'Prompts will fail until you sign in. Run `claude` in a terminal once and log in, then reload this page.'
        : 'Prompts need the Claude Code CLI. Install it from claude.com/claude-code, run `claude` once to sign in, then restart this app.'"
    />
    <div class="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl bg-default shadow-xl ring-1 ring-default">
      <!-- Header -->
      <header class="flex items-center gap-3 border-b border-default px-4 py-3">
        <!-- The logo is the one place for things that are not about the open project. -->
        <UDropdownMenu :items="bowerMenu" :content="{ align: 'start' }">
          <button type="button" class="-my-1 flex items-center gap-2 rounded-lg py-1 pr-2 pl-1 text-left hover:bg-elevated focus-visible:outline-2 focus-visible:outline-primary" aria-label="Bower menu">
            <UAvatar icon="i-lucide-bird" size="sm" :ui="{ root: 'rounded-md bg-inverted', icon: 'text-inverted' }" />
            <div class="flex flex-col gap-0.5">
              <span class="flex items-center gap-1 text-lg leading-none font-semibold tracking-tight text-highlighted">Bower <UIcon name="i-heroicons-chevron-down" class="size-3.5 text-muted" /></span>
              <span class="text-[11px] leading-none text-muted tabular-nums">{{ appVersion }}</span>
            </div>
          </button>
        </UDropdownMenu>
        <ProjectPicker @new="openNew" />
        <UBadge v-if="project" color="neutral" variant="soft" :label="formatLabel" />
        <UButton color="neutral" variant="outline" icon="i-heroicons-plus" label="New project" @click="openNew" />
        <UDropdownMenu :items="projectMenu" :content="{ align: 'start' }">
          <UButton color="neutral" variant="ghost" icon="i-heroicons-ellipsis-horizontal" aria-label="Project actions" />
        </UDropdownMenu>
        <input ref="importInput" type="file" accept=".zip,application/zip" class="hidden" @change="importProject">
        <UTabs v-model="mainTab" :items="mainTabs" :content="false" color="neutral" class="w-auto" />
        <div class="ml-auto flex items-center gap-2">
          <DesktopUpdate />
          <template v-if="story.state.building && story.state.waiting">
            <UFieldGroup size="sm">
              <UBadge color="info" variant="subtle" size="md" icon="i-heroicons-check" :label="`Built ${story.state.done}/${story.state.total} · ${story.state.current}`" />
              <UButton v-if="story.state.done < story.state.total" color="info" variant="solid" icon="i-heroicons-play" label="Next scene" @click="story.continueBuild()" />
              <UButton v-if="story.state.done < story.state.total" color="info" variant="subtle" icon="i-heroicons-forward" label="Build the rest" @click="story.continueAll()" />
              <UButton color="info" variant="subtle" icon="i-heroicons-arrow-path" label="Redo" @click="story.redo()" />
              <UButton color="info" variant="subtle" icon="i-heroicons-stop" :label="story.state.done < story.state.total ? 'Stop' : 'Done'" @click="story.stop()" />
            </UFieldGroup>
          </template>
          <UFieldGroup v-else-if="story.state.building" size="sm">
            <UBadge color="info" variant="subtle" size="md" icon="i-heroicons-arrow-path" :label="`Building ${story.state.done + 1}/${story.state.total} · ${story.state.current}`" :ui="{ leadingIcon: 'animate-spin' }" />
            <UTooltip v-if="story.state.mode === 'all'" text="Finish this scene, then ask before each next one">
              <UButton color="info" variant="subtle" icon="i-heroicons-pause" label="Pause after this scene" @click="story.pauseAfterScene()" />
            </UTooltip>
            <UTooltip text="Cancel Claude now and stop building; what it wrote so far is kept as a version">
              <UButton color="info" variant="subtle" icon="i-heroicons-stop" label="Stop" @click="story.stopNow()" />
            </UTooltip>
          </UFieldGroup>
          <NarrationStatus />
          <UTooltip v-if="setup.blocked.value" text="Claude cannot build scenes until Claude Code is installed and signed in">
            <UButton color="warning" variant="soft" icon="i-heroicons-exclamation-triangle" label="Set up Claude Code" @click="bower.show('claude')" />
          </UTooltip>
          <UTooltip v-else-if="project && setup.done.value < setup.total.value" text="Finish setting up this project so videos look like your real product">
            <UButton color="primary" variant="soft" icon="i-heroicons-rocket-launch" :label="`Setup ${setup.done.value}/${setup.total.value}`" @click="openSettings('general')" />
          </UTooltip>
          <UTooltip text="Plan the video: Claude drafts the scenes from a brief">
            <UButton color="neutral" variant="outline" icon="i-heroicons-clipboard-document-list" label="Storyboard" :disabled="!project" @click="storyOpen = true" />
          </UTooltip>
          <UTooltip text="This project: name, art direction, brand kit, app, code, narrator and captions">
            <UButton color="neutral" variant="outline" icon="i-heroicons-cog-6-tooth" label="Settings" :disabled="!project" @click="openSettings()" />
          </UTooltip>
          <UButton color="neutral" variant="outline" icon="i-heroicons-clipboard-document" label="Copy path" :disabled="!selected" @click="copyPath" />
          <UColorModeButton />
          <UButton icon="i-heroicons-arrows-pointing-out" label="Present" :disabled="!project" @click="presenting = true" />
        </div>
      </header>

      <UEmpty v-if="!loaded" loading variant="naked" title="Loading projects" class="flex-1 justify-center" />
      <UEmpty
        v-else-if="!project"
        variant="naked"
        size="lg"
        icon="i-heroicons-film"
        title="No projects"
        description="Start a new motion-graphics project, or restore one from the trash."
        class="flex-1 justify-center"
        :actions="[
          { label: 'New project', icon: 'i-heroicons-plus', onClick: () => { newOpen = true } },
          { label: 'Open trash', icon: 'i-heroicons-archive-box', color: 'neutral', variant: 'outline', onClick: () => { trashOpen = true } }
        ]"
      />

      <template v-else-if="mainTab === 'scenes'">
        <div class="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_minmax(380px,32%)]">
          <!-- Stage -->
          <section class="flex min-h-0 flex-col bg-muted">
            <div class="flex items-center gap-2 px-6 pt-2.5 pb-2 text-sm">
              <span class="font-medium text-highlighted">
                <template v-if="mode === 'scene'">Scene {{ selectedIndex + 1 }} of {{ project.scenes.length }}</template>
                <template v-else>Whole video</template>
              </span>
              <span class="text-muted">· {{ active?.scene.title }}<template v-if="mode === 'scene' && !loop"> · loops</template></span>
              <UBadge v-if="loop" color="primary" variant="subtle" size="sm" class="ml-1" icon="i-heroicons-arrow-path" :label="`Looping ${fmtSeconds(loop.from)}-${fmtSeconds(loop.to)}`" />
              <UButton v-if="loop" size="xs" color="neutral" variant="ghost" icon="i-heroicons-x-mark" aria-label="Clear loop" @click="ed.setLoop(null)" />
              <UBadge v-if="rate !== 1" color="warning" variant="subtle" size="sm" :label="`${rate}× speed`" />
              <div class="ml-auto flex items-center gap-2">
                <UFieldGroup size="sm" class="shrink-0">
                  <UTooltip text="Zoom out" :kbds="['-']"><UButton color="neutral" variant="outline" icon="i-heroicons-magnifying-glass-minus" aria-label="Zoom out" :disabled="!zoomed" @click="zoom(1 / 0.6)" /></UTooltip>
                  <UTooltip text="Zoom in" :kbds="['+']"><UButton color="neutral" variant="outline" icon="i-heroicons-magnifying-glass-plus" aria-label="Zoom in" @click="zoom(0.6)" /></UTooltip>
                </UFieldGroup>
                <UTooltip text="Playback speed">
                  <USelect v-model="rateModel" :items="rateItems" size="sm" class="w-20 shrink-0" aria-label="Playback speed" />
                </UTooltip>
                <UTooltip text="Shift-drag on the timeline, or press I and O, to loop a region">
                  <UButton size="sm" color="neutral" :variant="loop ? 'soft' : 'outline'" icon="i-heroicons-arrow-path-rounded-square" aria-label="Loop region" class="shrink-0" @click="loop ? ed.setLoop(null) : ed.setLoop(Math.max(0, time - 500), Math.min(timelineDuration, time + 1500))" />
                </UTooltip>
                <UButton size="sm" color="neutral" variant="outline" icon="i-heroicons-speaker-wave" label="Sound" class="shrink-0" @click="soundOpen = true" />
                <MusicControl v-if="FEATURES.music" class="shrink-0" />
              </div>
            </div>
            <div ref="stageBox" class="flex min-h-0 flex-1 items-center justify-center px-6">
              <div class="cursor-pointer" :style="{ width: `${stageSize.w}px`, height: `${stageSize.h}px` }" title="Click to play or pause" @click="ed.toggle()">
                <ScenePlayer v-if="active" :project="project" :scenes="playerScenes" :layers="layers" :caption="caption" rounded fixable />
              </div>
            </div>
            <div class="flex items-center gap-3 px-6 pt-3 pb-3">
              <UTabs v-model="modeModel" :items="modeTabs" :content="false" color="neutral" class="w-auto shrink-0" />
              <UTooltip :text="playing ? 'Pause' : 'Play'" :kbds="['space']">
                <UButton color="neutral" size="xl" class="shrink-0 rounded-full" :icon="playing ? 'i-heroicons-pause' : 'i-heroicons-play'" :aria-label="playing ? 'Pause' : 'Play'" @click="ed.toggle()" />
              </UTooltip>
              <span class="w-24 shrink-0 font-mono text-sm text-default tabular-nums">{{ (time / 1000).toFixed(2) }} <span class="text-dimmed">/ {{ fmtSeconds(timelineDuration, 1) }}</span></span>
              <TimelineBar
                class="min-w-0 flex-1"
                :duration="timelineDuration"
                :time="time"
                :playing="playing"
                :marks="marks"
                :cuts="cuts"
                :clips="clipMarks"
                :wave="wave"
                :loop="loop"
                :view="view"
                @seek="ed.seek"
                @scrub="onScrub"
                @loop="ed.setLoop"
                @view="ed.setView"
              />
            </div>
          </section>

          <ChatPanel />
        </div>
        <div class="border-t border-default bg-default">
          <SceneStrip />
        </div>
      </template>

      <RenderPanel v-else />
    </div>

    <PresentOverlay v-if="presenting" @close="presenting = false" />
    <SoundPanel v-if="project" v-model:open="soundOpen" @settings="openSettings('sound')" />
    <TrashModal v-model:open="trashOpen" />
    <ProjectSettingsModal v-if="project" v-model:open="settingsOpen" v-model:tab="settingsTab" />
    <BowerSettingsModal />
    <StoryboardModal v-if="project" v-model:open="storyOpen" />
    <HistoryModal v-if="project" v-model:open="historyOpen" />

    <div v-if="dropping" class="pointer-events-none fixed inset-0 z-40 grid place-items-center bg-inverted/30 backdrop-blur-sm">
      <UEmpty
        variant="outline"
        size="lg"
        icon="i-heroicons-signal"
        title="Drop music to sync"
        description="Beats, downbeats, phrases and sections are detected automatically. Sound effects and voice-over go in the Sound panel."
        class="bg-default shadow-2xl"
      />
    </div>

    <UModal v-model:open="newOpen" title="New project" :ui="{ footer: 'justify-end' }">
      <template #body>
        <UForm id="new-project" :state="newProject" @submit="createProject">
          <UFormField label="Name" name="name">
            <UInput v-model="newProject.name" placeholder="e.g. Launch teaser" autofocus class="w-full" />
          </UFormField>
          <UFormField label="Folder" name="folder" class="mt-4">
            <USelect v-model="newProject.folder" :items="folders.items.value" class="w-full" />
          </UFormField>
        </UForm>
      </template>
      <template #footer>
        <UButton color="neutral" variant="ghost" label="Cancel" @click="newOpen = false" />
        <UButton type="submit" form="new-project" color="neutral" label="Create" :disabled="!newProject.name.trim()" />
      </template>
    </UModal>

    <UModal v-model:open="deleteOpen" :title="`Delete “${project?.name}”?`" description="The project moves to the trash. You can restore it for 30 days." :ui="{ footer: 'justify-end' }">
      <template #footer>
        <UButton color="neutral" variant="ghost" label="Cancel" @click="deleteOpen = false" />
        <UButton color="error" icon="i-heroicons-trash" label="Move to trash" @click="deleteProject" />
      </template>
    </UModal>
  </div>
</template>
