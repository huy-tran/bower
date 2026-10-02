<script setup lang="ts">
// Everything that is a setting of the open project, in one place. Fields save as you change them.
export type SettingsTab = 'general' | 'art' | 'brand' | 'codebase' | 'app' | 'sound'

const open = defineModel<boolean>('open', { default: false })
const tab = defineModel<SettingsTab>('tab', { default: 'general' })

const ed = useEditor()
const { project, setProject } = ed
const narration = useNarration()
const folders = useFolders()
const toast = useToast()

const tabs = [
  { label: 'General', value: 'general', icon: 'i-heroicons-adjustments-horizontal', description: 'Name, stage and how Claude works on this project.' },
  { label: 'Art direction', value: 'art', icon: 'i-heroicons-paint-brush', description: 'Project-wide style guidance included in every prompt to Claude.' },
  { label: 'Brand kit', value: 'brand', icon: 'i-heroicons-swatch', description: 'Colours, fonts and logos shared across projects. Claude follows the kit this project uses.' },
  { label: 'Codebase', value: 'codebase', icon: 'i-heroicons-code-bracket', description: 'Repositories on this machine that Claude may read (never edit) so scenes can copy the product\'s real screens, components, data, colours and copy. Link each repo separately, for example the API and the frontend.' },
  { label: 'App', value: 'app', icon: 'i-heroicons-window', description: 'The running product. Sign in once, then you and Claude can take screenshots of its real screens for scenes.' },
  { label: 'Sound', value: 'sound', icon: 'i-heroicons-speaker-wave', description: 'The narrator for generated voice-over, and how captions appear in the video.' }
]
const current = computed(() => tabs.find(t => t.value === tab.value) ?? tabs[0]!)

// Local drafts so typing feels instant; each is written back shortly after the last change.
const draft = reactive({
  name: '',
  visualChecks: true,
  artDirection: '',
  repos: [] as { label: string, path: string, notes: string }[],
  app: { url: '', notes: '', mode: 'shots' as 'shots' | 'rebuild' | 'auto' },
  narrator: { voice: 'af_heart', speed: 1 },
  pronunciations: [] as { term: string, sayAs: string }[],
  captions: { burnIn: false, position: 'bottom' as 'bottom' | 'top', size: 44 }
})
const saved = ref(false)
const picking = ref(false)
const pickerOpen = ref(false)

watch([open, project], ([o]) => {
  const p = project.value
  if (!o || !p) return
  draft.name = p.name
  draft.visualChecks = p.visualChecks
  draft.artDirection = p.artDirection
  draft.repos = p.codebases.map(c => ({ ...c }))
  draft.app = { url: p.app?.url ?? '', notes: p.app?.notes ?? '', mode: p.app?.mode ?? (p.app ? 'auto' : 'shots') }
  draft.narrator = { voice: p.narrator.voice, speed: p.narrator.speed }
  draft.pronunciations = p.narrator.pronunciations.map(x => ({ ...x }))
  draft.captions = { ...p.captions }
}, { immediate: true })

let timer: ReturnType<typeof setTimeout>
let flash: ReturnType<typeof setTimeout>
function save(body: Record<string, unknown>, delay = 400) {
  clearTimeout(timer)
  timer = setTimeout(async () => {
    try {
      setProject(await $fetch(`/api/projects/${project.value!.id}`, { method: 'PATCH', body }))
      if (body.name) await ed.loadProjects()
      saved.value = true
      clearTimeout(flash)
      flash = setTimeout(() => (saved.value = false), 1500)
    } catch (e: any) {
      toast.add({ title: 'Could not save', description: e?.data?.message || e?.message, color: 'error' })
    }
  }, delay)
}

