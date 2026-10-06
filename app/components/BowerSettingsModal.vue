<script setup lang="ts">
// Bower's own settings for this computer, shared by every project: Claude Code, the default Claude model, what
// new projects start with, and the shared apps (products) that projects pick from.
import { VOICES } from '~/utils/speech'

const { open, tab } = useBowerSettings()
const toast = useToast()
const ed = useEditor()
const models = useModels()

const tabs = [
  { label: 'Claude Code', value: 'claude', icon: 'i-heroicons-sparkles', description: 'Bower builds scenes with Claude Code on this computer.' },
  { label: 'New projects', value: 'defaults', icon: 'i-heroicons-document-plus', description: 'What new projects start with, and the Claude model used wherever a project does not pick one. Existing projects keep their own settings.' },
  { label: 'Apps', value: 'apps', icon: 'i-heroicons-window', description: 'The products your videos are about. Each is set up once (address, notes, code, sign-in) and shared by every project that picks it.' },
  { label: 'Appearance', value: 'appearance', icon: 'i-heroicons-swatch', description: 'How Bower looks on this computer. Your videos are not affected.' },
  { label: 'Shortcuts', value: 'keys', icon: 'i-heroicons-command-line', description: 'Change the keys for playback. They work the same in the browser and the desktop app, whenever you are not typing.' }
]

// Changing a shortcut: click Change, press the new keys (Escape cancels). Keys already used elsewhere are refused.
const hotkeys = useHotkeys()
const ACTIONS = Object.keys(HOTKEY_LABELS) as HotkeyAction[]
const capturing = ref<HotkeyAction | null>(null)
const keyError = ref('')
function onCaptureKey(e: KeyboardEvent) {
  if (!capturing.value) return
  e.preventDefault()
  e.stopPropagation()
  if (e.key === 'Escape') { capturing.value = null; keyError.value = ''; return }
  const combo = comboOf(e)
  if (!combo) return
  const used = hotkeys.clash(capturing.value, combo)
  if (used) { keyError.value = `${kbdsOf(combo).join(' + ')} already does "${used}". Try another key.`; return }
  const action = capturing.value
  capturing.value = null
  keyError.value = ''
  hotkeys.set(action, combo)
}
watch(capturing, (c) => {
  if (c) window.addEventListener('keydown', onCaptureKey, true)
  else window.removeEventListener('keydown', onCaptureKey, true)
})
watch(open, (o) => { if (!o) capturing.value = null })
const colorMode = useColorMode()
const themeItems = [
  { label: 'Light', value: 'light' },
  { label: 'Dark', value: 'dark' },
  { label: 'Match system', description: 'Follow the light or dark setting of this computer.', value: 'system' }
]
const current = computed(() => tabs.find(t => t.value === tab.value) ?? tabs[0]!)

interface Defaults { width: number, height: number, fps: number, visualChecks: boolean, appMode: 'shots' | 'rebuild' | 'auto', voice: string }
const settings = reactive<{ model: string, defaults: Defaults }>({ model: 'default', defaults: { width: 1920, height: 1080, fps: 30, visualChecks: true, appMode: 'shots', voice: 'af_heart' } })
const saved = ref(false)
let flash: ReturnType<typeof setTimeout>
async function load() {
  const s = await $fetch<{ model?: string, defaults: Defaults }>('/api/settings').catch(() => null)
  if (s) { settings.model = s.model || 'default'; settings.defaults = { ...s.defaults }; models.setBowerDefault(s.model ?? null) }
}
watch(open, (o) => { if (o) { load(); loadApps() } }, { immediate: true })
async function patch(body: Record<string, unknown>) {
  try {
    const s = await $fetch<{ model?: string, defaults: Defaults }>('/api/settings', { method: 'PATCH', body })
    settings.model = s.model || 'default'
    settings.defaults = { ...s.defaults }
    models.setBowerDefault(s.model ?? null)
    saved.value = true
    clearTimeout(flash)
    flash = setTimeout(() => (saved.value = false), 1500)
  } catch (e: any) {
    toast.add({ title: 'Could not save', description: e?.data?.message || e?.message, color: 'error' })
  }
}

const MODELS = [
  { label: 'Claude Code’s default', value: 'default', description: 'Whatever Claude Code is set to use' },
  ...MODEL_CHOICES
]
const SHAPES = [
  { label: 'Landscape 16:9 (1920×1080)', value: '1920x1080' },
  { label: 'Portrait 9:16 (1080×1920)', value: '1080x1920' },
  { label: 'Square 1:1 (1080×1080)', value: '1080x1080' },
  { label: 'Portrait 4:5 (1080×1350)', value: '1080x1350' }
]
const shape = computed({
  get: () => `${settings.defaults.width}x${settings.defaults.height}`,
  set: (v: string) => { const [width, height] = v.split('x').map(Number); patch({ defaults: { width, height } }) }
})
const FPS = [24, 25, 30, 60].map(n => ({ label: `${n} fps`, value: n }))
const voiceItems = VOICES.map(v => ({ label: `${v.name} (${v.accent} ${v.gender.toLowerCase()})`, description: v.note, value: v.value }))
const appModeItems = [
  { label: 'Real screenshots', description: 'Pixel-exact screens, animated with crops, zooms and crossfades.', value: 'shots' },
  { label: 'Rebuild in HTML', description: 'Redrawn screens whose parts can move on their own.', value: 'rebuild' },
  { label: 'Let Claude decide', description: 'Whichever suits each request.', value: 'auto' }
]

// Shared apps.
interface AppRow { id: string, name: string, url: string, notes: string, codebases: unknown[], projects: { id: string, name: string }[] }
const apps = ref<AppRow[]>([])
async function loadApps() { apps.value = await $fetch<AppRow[]>('/api/apps').catch(() => []) }
const timers: Record<string, ReturnType<typeof setTimeout>> = {}
function saveApp(a: AppRow) {
  clearTimeout(timers[a.id])
  timers[a.id] = setTimeout(async () => {
    try {
      await $fetch(`/api/apps/${a.id}`, { method: 'PATCH', body: { name: a.name, url: a.url } })
      saved.value = true
      clearTimeout(flash)
      flash = setTimeout(() => (saved.value = false), 1500)
      // The open project may use this app: refresh it so its settings show the change.
      if (ed.project.value?.app?.id === a.id) ed.setProject(await $fetch(`/api/projects/${ed.project.value.id}`))
    } catch (e: any) {
      toast.add({ title: 'Could not save the app', description: e?.data?.message || e?.message, color: 'error' })
    }
  }, 600)
}
const confirming = ref<AppRow | null>(null)
async function removeApp() {
  const a = confirming.value
  if (!a) return
  try {
    await $fetch(`/api/apps/${a.id}`, { method: 'DELETE' })
    toast.add({ title: `“${a.name}” removed`, description: 'Its sign-in and saved login were removed from this computer.', color: 'neutral' })
    await loadApps()
  } catch (e: any) {
    toast.add({ title: 'Could not remove the app', description: e?.data?.message || e?.message, color: 'error' })
  } finally {
    confirming.value = null
  }
}
const newApp = reactive({ url: '', busy: false })
async function addApp() {
  newApp.busy = true
  try {
    await $fetch('/api/apps', { method: 'POST', body: { url: newApp.url } })
    newApp.url = ''
    await loadApps()
  } catch (e: any) {
    toast.add({ title: 'Could not add the app', description: e?.data?.message || e?.message, color: 'error' })
  } finally {
    newApp.busy = false
  }
}
</script>