const saveName = () => { if (draft.name.trim()) save({ name: draft.name.trim() }) }
const saveVisual = (v: boolean) => { draft.visualChecks = v; save({ visualChecks: v }, 0) }
const saveArt = () => save({ artDirection: draft.artDirection }, 600)
const saveNarrator = () => save({ narrator: { ...draft.narrator } })
// Pronunciation fixes: saved as a whole list; rows without a term are dropped on save.
const savePronunciations = () => save({ narrator: { pronunciations: draft.pronunciations.filter(x => x.term.trim()) } }, 600)
function addPronunciation() { draft.pronunciations.push({ term: '', sayAs: '' }) }
function removePronunciation(i: number) { draft.pronunciations.splice(i, 1); savePronunciations() }
const saveCaptions = () => save({ captions: { ...draft.captions } })
// The running product: address and notes autosave; a visible window handles sign-in; captures go to assets/shots.
const chat = useChat()
const appLinked = computed(() => !!project.value?.app)
const saveApp = () => save({ app: draft.app.url.trim() ? { url: draft.app.url.trim(), notes: draft.app.notes, mode: draft.app.mode } : null }, 600)
const appModeItems = [
  { label: 'Real screenshots', description: 'Claude captures the states it needs and animates them with crops, zooms and crossfades. Pixel-exact.', value: 'shots' },
  { label: 'Rebuild in HTML', description: 'Claude redraws screens from screenshots and the code, so parts can animate separately.', value: 'rebuild' },
  { label: 'Let Claude decide', description: 'Screenshots for authenticity, rebuilt screens when parts must move on their own.', value: 'auto' }
]
const loginOpen = ref(false)
const shots = ref<{ name: string, path: string, url: string, at: string }[]>([])
const capture = reactive({ target: '/', size: 'desktop', fullPage: false, steps: '', busy: false })
const sizeItems = [{ label: 'Desktop 1440×900', value: 'desktop' }, { label: 'Laptop 1280×800', value: 'laptop' }, { label: 'Tablet 834×1194', value: 'tablet' }, { label: 'Mobile 390×844', value: 'mobile' }]
async function loadShots() {
  if (!project.value) return
  shots.value = await $fetch(`/api/projects/${project.value.id}/app/shots`).catch(() => [])
  loginOpen.value = (await $fetch<{ open: boolean }>(`/api/projects/${project.value.id}/app/login`).catch(() => ({ open: false }))).open
}
watch([tab, open], ([t, o]) => { if (o && t === 'app') loadShots() }, { immediate: true })
async function openLogin() {
  try {
    await $fetch(`/api/projects/${project.value!.id}/app/login`, { method: 'POST', body: { target: capture.target } })
    loginOpen.value = true
    toast.add({ title: 'Browser window opened', description: 'Sign in there, then close the window. The session is kept for screenshots.', color: 'info', duration: 8000 })
    const poll = setInterval(async () => {
      const r = await $fetch<{ open: boolean }>(`/api/projects/${project.value!.id}/app/login`).catch(() => ({ open: false }))
      if (!r.open) { loginOpen.value = false; clearInterval(poll) }
    }, 2000)
  } catch (err: any) {
    toast.add({ title: 'Could not open the browser', description: err?.data?.message || err?.message, color: 'error' })
  }
}
async function closeLogin() {
  await $fetch(`/api/projects/${project.value!.id}/app/login`, { method: 'DELETE' }).catch(() => {})
  loginOpen.value = false
}
async function takeShot() {
  capture.busy = true
  try {
    const r = await $fetch<{ shots: any[] }>(`/api/projects/${project.value!.id}/app/shots`, { method: 'POST', body: { target: capture.target, size: capture.size, fullPage: capture.fullPage, steps: capture.steps.trim() || undefined } })
    shots.value = [...r.shots.slice().reverse(), ...shots.value]
    const one = r.shots.length === 1 ? r.shots[0] : null
    toast.add({ title: one ? 'Screenshot saved' : `${r.shots.length} screenshots saved`, description: one ? `${one.path} · ${one.width}×${one.height}${one.fullPage ? ', full page' : ''}` : r.shots.map(s => s.name).join(', '), color: 'success' })
  } catch (err: any) {
    // A failed step saves a PNG of where the page got to; show it with the others so it can be inspected.
    toast.add({ title: 'Could not take the screenshot', description: err?.data?.message || err?.message, color: 'error', duration: 12000 })
    if (err?.data?.data?.failed) loadShots()
  } finally {
    capture.busy = false
  }
}
async function deleteShot(name: string) {
  shots.value = await $fetch(`/api/projects/${project.value!.id}/app/shots/${name}`, { method: 'DELETE' })
}
function useInChat(s: { path: string, url: string, name: string }) {
  chat.queueAttachment({ path: s.path, url: s.url, name: s.name })
  toast.add({ title: 'Attached to the next chat message', description: 'Describe what to do with it and send.', color: 'success' })
}

// Linked repositories. Labels and notes autosave; adding one is explicit because the server validates the path.
const newRepo = reactive({ label: '', path: '', notes: '' })
// The link form stays tucked behind "Add repository" once a repo is linked; with none it is the whole tab.
const linkFormOpen = ref(false)
const showLinkForm = computed(() => !draft.repos.length || linkFormOpen.value)
function cancelLink() {
  Object.assign(newRepo, { label: '', path: '', notes: '' })
  linkFormOpen.value = false
}
const saveRepos = () => save({ codebases: draft.repos }, 600)
async function addRepo() {
  const path = newRepo.path.trim()
  if (!path) return
  const notes = newRepo.notes
  try {
    const view = await $fetch<any>(`/api/projects/${project.value!.id}`, { method: 'PATCH', body: { codebases: [...draft.repos, { label: newRepo.label.trim(), path, notes }] } })
    setProject(view)
    Object.assign(newRepo, { label: '', path: '', notes: '' })
    linkFormOpen.value = false
    // No note written by hand: let Claude read the repo and write one.
    const added = view.codebases.find((c: any) => c.path.toLowerCase() === path.toLowerCase() || c.path.toLowerCase().endsWith(path.replace(/[\\/]+$/, '').toLowerCase()))
    if (added && !notes.trim()) {
      toast.add({ title: 'Repository linked', description: 'Claude is reading it to write the "where to look" note.', color: 'success' })
      scanRepo(added.path)
    } else {
      toast.add({ title: 'Repository linked', description: 'Claude can read it from the next prompt.', color: 'success' })
    }
  } catch (err: any) {
    toast.add({ title: 'Could not link that folder', description: err?.data?.message || err?.message, color: 'error' })
  }
}

// Claude scans a repo (read-only) and writes its note; the server runs it and we poll for the result.
const scans = reactive<Record<string, { activity: string[] }>>({})
async function scanRepo(path: string) {
  if (scans[path]) return
  scans[path] = { activity: ['Starting Claude…'] }
  const pid = project.value!.id
  try {
    await $fetch(`/api/projects/${pid}/codebases/scan`, { method: 'POST', body: { path } })
    for (;;) {
      await new Promise(r => setTimeout(r, 1500))
      const j = await $fetch<{ status: string, activity: string[], error?: string, project?: any }>(`/api/projects/${pid}/codebases/scan`, { query: { path } })
      scans[path]!.activity = j.activity
      if (j.status === 'running') continue
      if (j.status === 'error') throw new Error(j.error || 'Scan failed')
      if (j.project && project.value?.id === pid) setProject(j.project)
      toast.add({ title: 'Repository scanned', description: 'Claude wrote the "where to look" note. Edit it if anything is off.', color: 'success' })
      break
    }
  } catch (err: any) {
    toast.add({ title: 'Could not scan the repository', description: err?.data?.message || err?.message, color: 'error' })
  } finally {
    delete scans[path]
  }
}
async function removeRepo(path: string) {
  try {
    setProject(await $fetch(`/api/projects/${project.value!.id}`, { method: 'PATCH', body: { codebases: draft.repos.filter(r => r.path !== path) } }))
    toast.add({ title: 'Repository unlinked', color: 'neutral' })
  } catch (err: any) {
    toast.add({ title: 'Could not unlink', description: err?.data?.message || err?.message, color: 'error' })
  }
}
async function browseFolder() {
  picking.value = true
  try {
    const title = 'Choose the repository folder', initial = newRepo.path.trim() || undefined
    // The desktop app has a native chooser; in a browser the server opens the OS one.
    const desktop = bowerDesktop()
    const path = desktop
      ? await desktop.pickFolder(title, initial)
      : (await $fetch<{ path: string | null }>('/api/pick-folder', { method: 'POST', body: { title, initial } })).path
    if (path) {
      newRepo.path = path
      newRepo.label ||= path.split(/[\\/]/).filter(Boolean).pop() ?? ''
    }
  } catch (err: any) {
    toast.add({ title: 'Could not open the folder chooser', description: err?.data?.message || err?.message, color: 'error' })
  } finally {
    picking.value = false
  }
}