<template>
  <UModal v-model:open="open" title="Bower settings" description="For this computer and every project" :ui="{ content: 'max-w-4xl', body: 'p-0 sm:p-0', footer: 'justify-between' }">
    <template #body>
      <div class="grid min-h-[60vh] grid-cols-[12rem_1fr]">
        <UTabs v-model="tab" :items="tabs" orientation="vertical" :content="false" color="neutral" variant="link" class="h-full border-r border-default px-3 py-4" :ui="{ root: 'items-start justify-start', list: 'w-full gap-1', trigger: 'justify-start gap-2.5 px-3 py-2' }" />
        <div class="max-h-[70vh] overflow-y-auto p-5">
          <div class="mb-5 border-b border-default pb-4">
            <h2 class="flex items-center gap-2 text-base font-semibold text-highlighted"><UIcon :name="current.icon" class="size-5" /> {{ current.label }}</h2>
            <p class="mt-1 text-sm text-muted">{{ current.description }}</p>
          </div>

          <ClaudeCodeSetup v-if="tab === 'claude'" />

          <div v-else-if="tab === 'keys'" class="space-y-5">
            <div class="divide-y divide-default rounded-lg ring-1 ring-default">
              <div v-for="a in ACTIONS" :key="a" class="flex items-center gap-3 px-4 py-3">
                <div class="min-w-0 flex-1">
                  <p class="text-sm font-medium text-highlighted">{{ HOTKEY_LABELS[a].label }}</p>
                  <p class="text-xs text-muted">{{ HOTKEY_LABELS[a].description }}</p>
                </div>
                <span v-if="capturing === a" class="animate-pulse text-sm text-primary">Press the new keys…</span>
                <span v-else class="flex gap-1"><UKbd v-for="k in kbdsOf(hotkeys.keys[a])" :key="k" :value="k" /></span>
                <UButton size="xs" color="neutral" variant="outline" :label="capturing === a ? 'Cancel' : 'Change'" @click="capturing = capturing === a ? null : a" />
                <UButton size="xs" color="neutral" variant="ghost" label="Reset" :disabled="hotkeys.keys[a] === HOTKEY_DEFAULTS[a]" @click="hotkeys.set(a, null)" />
              </div>
            </div>
            <p v-if="keyError" class="text-sm text-error">{{ keyError }}</p>
            <div>
              <h3 class="mb-2 text-sm font-semibold text-highlighted">Other shortcuts</h3>
              <div class="grid grid-cols-2 gap-x-6 gap-y-1.5 text-sm">
                <div v-for="f in FIXED_HOTKEYS" :key="f.combo" class="flex items-center justify-between gap-3">
                  <span class="text-muted">{{ f.label }}</span>
                  <span class="flex gap-1"><UKbd v-for="k in kbdsOf(f.combo)" :key="k" :value="k" size="sm" /></span>
                </div>
              </div>
            </div>
          </div>

          <div v-else-if="tab === 'appearance'" class="space-y-5">
            <UFormField label="Theme">
              <URadioGroup :model-value="colorMode.preference" :items="themeItems" @update:model-value="v => (colorMode.preference = String(v))" />
            </UFormField>
          </div>

          <div v-else-if="tab === 'defaults'" class="space-y-5">
            <UFormField label="Default model" help="For storyboards, building scenes and chats, unless a project picks its own in Project settings. The picker in each chat still overrides it for that message.">
              <USelect :model-value="settings.model" :items="MODELS" class="w-72" @update:model-value="v => patch({ model: v === 'default' ? null : v })" />
            </UFormField>
            <div class="grid grid-cols-2 gap-4">
              <UFormField label="Stage shape">
                <USelect v-model="shape" :items="SHAPES" class="w-full" />
              </UFormField>
              <UFormField label="Frame rate">
                <USelect :model-value="settings.defaults.fps" :items="FPS" class="w-full" @update:model-value="v => patch({ defaults: { fps: v } })" />
              </UFormField>
            </div>
            <UFormField label="Narrator voice">
              <USelect :model-value="settings.defaults.voice" :items="voiceItems" class="w-72" :ui="{ content: 'min-w-72' }" @update:model-value="v => patch({ defaults: { voice: v } })" />
            </UFormField>
            <UFormField label="Visual checks" description="Claude renders frames to check its own work before replying. Slower, better results.">
              <USwitch :model-value="settings.defaults.visualChecks" @update:model-value="v => patch({ defaults: { visualChecks: v } })" />
            </UFormField>
            <UFormField label="How Claude shows the app" help="For projects that pick an app. Each project can change it.">
              <URadioGroup :model-value="settings.defaults.appMode" :items="appModeItems" @update:model-value="v => patch({ defaults: { appMode: v } })" />
            </UFormField>
          </div>

          <div v-else-if="tab === 'apps'" class="space-y-4">
            <UCard v-for="a in apps" :key="a.id" :ui="{ body: 'p-4 sm:p-4 space-y-3' }">
              <div class="grid grid-cols-[12rem_1fr_auto] items-end gap-3">
                <UFormField label="Name" size="sm"><UInput v-model="a.name" size="sm" class="w-full" @update:model-value="saveApp(a)" /></UFormField>
                <UFormField label="Address" size="sm"><UInput v-model="a.url" size="sm" class="w-full font-mono text-xs" @update:model-value="saveApp(a)" /></UFormField>
                <UTooltip :text="a.projects.length ? 'Still used by a project' : 'Remove this app and its sign-in'">
                  <UButton size="sm" color="error" variant="ghost" icon="i-heroicons-trash" :disabled="!!a.projects.length" :aria-label="`Remove ${a.name}`" @click="confirming = a" />
                </UTooltip>
              </div>
              <p class="text-xs text-muted">
                <template v-if="a.projects.length">Used by {{ a.projects.map(p => `“${p.name}”`).join(', ') }}.</template>
                <template v-else>Not used by any project.</template>
                {{ a.codebases.length ? `${a.codebases.length} linked ${a.codebases.length === 1 ? 'repository' : 'repositories'}.` : '' }}
                Notes, code and sign-in are edited from a project that uses it (Project settings, App and Codebase).
              </p>
            </UCard>
            <UEmpty v-if="!apps.length" variant="soft" icon="i-heroicons-window" title="No apps yet" description="Add one here, or pick “Add a new app” in a project’s settings." />
            <UCard :ui="{ body: 'p-4 sm:p-4' }">
              <UFormField label="Add an app" help="Its address, for example a local dev server or a staging site.">
                <div class="flex gap-2">
                  <UInput v-model="newApp.url" class="flex-1 font-mono text-sm" placeholder="e.g. http://paramedics-admin-portal.test" @keydown.enter="addApp" />
                  <UButton icon="i-heroicons-plus" label="Add" :loading="newApp.busy" :disabled="!newApp.url.trim()" @click="addApp" />
                </div>
              </UFormField>
            </UCard>
          </div>
        </div>
      </div>
      <UModal :open="!!confirming" :title="`Remove “${confirming?.name}”?`" description="Its sign-in session and any saved login are deleted from this computer. Screenshots already taken stay in their projects." @update:open="v => { if (!v) confirming = null }">
        <template #footer>
          <div class="flex w-full justify-end gap-2">
            <UButton color="neutral" variant="ghost" label="Cancel" @click="confirming = null" />
            <UButton color="error" label="Remove" @click="removeApp" />
          </div>
        </template>
      </UModal>
    </template>
    <template #footer>
      <p class="text-xs text-muted transition-opacity" :class="saved ? 'opacity-100' : 'opacity-0'"><UIcon name="i-heroicons-check" class="size-3.5 align-text-bottom" /> Saved</p>
      <UButton color="neutral" label="Done" @click="open = false" />
    </template>
  </UModal>
</template>