async function copyPath() {
  const path = project.value?.path
  if (!path) return
  await navigator.clipboard.writeText(path)
  toast.add({ title: 'Path copied', description: path, color: 'neutral' })
}

const formatLabel = computed(() => {
  const p = project.value
  if (!p) return ''
  const r = p.width / p.height
  return Math.abs(r - 16 / 9) < 0.01 ? '16:9' : Math.abs(r - 9 / 16) < 0.01 ? '9:16' : Math.abs(r - 1) < 0.01 ? '1:1' : Math.abs(r - 4 / 5) < 0.01 ? '4:5' : `${p.width}×${p.height}`
})

// Narrator voice list: shortlisted voices first, as their own group.
const voiceItems = computed(() => {
  const list = project.value?.narrator.shortlist ?? []
  const starred = VOICES.filter(v => list.includes(v.value)).map(v => ({ ...v, icon: 'i-heroicons-star-solid' }))
  const rest = VOICES.filter(v => !list.includes(v.value))
  return starred.length ? [starred, rest] : VOICES
})
const narratedCount = computed(() => project.value?.scenes.filter(s => s.voice).length ?? 0)
const hasCaptions = computed(() => !!project.value?.clips.some(c => c.captions?.length))
const positionItems = [{ label: 'Bottom', value: 'bottom' }, { label: 'Top', value: 'top' }]

function download(format: 'srt' | 'vtt') {
  const text = subtitles(project.value!.clips, format)
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain' }))
  a.download = `${project.value!.name}.${format}`
  a.click()
  URL.revokeObjectURL(a.href)
}
</script>

<template>
  <UModal v-model:open="open" :title="project?.name" description="Project settings" :ui="{ content: 'max-w-4xl', body: 'p-0 sm:p-0', footer: 'justify-between' }">
    <template #body>
      <VoicePicker v-model:open="pickerOpen" />
      <div class="grid min-h-[60vh] grid-cols-[12rem_1fr]">
        <UTabs v-model="tab" :items="tabs" orientation="vertical" :content="false" color="neutral" variant="link" class="h-full border-r border-default px-3 py-4" :ui="{ root: 'items-start justify-start', list: 'w-full gap-1', trigger: 'justify-start gap-2.5 px-3 py-2' }" />
        <div class="max-h-[70vh] overflow-y-auto p-5">
          <div class="mb-5 border-b border-default pb-4">
            <h2 class="flex items-center gap-2 text-base font-semibold text-highlighted"><UIcon :name="current.icon" class="size-5" /> {{ current.label }}</h2>
            <p class="mt-1 text-sm text-muted">{{ current.description }}</p>
          </div>

          <!-- General -->
          <div v-if="tab === 'general'" class="space-y-5">
            <UFormField label="Name">
              <UInput v-model="draft.name" class="w-full" @update:model-value="saveName" />
            </UFormField>
            <UFormField label="Folder" help="Where the project is filed in the project picker.">
              <USelect :model-value="toFolderValue(project?.folder ?? '')" :items="folders.items.value" class="w-full" @update:model-value="v => folders.moveProject(project!.id, String(v))" />
            </UFormField>
            <UFormField label="Project folder on disk" help="Scenes, assets, sound and Claude's notes live here.">
              <UFieldGroup class="w-full">
                <UInput :model-value="project?.path" readonly class="flex-1 font-mono text-xs" />
                <UButton color="neutral" variant="outline" icon="i-heroicons-clipboard-document" label="Copy" @click="copyPath" />
              </UFieldGroup>
            </UFormField>
            <UFormField label="Stage" :help="`Use “New version for social” in the project menu to make a copy in another shape.`">
              <div class="flex items-center gap-2 text-sm">
                <UBadge color="neutral" variant="soft" :label="formatLabel" />
                <span class="text-muted">{{ project?.width }} × {{ project?.height }} px · {{ project?.fps }} fps</span>
              </div>
            </UFormField>
            <UFormField label="Visual checks" description="Claude renders frames to check its own work before replying. Slower, better results.">
              <USwitch :model-value="draft.visualChecks" aria-label="Visual checks" @update:model-value="saveVisual" />
            </UFormField>
          </div>

          <!-- Art direction -->
          <div v-else-if="tab === 'art'" class="space-y-3">
            <UTextarea v-model="draft.artDirection" :rows="12" autoresize class="w-full" placeholder="e.g. Swiss minimalism. Inter Display, very tight tracking. Black on warm off-white (#faf9f7). One accent colour: #3b82f6. Motion is calm and precise - outExpo arrivals, never bouncy." @update:model-value="saveArt" />
          </div>

          <!-- Brand kit -->
          <BrandKitPanel v-else-if="tab === 'brand'" />

          <!-- Codebase -->
          <div v-else-if="tab === 'codebase'" class="space-y-5">
            <UCard v-for="(r, i) in draft.repos" :key="r.path" :ui="{ body: 'p-4 sm:p-4 space-y-3' }">
              <div class="flex items-center gap-2">
                <UIcon name="i-heroicons-code-bracket" class="size-4 shrink-0 text-muted" />
                <UInput v-model="r.label" variant="ghost" size="sm" placeholder="Label, e.g. API" class="w-40 font-semibold" @update:model-value="saveRepos" />
                <span class="min-w-0 flex-1 truncate font-mono text-xs text-muted" :title="r.path">{{ r.path }}</span>
                <UTooltip :text="r.notes.trim() ? 'Have Claude read the repo again and rewrite the note' : 'Have Claude read the repo and write the note'">
                  <UButton size="xs" color="neutral" variant="soft" icon="i-heroicons-sparkles" :label="r.notes.trim() ? 'Rescan' : 'Scan with Claude'" :loading="!!scans[r.path]" :aria-label="`Scan ${r.label}`" @click="scanRepo(r.path)" />
                </UTooltip>
                <UTooltip text="Unlink this repository">
                  <UButton size="xs" color="neutral" variant="ghost" icon="i-heroicons-link-slash" :aria-label="`Unlink ${r.label}`" @click="removeRepo(r.path)" />
                </UTooltip>
              </div>
              <p v-if="scans[r.path]" class="flex items-center gap-1.5 text-xs text-muted"><UIcon name="i-heroicons-arrow-path" class="size-3.5 animate-spin" /> {{ scans[r.path]!.activity.at(-1) }}</p>
              <UTextarea v-model="draft.repos[i]!.notes" :rows="3" autoresize class="w-full" :placeholder="scans[r.path] ? 'Claude is writing this…' : 'Where to look, e.g. Laravel API: routes in routes/api.php, models in app/Models, resources in app/Http/Resources. Or click Scan with Claude.'" @update:model-value="saveRepos" />
            </UCard>

            <UButton v-if="!showLinkForm" color="neutral" variant="outline" icon="i-heroicons-plus" label="Add repository" @click="linkFormOpen = true" />
            <UCard v-else :ui="{ body: 'p-4 sm:p-4 space-y-3' }">
              <h3 class="font-semibold text-highlighted">{{ draft.repos.length ? 'Link another repository' : 'Link a repository' }}</h3>
              <div class="grid grid-cols-[10rem_1fr] gap-2">
                <UFormField label="Label" size="sm">
                  <UInput v-model="newRepo.label" placeholder="e.g. API, Frontend" size="sm" class="w-full" />
                </UFormField>
                <UFormField label="Folder" size="sm" hint="Absolute path">
                  <div class="flex gap-2">
                    <UInput v-model="newRepo.path" placeholder="e.g. C:\Users\you\Herd\acme-api" size="sm" class="flex-1 font-mono text-sm" @keydown.enter="addRepo" />
                    <UTooltip text="Opens your computer's folder chooser">
                      <UButton size="sm" color="neutral" variant="outline" icon="i-heroicons-folder-open" label="Browse…" :loading="picking" @click="browseFolder" />
                    </UTooltip>
                  </div>
                </UFormField>
              </div>
              <UFormField label="Where to look" size="sm" hint="Optional" help="Leave it empty and Claude reads the repo and writes this note itself after linking.">
                <UTextarea v-model="newRepo.notes" :rows="3" autoresize class="w-full" placeholder="e.g. Vue 3 app. Screens in src/pages, components in src/components, design tokens in tailwind.config.js and src/assets/css/app.css." />
              </UFormField>
              <div class="flex items-center justify-end gap-2">
                <UButton v-if="draft.repos.length" color="neutral" variant="ghost" label="Cancel" @click="cancelLink" />
                <UButton icon="i-heroicons-link" label="Link" :disabled="!newRepo.path.trim()" @click="addRepo" />
              </div>
            </UCard>
          </div>

          <!-- App -->
          <div v-else-if="tab === 'app'" class="space-y-5">
            <UFormField label="App address" hint="Base URL" help="Where the product runs for you, for example a local dev server or a staging site.">
              <UInput v-model="draft.app.url" placeholder="e.g. http://localhost:8000 or https://staging.acme.com" class="w-full font-mono text-sm" @update:model-value="saveApp" />
            </UFormField>
            <UFormField label="Getting around" hint="Optional" help="Tell Claude how the app is laid out: key pages and their paths, demo account details, what to avoid.">
              <UTextarea v-model="draft.app.notes" :rows="3" autoresize class="w-full" placeholder="e.g. Dashboard at /dashboard, projects at /projects/1. Use the demo workspace. Avoid /admin." @update:model-value="saveApp" />
            </UFormField>
            <UFormField label="How Claude shows the app" help="A scene can override this from the picker in its chat. Saying it in a request always wins.">
              <URadioGroup v-model="draft.app.mode" :items="appModeItems" :disabled="!draft.app.url.trim()" @update:model-value="saveApp" />
            </UFormField>

            <UCard :ui="{ body: 'p-4 sm:p-4 space-y-3' }">
              <div class="flex items-start justify-between gap-3">
                <div>
                  <h3 class="font-semibold text-highlighted">Sign in</h3>
                  <p class="text-xs text-muted">Opens a browser window on the app. Sign in there and close it; screenshots then use that session. Nothing about your login is stored by Bower beyond the browser profile on this machine.</p>
                </div>
                <UButton v-if="!loginOpen" color="neutral" variant="outline" icon="i-heroicons-arrow-top-right-on-square" label="Open browser" :disabled="!appLinked" @click="openLogin" />
                <UButton v-else color="neutral" variant="soft" icon="i-heroicons-x-mark" label="Close window" @click="closeLogin" />
              </div>
            </UCard>

            <UCard :ui="{ body: 'p-4 sm:p-4 space-y-3' }">
              <h3 class="font-semibold text-highlighted">Take a screenshot</h3>
              <div class="grid grid-cols-[1fr_11rem] gap-2">
                <UFormField label="Page" size="sm" hint="Path or full URL">
                  <UInput v-model="capture.target" placeholder="/dashboard" size="sm" class="w-full font-mono text-sm" @keydown.enter="takeShot" />
                </UFormField>
                <UFormField label="Viewport" size="sm">
                  <USelect v-model="capture.size" :items="sizeItems" size="sm" class="w-full" />
                </UFormField>
              </div>
              <UFormField label="Steps before capturing" size="sm" hint="Optional, JSON">
                <UTextarea v-model="capture.steps" :rows="2" autoresize size="sm" class="w-full font-mono text-xs" placeholder='[{"click":"Export"},{"wait":"Export contacts"},{"shot":"export-modal"}]' />
              </UFormField>
              <div class="flex items-center justify-between gap-3">
                <USwitch v-model="capture.fullPage" label="Whole page, not just the first screen" size="sm" />
                <UButton icon="i-heroicons-camera" label="Capture" :loading="capture.busy" :disabled="!appLinked || loginOpen" @click="takeShot" />
              </div>
              <p v-if="loginOpen" class="text-xs text-warning">Close the sign-in window before capturing.</p>
              <p class="text-xs text-muted">Steps drive the page first: click, type, select, wait, scroll, hover, press, goto, and shot to save a PNG along the way. Claude can take its own with <code>node bower.mjs shot &lt;page&gt;</code> while it works on a scene.</p>
            </UCard>

            <div v-if="shots.length" class="grid grid-cols-3 gap-3">
              <div v-for="s in shots" :key="s.name" class="group relative">
                <a :href="s.url" target="_blank" class="block overflow-hidden rounded-md bg-elevated ring-1 ring-default">
                  <img :src="s.url" :alt="s.name" class="aspect-[16/10] w-full object-cover object-top">
                </a>
                <p class="mt-1 truncate font-mono text-[11px] text-muted" :title="s.path">{{ s.name }}</p>
                <div class="absolute top-1.5 right-1.5 flex gap-1 opacity-0 group-hover:opacity-100">
                  <UTooltip text="Attach to the next chat message"><UButton size="xs" color="neutral" variant="solid" icon="i-heroicons-chat-bubble-left" :aria-label="`Use ${s.name} in chat`" @click="useInChat(s)" /></UTooltip>
                  <UTooltip text="Delete"><UButton size="xs" color="error" variant="solid" icon="i-heroicons-trash" :aria-label="`Delete ${s.name}`" @click="deleteShot(s.name)" /></UTooltip>
                </div>
              </div>
            </div>
            <UEmpty v-else-if="appLinked" variant="soft" size="sm" icon="i-heroicons-camera" title="No screenshots yet" description="Capture one above, or ask Claude for a scene that uses the real app and it will take its own." />
          </div>

          <!-- Sound -->
          <div v-else-if="tab === 'sound'" class="space-y-6">
            <section class="space-y-4">
              <h3 class="flex items-center gap-2 font-semibold text-highlighted"><UIcon name="i-heroicons-microphone" class="size-4" /> Narrator</h3>
              <p class="text-sm text-muted">Ask Claude to write a voice-over and every scene with a script is spoken in this voice, automatically. Speech is made on this computer with Kokoro, a free open-source model (about 90 MB, downloaded once, works offline, English only).</p>
              <div class="grid grid-cols-[1fr_10rem] gap-4">
                <UFormField label="Voice">
                  <UFieldGroup class="w-full">
                    <USelect v-model="draft.narrator.voice" :items="voiceItems" class="flex-1" @update:model-value="saveNarrator" />
                    <UTooltip text="Listen to every voice on your own line and shortlist the ones you like">
                      <UButton color="neutral" variant="outline" icon="i-heroicons-speaker-wave" label="Audition" @click="pickerOpen = true" />
                    </UTooltip>
                  </UFieldGroup>
                </UFormField>
                <UFormField :label="`Speed · ${draft.narrator.speed.toFixed(2)}×`">
                  <USlider v-model="draft.narrator.speed" :min="0.7" :max="1.3" :step="0.05" class="mt-3" @update:model-value="saveNarrator" />
                </UFormField>
              </div>
              <p v-if="narratedCount" class="text-xs text-muted">{{ narratedCount }} scene{{ narratedCount > 1 ? 's' : '' }} narrated. Changing the voice or speed applies to new and edited scripts; use the regenerate button on a clip in the Sound panel to redo it in the new voice.</p>
              <UFormField label="Pronunciation" description="Words the voice gets wrong, and how to say them. Captions keep the real spelling. Scenes that use a term are re-narrated when you change it.">
                <div class="space-y-2">
                  <div v-for="(row, i) in draft.pronunciations" :key="i" class="grid grid-cols-[1fr_auto_1fr_auto] items-center gap-2">
                    <UInput v-model="row.term" size="sm" placeholder="Word, e.g. GIF" @update:model-value="savePronunciations" />
                    <UIcon name="i-heroicons-arrow-right" class="size-4 text-dimmed" />
                    <UInput v-model="row.sayAs" size="sm" placeholder="Say as, e.g. jif" @update:model-value="savePronunciations" />
                    <UButton size="xs" color="neutral" variant="ghost" icon="i-heroicons-x-mark" aria-label="Remove" @click="removePronunciation(i)" />
                  </div>
                  <UButton size="xs" color="neutral" variant="outline" icon="i-heroicons-plus" label="Add a word" @click="addPronunciation" />
                </div>
              </UFormField>
              <UAlert v-if="narration.state.failed.size" color="warning" variant="subtle" :title="`${narration.state.failed.size} scene${narration.state.failed.size > 1 ? 's' : ''} could not be narrated`" :actions="[{ label: 'Retry', size: 'xs', color: 'neutral', onClick: narration.retry }]" />
            </section>

            <USeparator />

            <section class="space-y-4">
              <h3 class="flex items-center gap-2 font-semibold text-highlighted"><UIcon name="i-heroicons-chat-bubble-bottom-center-text" class="size-4" /> Captions</h3>
              <USwitch v-model="draft.captions.burnIn" label="Show captions in the video" description="Burned into renders and the web player (viewers can turn them off in the player)." @update:model-value="saveCaptions" />
              <div class="grid grid-cols-2 gap-4">
                <UFormField label="Position">
                  <USelect v-model="draft.captions.position" :items="positionItems" class="w-full" @update:model-value="saveCaptions" />
                </UFormField>
                <UFormField :label="`Size · ${draft.captions.size}px`">
                  <USlider v-model="draft.captions.size" :min="20" :max="96" class="mt-2.5" @update:model-value="saveCaptions" />
                </UFormField>
              </div>
              <div class="flex gap-2">
                <UButton size="sm" color="neutral" variant="outline" icon="i-heroicons-arrow-down-tray" label="Download .srt" :disabled="!hasCaptions" @click="download('srt')" />
                <UButton size="sm" color="neutral" variant="outline" icon="i-heroicons-arrow-down-tray" label="Download .vtt" :disabled="!hasCaptions" @click="download('vtt')" />
              </div>
            </section>
          </div>
        </div>
      </div>
    </template>
    <template #footer>
      <p class="text-xs text-muted transition-opacity" :class="saved ? 'opacity-100' : 'opacity-0'"><UIcon name="i-heroicons-check" class="size-3.5 align-text-bottom" /> Saved</p>
      <UButton color="neutral" label="Done" @click="open = false" />
    </template>
  </UModal>
</template>
